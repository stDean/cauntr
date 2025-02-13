import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, CustomAPIError } from "../errors";
import { prisma } from "../helpers/prisma.h";
import { Condition, ContactType, ItemStatus } from "@prisma/client";

// Helper functions
const generateSKU = (type: string) => {
	const prefix = type.slice(0, 3).toUpperCase();
	const random = Math.floor(1000 + Math.random() * 9000);
	return `${prefix}-${random}`;
};

const userNdCompany = async ({
	email,
	companyId,
}: {
	email: string;
	companyId: string;
}) => {
	const company = await prisma.company.findUnique({
		where: { company_email: email, id: companyId },
		select: { tenantId: true },
	});

	if (!company) {
		throw new BadRequestError("Company not found");
	}

	const user = await prisma.user.findUnique({
		where: { email, companyId },
		select: { id: true },
	});

	if (!user) {
		throw new BadRequestError("User not found");
	}

	return { user, company };
};

export const InventoryCtrl = {
	createProducts: async (req: Request, res: Response) => {
		const {
			user: { companyId, email },
		} = req;

		const { user, company } = await userNdCompany({ email, companyId });

		res.status(StatusCodes.CREATED).json({
			msg: "Products created successfully",
			success: true,
			data: { user, company },
		});
	},
};
