import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { NotFoundError } from "../errors";
import { prisma } from "../helpers/prisma.h";
import { CancelSubscriptionJobs } from "../jobs/cancelSubscriptionJob.t";

export const SubscriptionCtrl = {
	updateSubscription: async (req: Request, res: Response): Promise<void> => {
		res.status(StatusCodes.OK).json({
			msg: "Subscription has been updated successfully.",
			success: true,
		});
	},
	cancelSubscription: async (req: Request, res: Response): Promise<void> => {
		const { email, companyId } = req.user;
		const company = await prisma.company.findUnique({
			where: { company_email: email, id: companyId },
			include: { Subscription: { select: { endDate: true } } },
		});
		if (!company) {
			throw new NotFoundError("Company not found");
		}

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
