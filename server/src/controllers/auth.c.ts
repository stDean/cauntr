import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import argon2 from "argon2";
import { prisma } from "../helpers/prisma.h";
import { createJWT, handleOtpForCompany } from "../helpers/authHelpers.h";
import { paystackService } from "../services/paystackService";
import { BadRequestError, CustomAPIError } from "../errors";
import { my_plans } from "../helpers/constants";

export const AuthController = {
	createCompany: async (req: Request, res: Response): Promise<void> => {
		const {
			company_name,
			company_email,
			password,
			country,
			billingPlan,
			billingType,
		} = req.body;
		const hashedPassword = await argon2.hash(password);

		// Initialize the company as a customer
		const { error, transaction, verify } =
			await paystackService.initializeTransaction({
				email: company_email,
				amount: "5000",
			});

		// return if there is an error
		if (error || !transaction || !verify) {
			throw new CustomAPIError(
				"Payment gateway initialization failed",
				StatusCodes.BAD_GATEWAY
			);
		}

		// Validate customer data from verification
		if (!verify.customer?.customer_code) {
			throw new CustomAPIError(
				"Payment customer verification failed",
				StatusCodes.BAD_GATEWAY
			);
		}

		const newCompany = await prisma.company.create({
			data: {
				company_name,
				company_email,
				password: hashedPassword,
				country,
				paymentStatus: "PENDING",
				Subscription: {
					connectOrCreate: {
						where: { payStackCustomerID: verify.customer.customer_code },
						create: {
							tier: billingPlan.toUpperCase(),
							tierType: billingType === "month" ? "MONTHLY" : "YEARLY",
							payStackCustomerID: verify?.customer.customer_code,
						},
					},
				},
			},
		});

		// Send OTP for verification
		await handleOtpForCompany(newCompany.company_email).catch(error => {
			throw new CustomAPIError("OTP sending failed", StatusCodes.BAD_GATEWAY);
		});

		res.status(StatusCodes.CREATED).json({
			success: true,
			msg: "Company created successfully, verify your email to continue.",
			paymentUrl: transaction.authorization_url,
		});
	},
	verifyOTP: async (req: Request, res: Response): Promise<void> => {
		const { otp, company_email } = req.body;
		if (!otp) {
			throw new BadRequestError("Please enter the OTP sent to your email.");
		}

		const existingOtp = await prisma.otp.findFirst({
			where: {
				email: company_email,
				otp,
				// Ensure OTP is not expired
				expiresAt: { gte: new Date() },
				verified: false,
			},
		});
		if (!existingOtp) {
			throw new BadRequestError("Invalid OTP, please try again.");
		}

		const company = await prisma.company.findUnique({
			where: { company_email },
			include: {
				Subscription: {
					select: {
						payStackCustomerID: true,
						tier: true,
						tierType: true,
						authorization_code: true,
						transactionId: true,
					},
				},
			},
		});
		if (!company) {
			throw new BadRequestError("Company not found");
		}

		const planName = `${company!.Subscription!.tier.toLowerCase()}_${company!
			.Subscription!.tierType.replace("LY", "")
			.toLowerCase()}`;
		const startDate = new Date();
		startDate.setDate(startDate.getDate() + 7); // 7-day trial period

		// Create a paystack subscription for the company
		const { error, subscription } = await paystackService.createSubscription({
			customer: company.Subscription!.payStackCustomerID,
			plan: my_plans[planName],
			start_date: startDate,
			authorization: String(company.Subscription!.authorization_code!),
		});

		if (error) {
			throw new CustomAPIError(error, StatusCodes.BAD_GATEWAY);
		}

		// Update company and subscription details
		const updatedCompany = await prisma.company.update({
			where: { id: company.id },
			data: {
				paymentStatus: "ACTIVE",
				verified: true,
				Subscription: {
					update: {
						data: {
							payStackSubscriptionCode: subscription?.data.subscription_code,
							startDate: new Date(),
							endDate: subscription?.endDate,
						},
					},
				},
			},
		});

		// delete the otp
		await prisma.otp.delete({
			where: { id: existingOtp.id },
		});

		// refund initial fee(#50) to the company
		const { error: refundErr, msg } = await paystackService.refundTransaction({
			transId: Number(company!.Subscription!.transactionId),
			amount: "5000",
		});

		if (refundErr) {
			throw new CustomAPIError(refundErr, StatusCodes.BAD_GATEWAY);
		}

		// Create the company as a user
		const user = await prisma.users.create({
			data: {
				companyId: updatedCompany.id,
				email: updatedCompany.company_email,
				password: updatedCompany.password,
				role: "ADMIN",
			},
		});

		// Send JWT
		const jwtToken = createJWT({
			email: user.email,
			companyId: user.companyId!,
		});

		// Set authentication cookie
		res.cookie("token", jwtToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 7 * 24 * 60 * 60 * 1000,
		});

		res.status(StatusCodes.OK).json({
			message: "OTP verified",
			success: true,
			role: user.role,
		});
	},
	loginUser: async (req: Request, res: Response): Promise<void> => {
		res.status(StatusCodes.OK).json({ msg: "User logged in" });
	},
};
