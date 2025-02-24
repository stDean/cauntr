import {
	Condition,
	CustomerType,
	Direction,
	InstallmentFrequency,
	PaymentMethod,
	Prisma,
	TransactionType,
} from "@prisma/client";
import { BadRequestError, NotFoundError } from "../errors";
import { StatusCodes } from "http-status-codes";
import { Response } from "express";

export interface ProductInput {
	productName: string;
	brand: string;
	productType: string;
	sellingPrice: number;
	supplierName: string;
	supplierPhone: string;
	sku?: string;
	description?: string;
	costPrice?: number;
	serialNo?: string;
	condition?: string;
	quantity?: number;
	purchaseDate?: Date;
}

// Common interfaces
export interface ProductOperation {
	sku: string;
	quantity: number;
	sellingPrice?: number;
}

interface CustomerDetails {
	name: string;
	phone: string;
	email?: string;
	address?: string;
}

// Product Utilities
export const productUtils = {
	findProductBySKU: async (
		tx: Prisma.TransactionClient,
		sku: string,
		company: { id: string; tenantId: string }
	) => {
		const product = await tx.product.findUnique({
			where: {
				sku_companyId_tenantId: {
					sku,
					companyId: company.id,
					tenantId: company.tenantId,
				},
			},
		});
		if (!product) throw new NotFoundError(`Product ${sku} not found`);
		return product;
	},

	updateProductQuantity: async (
		tx: Prisma.TransactionClient,
		productId: string,
		quantityChange: number
	) => {
		return tx.product.update({
			where: { id: productId },
			data: { quantity: { increment: quantityChange } },
		});
	},
	validateProductStock: (product: any, quantity: number) => {
		if (product.quantity < quantity) {
			throw new BadRequestError(`Insufficient stock for ${product.sku}`);
		}
	},
	normalizeCondition: (condition?: string) => {
		if (!condition) return Condition.NEW;
		const upperCondition = condition.toUpperCase();
		return Object.values(Condition).includes(upperCondition as Condition)
			? (upperCondition as Condition)
			: Condition.NEW;
	},
	validateProduct: (product: ProductInput) => {
		const errors: { field: string; message: string }[] = [];
		const requiredFields = [
			"productName",
			"productType",
			"sellingPrice",
			"brand",
		];

		requiredFields.forEach(field => {
			if (!product[field as keyof ProductInput]?.toString().trim()) {
				errors.push({ field, message: `${field} is required` });
			}
		});

		return errors.length > 0 ? errors : null;
	},
};

// Customer Utilities
export const customerUtils = {
	upsertCustomer: async (
		tx: Prisma.TransactionClient,
		details: CustomerDetails,
		company: { id: string; tenantId: string }
	) => {
		return tx.customer.upsert({
			where: { name_phone: { name: details.name, phone: details.phone } },
			create: { ...details, companyId: company.id, tenantId: company.tenantId },
			update: details,
		});
	},
};

// Transaction Utilities
export const transactionUtils = {
	createTransaction: async (
		tx: Prisma.TransactionClient,
		type: TransactionType,
		config: {
			company: { id: string; tenantId: string };
			userId: string;
			customerId?: string;
			items: Array<{
				productId: string;
				quantity: number;
				pricePerUnit: number;
				direction: Direction;
			}>;
		}
	) => {
		return tx.transaction.create({
			data: {
				type,
				companyId: config.company.id,
				tenantId: config.company.tenantId,
				createdById: config.userId,
				customerId: config.customerId || null,
				TransactionItem: {
					create: config.items.map(item => ({
						...item,
						totalPrice: item.pricePerUnit * item.quantity,
					})),
				},
			},
			include: { TransactionItem: true },
		});
	},
	createSwapTransaction: async (
		tx: Prisma.TransactionClient,
		config: {
			company: { id: string; tenantId: string };
			userId: string;
			customerId?: string;
			outgoingProduct: any;
			outgoingQuantity: number;
			incomingProducts: any;
		}
	) => {
		return tx.transaction.create({
			data: {
				type: TransactionType.SWAP,
				companyId: config.company.id,
				tenantId: config.company.tenantId,
				createdById: config.userId,
				customerId: config.customerId || null,
				TransactionItem: {
					create: [
						// Outgoing item
						{
							productId: config.outgoingProduct.id,
							quantity: config.outgoingQuantity,
							pricePerUnit: config.outgoingProduct.sellingPrice,
							totalPrice:
								config.outgoingProduct.sellingPrice * config.outgoingQuantity,
							direction: Direction.DEBIT,
						},
						// Incoming items
						...config.incomingProducts.map((product: any) => ({
							productId: product.id,
							quantity: product.quantity,
							pricePerUnit: product.sellingPrice,
							totalPrice: product.sellingPrice * product.quantity,
							direction: Direction.CREDIT,
						})),
					],
				},
			},
			include: { TransactionItem: true },
		});
	},
};

// Payment Utilities
export const paymentUtils = {
	createPaymentPlan: async (
		tx: Prisma.TransactionClient,
		config: {
			customerId?: string;
			amountPaid?: number;
			paymentMethod?: string;
			balanceOwed?: number;
			frequency?: string;
			installmentCount?: number;
			transId?: string;
		}
	) => {
		return tx.paymentPlan.create({
			data: {
				installmentCount: config.installmentCount || 1,
				transactionId: config.transId,
				frequency:
					(config.frequency?.toUpperCase() as InstallmentFrequency) ||
					InstallmentFrequency.ONE_TIME,
				customerId: config.customerId || null,
				customerType: config.balanceOwed
					? CustomerType.DEBTOR
					: CustomerType.CUSTOMER,
				payments: {
					create: {
						totalAmount: config.amountPaid ?? 0,
						method:
							(config.paymentMethod?.toUpperCase() as PaymentMethod) || "CASH",
						balanceOwed: config.balanceOwed ?? 0,
					},
				},
			},
		});
	},
};

export const responseUtils = {
	success: (res: Response, data: any, status = StatusCodes.OK) => {
		res.status(status).json({ success: true, data });
	},
	error: (
		res: Response,
		message: string,
		status = StatusCodes.BAD_REQUEST,
		errors?: any[]
	) => {
		res
			.status(status)
			.json({ success: false, message, ...(errors && { errors }) });
	},
	multiStatus: (res: Response, results: any[], errors: any[]) => {
		res.status(StatusCodes.MULTI_STATUS).json({
			created: results.length,
			failed: errors.length,
			data: results,
			errors,
		});
	},
};

// Validation Utilities
export const validationUtils = {
	validateRequiredFields: (fields: Record<string, any>, names: string[]) => {
		const missing = names.filter(name => !fields[name]);
		if (missing.length) {
			throw new BadRequestError(
				`Missing required fields: ${missing.join(", ")}`
			);
		}
	},

	validateProductsExist: (found: any[], requested: string[]) => {
		if (found.length !== requested.length) {
			const missing = requested.filter(sku => !found.some(p => p.sku === sku));
			throw new BadRequestError(`Missing products: ${missing.join(", ")}`);
		}
	},

	validateStockQuantities: (products: any[], requests: ProductOperation[]) => {
		const errors = requests
			.map(req => {
				const product = products.find(p => p.sku === req.sku);
				return product && product.quantity < req.quantity
					? `Insufficient stock for ${req.sku} (${product.quantity} < ${req.quantity})`
					: null;
			})
			.filter(Boolean);

		if (errors.length) {
			throw new BadRequestError(errors.join("; "));
		}
	},
};
