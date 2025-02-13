import { NextFunction, Request, Response, Router } from "express";
import { prisma } from "../helpers/prisma.h";
import crypto from "crypto";

const router = Router();

const validatePayStackSignature = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	try {
		const signature = crypto
			.createHmac("sha512", process.env.PAY_STACK_SECRET_KEY)
			.update(JSON.stringify(req.body))
			.digest("hex");

		if (signature !== req.headers["x-paystack-signature"]) {
			res.status(401).json({ error: "Invalid signature" });
			return;
		}

		next();
	} catch (error) {
		console.error("Signature validation error:", error);
		res.status(500).json({ error: "Internal server error" });
		return;
	}
};

const validateCompany = async ({
	email,
	status,
	tx,
}: {
	email: string;
	status: boolean;
	tx: any;
}) => {
	const company = await tx.company.findUnique({
		where: { company_email: email },
		include: { Subscription: { select: { payStackCustomerID: true } } },
	});

	if (!company) {
		return;
	}

	if (status) {
		return;
	}

	return { company };
};

const handleChargeSuccess = async (data: any, tx: any) => {
	const {
		id,
		customer: { email },
		authorization: { authorization_code },
		status,
	} = data;

	const companyResult = await validateCompany({
		email,
		status: status !== "success",
		tx,
	});
	if (!companyResult) {
		throw new Error("Company not found or invalid status");
	}
	const { company } = companyResult;

	await tx.company.update({
		where: { company_email: company.company_email },
		data: {
			Subscription: {
				update: {
					data: { authorization_code, transactionId: id.toString() },
				},
			},
		},
	});
};

const handleSubscriptionCreate = async (data: any, tx: any) => {
	const {
		subscription_code,
		next_payment_date,
		customer: { email },
		status,
		authorization: { authorization_code },
	} = data;

	const companyResult = await validateCompany({
		email,
		status: status !== "active",
		tx,
	});
	if (!companyResult) {
		throw new Error("Company not found or invalid status");
	}
	const { company } = companyResult;

	await tx.company.update({
		where: { company_email: company.company_email },
		data: {
			canUpdate: true,
			canCancel: true,
			Subscription: {
				update: {
					data: {
						payStackSubscriptionCode: subscription_code,
						startDate: new Date(),
						endDate: new Date(next_payment_date),
						authorization_code,
					},
				},
			},
		},
	});
};

router
	.route("/webhook")
	.post(validatePayStackSignature, async (req: Request, res: Response) => {
		try {
			const result = await prisma.$transaction(async tx => {
				const { event, data } = req.body;

				console.log({ event });

				// Validate payload structure
				if (!event || !data?.id) {
					res.status(400).json({ error: "Invalid payload structure" });
					return null;
				}

				// Check for duplicate event
				const existingEvent = await tx.webhookEvent.findUnique({
					where: { eventId: String(data.id) },
				});

				if (existingEvent) {
					return { status: "duplicate", data: null };
				}

				// Create audit record first
				const auditRecord = await tx.webhookEvent.create({
					data: {
						eventId: String(data.id),
						eventType: event,
						payload: data,
						status: "processing",
						attempts: 1,
					},
				});

				try {
					let processedData;
					switch (event) {
						case "charge.success":
							processedData = await handleChargeSuccess(data, tx);
							break;
						case "subscription.create":
							processedData = await handleSubscriptionCreate(data, tx);
							break;
						case "subscription.not_renew":
						case "subscription.disable":
							console.log({ msg: "Subscription not renew or disable." });
							break;
						// Add other event cases here
						default:
							await tx.webhookEvent.update({
								where: { id: auditRecord.id },
								data: { status: "unhandled" },
							});
							return { status: "unhandled", data: null };
					}

					// Update audit record on success
					await tx.webhookEvent.update({
						where: { id: auditRecord.id },
						data: {
							status: "processed",
							processedAt: new Date(),
						},
					});

					return { status: "success", data: processedData };
				} catch (processError) {
					// Update audit record on processing failure
					await tx.webhookEvent.update({
						where: { id: auditRecord.id },
						data: {
							status: "failed",
							attempts: { increment: 1 },
						},
					});
					throw processError;
				}
			});

			// Handle transaction result
			if (result?.status === "duplicate") {
				res.status(200).json({ status: "Event already processed" });
				return;
			}

			if (result?.status === "unhandled") {
				res.status(200).json({ status: "Event not handled" });
				return;
			}

			res.status(200).json({
				status: "Webhook processed successfully",
				data: result?.data,
			});
			return;
		} catch (error) {
			console.error("Webhook processing error:", error);

			const statusCode =
				error instanceof Error && error.message.includes("Invalid") ? 400 : 500;

			res.status(statusCode).json({
				error: error instanceof Error ? error.message : "Internal server error",
			});

			return;
		}
	});

export default router;
