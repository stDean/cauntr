import { Condition, Direction, Prisma, TransactionType } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors";
import { generateSKU, userNdCompany } from "../utils/helper";
import {
	customerUtils,
	paymentUtils,
	ProductOperation,
	productUtils,
	transactionUtils,
	validationUtils,
} from "../utils/helperUtils";
import { prisma } from "../utils/prisma.h";

interface SwapProductRequest {
	outgoing: { sku: string; quantity: number };
	incoming: Array<{
		sku: string;
		quantity: number;
		productName: string;
		sellingPrice: number;
		description?: string;
		brand: string;
		productType: string;
		serialNo?: string;
		condition: Condition;
		supplierName?: string;
		supplierPhone?: string;
		costPrice?: number;
	}>;
	customerDetails: {
		name: string;
		phone: string;
		email?: string;
		address?: string;
	};
	payment: { paymentMethod?: string; amountPaid?: number };
}

interface Company {
	id: string;
	tenantId: string;
}

interface SellProductRequest {
	transaction: { quantity: number; price: number; sku?: string };
	customerDetails: {
		name: string;
		phone: string;
		email: string;
		address: string;
	};
	payment: {
		paymentMethod: string;
		amountPaid: number;
		balanceOwed: number;
		frequency: string;
	};
}

// Helper functions
const handleOutgoingProduct = async (
	tx: Prisma.TransactionClient,
	company: Company,
	sku: string,
	quantity: number
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

	if (!product) throw new NotFoundError("Outgoing product not found");
	if (product.quantity < quantity)
		throw new BadRequestError("Insufficient stock");

	return tx.product.update({
		where: { id: product.id },
		data: { quantity: product.quantity - quantity },
	});
};

const getOrCreateSupplier = async (
	tx: Prisma.TransactionClient,
	details: { name: string; contact: string }
) => {
	return tx.supplier.upsert({
		where: { name_contact: details },
		create: details,
		update: {},
	});
};

const handleIncomingProduct = async (
	tx: Prisma.TransactionClient,
	company: Company,
	userId: string,
	item: SwapProductRequest["incoming"][number]
) => {
	const existingProduct = await tx.product.findUnique({
		where: {
			sku_companyId_tenantId: {
				sku: item.sku,
				companyId: company.id,
				tenantId: company.tenantId,
			},
		},
	});

	if (existingProduct) {
		return tx.product.update({
			where: { id: existingProduct.id },
			data: { quantity: existingProduct.quantity + item.quantity },
		});
	}

	const supplier = await getOrCreateSupplier(tx, {
		name: item.supplierName || "Swap Supplier",
		contact: item.supplierPhone || "000-0000000",
	});

	return tx.product.create({
		data: {
			sku: item.sku || (generateSKU(item.productType) as string),
			productName: item.productName,
			sellingPrice: item.sellingPrice,
			quantity: item.quantity,
			companyId: company.id,
			tenantId: company.tenantId,
			supplierId: supplier.id,
			createdById: userId,
			condition: item.condition || Condition.NEW,
			brand: item.brand,
			productType: item.productType,
			serialNo: item.serialNo || null,
			description: item.description || null,
			costPrice: item.costPrice || 0,
		},
	});
};

const getSoldOrSwapProducts = async ({
	company,
	inArray,
}: {
	company: Company;
	inArray: TransactionType[];
}) => {
	const transactions = await prisma.transaction.findMany({
		where: {
			type: { in: inArray },
			companyId: company.id,
			tenantId: company.tenantId,
		},
		include: {
			TransactionItem: {
				include: { Product: { include: { Supplier: true } } },
			},
			Customer: true,
		},
	});

	if (!transactions) throw new NotFoundError("No Product found.");

	return { transactions };
};

