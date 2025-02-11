import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors";
import { prisma } from "../helpers/prisma.h";
import { CancelSubscriptionJobs } from "../jobs/cancelSubscriptionJob.t";
import { UpdateSubscriptionJob } from "../jobs/updateSubscriptionJob.j";

const checkCompany = async ({ user }: any) => {
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

export const SubscriptionCtrl = {
	updateSubscription: async (req: Request, res: Response): Promise<void> => {
		const { company } = await checkCompany({ user: req.user });
		const { billingType, paymentPlan } = req.body;
		if (!billingType || !paymentPlan) {
			throw new BadRequestError("Billing type and payment plan are required");
		}

		const nextBillingDate = new Date(company.Subscription!.endDate as Date);

		const { transaction } = await UpdateSubscriptionJob.updateSubscriptionJob({
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
			paymentUrl: transaction.authorization_url,
		});
	},
	cancelSubscription: async (req: Request, res: Response): Promise<void> => {
		const { company } = await checkCompany({ user: req.user });

		// Execute immediate cancellation tasks
		const { deactivationDate } =
			await CancelSubscriptionJobs.cancelSubscriptionJob({
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
		res.status(StatusCodes.OK).json({
			msg: "Subscription has been reactivated successfully.",
			success: true,
		});
	},
};
