import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import argon2 from "argon2";
import { prisma } from "../helpers/prisma.h";
import { handleOtpForCompany } from "../helpers/authHelpers.h";

export const AuthController = {
	createCompany: async (req: Request, res: Response): Promise<void> => {
		const { company_name, company_email, password, country } = req.body;
		const hashedPassword = await argon2.hash(password);

		// Initialize the company as a customer

		// return if there is an error

		const newCompany = await prisma.company.create({
			data: {
				company_name,
				company_email,
				password: hashedPassword,
				country,
			},
		});

		// Send OTP for verification
		await handleOtpForCompany(newCompany.company_email);

		res
			.status(StatusCodes.CREATED)
			.json({ success: true, msg: "Company created", company: newCompany });
	},
	loginUser: async (req: Request, res: Response): Promise<void> => {
		res.status(StatusCodes.OK).json({ msg: "User logged in" });
	},
};