export const TransactionsCtrl = {
	sellProduct: async (req: Request, res: Response) => {
		const { user, params, body } = req;
		const {
			transaction: transactionBody,
			payment,
			customerDetails,
		} = body as SellProductRequest;

		const { company, user: authUser } = await userNdCompany(user);

		return prisma.$transaction(async tx => {
			const product = await productUtils.findProductBySKU(
				tx,
				params.sku,
				company
			);
			productUtils.validateProductStock(product, transactionBody.quantity);

			const updatedProduct = await productUtils.updateProductQuantity(
				tx,
				product.id,
				-transactionBody.quantity
			);

			const customer = await customerUtils.upsertCustomer(
				tx,
				customerDetails,
				company
			);

			const transaction = await transactionUtils.createTransaction(
				tx,
				TransactionType.SALE,
				{
					company,
					userId: authUser.id,
					customerId: customer.id,
					items: [
						{
							productId: updatedProduct.id,
							quantity: transactionBody.quantity,
							pricePerUnit: transactionBody.price,
							direction: Direction.DEBIT,
						},
					],
				}
			);

			const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
				customerId: customer.id,
				...payment,
				balanceOwed: payment.balanceOwed,
				frequency: payment.frequency,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, customer, paymentPlan },
			});
		});
	},
	sellProducts: async (req: Request, res: Response) => {
		const { user, body } = req;
		const { company, user: authUser } = await userNdCompany(user);

		validationUtils.validateRequiredFields(body, ["transactions"]);

		return prisma.$transaction(async tx => {
			const products = await Promise.all(
				body.transactions.map((txn: ProductOperation) =>
					productUtils.findProductBySKU(tx, txn.sku, company)
				)
			);

			validationUtils.validateStockQuantities(products, body.transactions);

			await Promise.all(
				body.transactions.map((txn: ProductOperation) =>
					productUtils.updateProductQuantity(
						tx,
						products.find(p => p.sku === txn.sku)!.id,
						-txn.quantity
					)
				)
			);

			const customer = await customerUtils.upsertCustomer(
				tx,
				body.customerDetails,
				company
			);

			const transaction = await transactionUtils.createTransaction(
				tx,
				TransactionType.BULK_SALE,
				{
					company,
					userId: authUser.id,
					customerId: customer.id,
					items: body.transactions.map((txn: ProductOperation) => ({
						productId: products.find(p => p.sku === txn.sku)!.id,
						quantity: txn.quantity,
						pricePerUnit: txn.sellingPrice || 0,
						direction: Direction.DEBIT,
					})),
				}
			);

			const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
				customerId: customer.id,
				...body.payment,
				balanceOwed: body.payment.balanceOwed,
				frequency: body.payment.frequency,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, customer, paymentPlan },
			});
		});
	},
	swapProduct: async (req: Request, res: Response) => {
		const { user, body, params } = req;
		const { outgoing, incoming, customerDetails, payment } =
			body as SwapProductRequest;
		// Validate input
		if (!outgoing?.sku || !outgoing?.quantity || !incoming?.length) {
			throw new BadRequestError(
				"Invalid swap request: Missing required fields"
			);
		}

		// Get company context
		const { company, user: authUser } = await userNdCompany(user);

		return prisma.$transaction(async tx => {
			// 1. Process outgoing product
			const outgoingProduct = await handleOutgoingProduct(
				tx,
				company,
				params.sku,
				outgoing.quantity
			);

			// 2. Process incoming products
			const incomingProducts = await Promise.all(
				incoming.map(item =>
					handleIncomingProduct(tx, company, authUser.id, item)
				)
			);

			// 3. Handle customer
			const customer = await customerUtils.upsertCustomer(
				tx,
				customerDetails,
				company
			);

			// 4. Create transaction
			const transaction = await transactionUtils.createSwapTransaction(tx, {
				company,
				userId: authUser.id,
				customerId: customer.id,
				outgoingProduct,
				outgoingQuantity: outgoing.quantity,
				incomingProducts,
			});

			// 5. Handle payment if applicable
			const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
				customerId: customer.id,
				...payment,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, paymentPlan, customer },
				message: "Product swap completed successfully",
			});
		});
	},
	getSoldProducts: async (req: Request, res: Response) => {
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

		const { transactions } = await getSoldOrSwapProducts({
			company,
			inArray: ["SALE", "BULK_SALE"],
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Products sold successfully",
			data: transactions,
			nbHits: transactions.length,
		});
	},
	getSwapProducts: async (req: Request, res: Response) => {
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

		const { transactions } = await getSoldOrSwapProducts({
			company,
			inArray: ["SWAP"],
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Products sold successfully",
			data: transactions,
			nbHits: transactions.length,
		});
	},
	updateProductBalance: async (req: Request, res: Response) => {
		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Product balance successfully updated",
		});
	},
	getSoldProductBySKU: async (req: Request, res: Response) => {
		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Sold product found.",
		});
	},
	getSwaProductBySKU: async (req: Request, res: Response) => {
		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Swap product found.",
		});
	},
	updateSoldPrice: async (req: Request, res: Response) => {
		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Product price successfully updated",
		});
	},
};
