import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, CustomAPIError, NotFoundError } from "../errors";
import { prisma } from "../helpers/prisma.h";
import { SubscriptionJobs } from "../jobs/subscriptionJob.j";
import { paystackService } from "../services/paystackService";
import { my_plans } from "../helpers/constants";
import { Tier } from "@prisma/client";

export const checkCompany = async ({ user }: any) => {
	const { email, companyId } = user;
	const company = await prisma.company.findUnique({
		where: { company_email: email, id: companyId },
		include: {
			Subscription: {
				select: { endDate: true, payStackCustomerID: true },
			},
		},
	});
	if (!company) {
		throw new NotFoundError("Company not found");
	}

	return { company };
};

export const checkBilling = async ({ body }: any) => {
	const { paymentPlan, billingType } = body;
	if (!paymentPlan || !billingType) {
		throw new BadRequestError("Billing type and payment plan are required");
	}

	return { paymentPlan, billingType };
};

export const SubscriptionCtrl = {
	updateSubscription: async (req: Request, res: Response): Promise<void> => {
		const { company } = await checkCompany({ user: req.user });
		const { billingType, paymentPlan } = await checkBilling({ body: req.body });

		const nextBillingDate = new Date(company.Subscription!.endDate as Date);

		// Execute updating job
		const { transaction } = await SubscriptionJobs.updateSubscriptionJob({
			billingType,
			paymentPlan: paymentPlan,
			email: company.company_email,
			nextBillingDate,
			companyId: company.id,
			customerId: company.Subscription!.payStackCustomerID,
		});

		res.status(StatusCodes.OK).json({
			msg: "Subscription has been updated successfully.",
			success: true,
			paymentUrl: transaction ? transaction.authorization_url : "",
		});
	},
	cancelSubscription: async (req: Request, res: Response): Promise<void> => {
		const { company } = await checkCompany({ user: req.user });

		// Execute cancellation job
		const { deactivationDate } = await SubscriptionJobs.cancelSubscriptionJob({
			email: company.company_email,
			companyId: company.id,
			cancelDate: company.Subscription!.endDate as Date,
		});

		res.status(StatusCodes.OK).json({
			msg: "Subscription has been canceled successfully.",
			success: true,
			deactivationDate,
		});
	},
	reactivateSubscription: async (
		req: Request,
		res: Response
	): Promise<void> => {
		const { company } = await checkCompany({ user: req.user });
		const { billingType, paymentPlan } = await checkBilling({ body: req.body });

		// Initialize the company as a customer and subscribe them to a plan
		const { transaction, error } = await paystackService.initializeTransaction({
			email: company.company_email,
			plan: my_plans[
				`${paymentPlan.toLowerCase()}_${billingType.toLowerCase()}`
			],
			amount: "5000",
		});

		if (error) {
			throw new CustomAPIError(
				"Payment gateway initialization failed",
				StatusCodes.BAD_GATEWAY
			);
		}

		await prisma.company.update({
			where: { id: company.id, company_email: company.company_email },
			data: {
				subscriptionStatus: "ACTIVE",
				Subscription: {
					update: {
						tier: paymentPlan.toUpperCase() as Tier,
						tierType: billingType === "month" ? "MONTHLY" : "YEARLY",
					},
				},
			},
		});

		res.status(StatusCodes.OK).json({
			msg: "Subscription has been reactivated successfully.",
			success: true,
			paymentUrl: transaction.authorization_url,
		});
	},
};
