import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../helpers/prisma.h";
import { handleOtpForCompany } from "../helpers/authHelpers.h";
import { CustomAPIError } from "../errors";

export const checkExistingCompany = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	try {
		const { company_email } = req.body;

		const existingCompany = await prisma.company.findUnique({
			where: { company_email },
			include: { Subscription: { select: { payStackCustomerID: true } } },
		});

		if (existingCompany) {
			// Handle unverified company with active payment and no paystack customer code
			if (
				!existingCompany.verified &&
				existingCompany.subscriptionStatus !== "ACTIVE" &&
				!existingCompany!.Subscription!.payStackCustomerID
			) {
				await handleOtpForCompany(existingCompany.company_email);
				res.status(StatusCodes.OK).json({
					message: "Check your email for OTP",
					success: true,
				});

				return;
			}

			// Handle verified company with inactive payment
			if (
				existingCompany.verified &&
				existingCompany.subscriptionStatus === "TRIAL"
			) {
				res.status(StatusCodes.BAD_REQUEST).json({
					success: false,
					message: "Company already exists. Please update your payment method.",
				});

				return;
			}

			// Delete company record if doesn't match previous conditions
			await prisma.company.delete({
				where: { id: existingCompany.id },
			});
		}

		// Continue with registration process
		next();
	} catch (error) {
		throw new CustomAPIError(
			"Error checking company existence",
			StatusCodes.INTERNAL_SERVER_ERROR
		);
	}
};
