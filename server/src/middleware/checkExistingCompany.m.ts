import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../helpers/prisma.h";
import { handleOtpForCompany } from "../helpers/authHelpers.h";

export const checkExistingCompany = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	try {
		const { company_email } = req.body;

		const existingCompany = await prisma.company.findUnique({
			where: { company_email },
		});

		if (!existingCompany) return;

		// Handle unverified company with active payment
		if (
			!existingCompany.verified &&
			existingCompany.paymentStatus === "ACTIVE"
		) {
			await handleOtpForCompany(existingCompany.company_email);
			return res.status(StatusCodes.OK).json({
				message: "Check your email for OTP",
				success: true,
			});
		}

		// Handle verified company with inactive payment
		if (
			existingCompany.verified &&
			existingCompany.paymentStatus === "INACTIVE"
		) {
			return res.status(StatusCodes.BAD_REQUEST).json({
				success: false,
				message: "Company already exists. Please update your payment method.",
			});
		}

		// Delete company record if doesn't match previous conditions
		await prisma.company.delete({
			where: { id: existingCompany.id },
		});

		// Continue with registration process
		return next();
	} catch (error) {
		return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
			success: false,
			message: "Error checking company existence",
			error: process.env.NODE_ENV === "development" ? error : undefined,
		});
	}
};
