import { Direction, Product, Supplier, TransactionType } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../errors";
import { prisma } from "./prisma.h";
import { ProductInput, responseUtils, transactionUtils } from "./helperUtils";
import { productService } from "../services/productService";
import { StatusCodes } from "http-status-codes";
import { Response } from "express";

export function parseDate(dateInput: string | number | Date): Date | null {
	if (dateInput instanceof Date) {
		return new Date(dateInput);
	}

	if (typeof dateInput === "number") {
		return new Date(dateInput);
	}

	if (typeof dateInput === "string") {
		const parsedDate = new Date(dateInput);
		if (!isNaN(parsedDate.getTime())) {
			return parsedDate;
		}

		// Handle formats manually if needed
		const formats = [
			/^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
			/^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
			/^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
			/^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY
		];

		for (const format of formats) {
			if (format.test(dateInput)) {
				const parts = dateInput.split(/[-\/]/).map(Number);
				if (format === formats[0] || format === formats[2]) {
					return new Date(parts[0], parts[1] - 1, parts[2]);
				} else if (format === formats[1]) {
					return new Date(parts[2], parts[0] - 1, parts[1]);
				} else if (format === formats[3]) {
					return new Date(parts[2], parts[1] - 1, parts[0]);
				}
			}
		}
	}

	return null; // Return null if parsing fails
}

export const generateSKU = (type: string) => {
	if (!type) return;

	const prefix = type.slice(0, 3).toUpperCase();
	const random = Math.floor(1000 + Math.random() * 9000);
	return `${prefix}-${random}`;
};

export const userNdCompany = async ({
	email,
	companyId,
}: {
	email: string;
	companyId: string;
}) => {
	const company = await prisma.company.findUnique({
		where: { company_email: email, id: companyId },
		select: { tenantId: true, id: true },
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

export const handleBuybackProduct = async ({
	res,
	existingProduct,
	productInput,
	user,
	company,
	supplier,
}: {
	res: Response;
	existingProduct: Product;
	productInput: ProductInput;
	user: { id: string };
	company: { id: string; tenantId: string };
	supplier: Supplier;
}) => {
	const customer = await prisma.customer.upsert({
		where: { name_phone: { name: supplier.name, phone: supplier.contact } },
		create: {
			name: supplier.name,
			phone: supplier.contact,
			companyId: company.id,
			tenantId: company.tenantId,
		},
		update: { name: supplier.name, phone: supplier.contact },
	});

	const quantity = Number(productInput.quantity || 1);
	const updateData =
		existingProduct.quantity > 0
			? { quantity: existingProduct.quantity + quantity }
			: productService.createProductData(productInput, user, company, supplier);

	const updatedProduct = await prisma.product.update({
		where: { id: existingProduct.id },
		data: { ...updateData, supplierId: supplier.id },
	});

	const transaction = await transactionUtils.createTransaction(
		prisma,
		TransactionType.BUYBACK,
		{
			company: { id: company.id, tenantId: company.tenantId },
			userId: user.id,
			customerId: customer.id,
			items: [
				{
					productId: updatedProduct.id,
					quantity,
					pricePerUnit: 0,
					direction: Direction.CREDIT,
				},
			],
		}
	);

	responseUtils.success(res, transaction, StatusCodes.CREATED);
};

export const productHelper = async ({
	sku,
	email,
	companyId,
}: {
	sku: string;
	email: string;
	companyId: string;
}) => {
	const { company } = await userNdCompany({ email, companyId });
	const product: Product | null = await prisma.product.findUnique({
		where: {
			sku_companyId_tenantId: {
				sku,
				companyId: company.id,
				tenantId: company.tenantId,
			},
			quantity: { gt: 0 },
		},
	});

	if (!product) {
		throw new NotFoundError("Product not found or has been deleted.");
	}

	return { company, product };
};
