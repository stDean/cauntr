import {
	Condition,
	CustomerType,
	Direction,
	PaymentMethod,
	Prisma,
	TransactionType,
} from "@prisma/client";
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
import { supplierService } from "../services/supplierService";

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
	customerDetails?: {
		name: string;
		phone: string;
		email: string;
		address: string;
	};
	payment: {
		paymentMethod: string;
		balanceOwed: number;
		frequency: string;
	};
}

// Helper functions
export const handleOutgoingProduct = async (
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

export const handleIncomingProduct = async (
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

	let supplier;
	if (item.supplierName || item.supplierPhone) {
		supplier = await supplierService.getOrCreate(
			item.supplierName || "Swap Supplier",
			item.supplierPhone || "000-0000000",
			company.id,
			company.tenantId
		);
	}

	return tx.product.create({
		data: {
			sku: item.sku || (generateSKU(item.productType) as string),
			productName: item.productName,
			sellingPrice: item.sellingPrice,
			quantity: item.quantity,
			companyId: company.id,
			tenantId: company.tenantId,
			supplierId: supplier ? supplier.id : null,
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

export const getSoldOrSwapProducts = async ({
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

export const soldOrSwapByID = async ({
	company,
	inArray,
	id,
}: {
	company: Company;
	inArray: TransactionType[];
	id: string;
}) => {
	const transaction = await prisma.transaction.findUnique({
		where: {
			id: id,
			companyId: company.id,
			tenantId: company.tenantId,
			type: { in: inArray },
		},
		include: {
			TransactionItem: {
				include: {
					Product: {
						include: {
							Supplier: true,
						},
					},
				},
			},
			Customer: true,
		},
	});

	if (!transaction) throw new NotFoundError("Transaction not found.");

	return { transaction };
};

export const TransactionsCtrl = {
	/**
	 * Sell a single product.
	 *
	 * Steps:
	 * - Extract user information, URL parameters (such as the product SKU), and request body data
	 *   (transaction details, payment info, and optional customer details).
	 * - Retrieve the company context and authenticated user using a helper function.
	 * - Start a database transaction to ensure all subsequent operations are executed atomically.
	 * - Locate the product by its SKU and validate that there is sufficient stock available.
	 * - Update the product’s quantity by deducting the sold amount.
	 * - If customer details are provided, perform an upsert to update or create the customer record.
	 * - Create a sale transaction record that includes details of the sold product.
	 * - Create a payment plan by calculating the total paid amount (price multiplied by quantity)
	 *   and setting other payment details.
	 * - Return a JSON response containing the transaction, customer (if any), and payment plan details.
	 */
	sellProduct: async (req: Request, res: Response) => {
		const { user, params, body } = req;
		const {
			transaction: transactionBody,
			payment,
			customerDetails,
		} = body as SellProductRequest;
		// Add validation for required fields
		validationUtils.validateRequiredFields(body, ["transaction"]);

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

			let customer;
			if (customerDetails) {
				customer = await customerUtils.upsertCustomer(
					tx,
					customerDetails,
					company
				);
			}

			const transaction = await transactionUtils.createTransaction(
				tx,
				TransactionType.SALE,
				{
					company,
					userId: authUser.id,
					customerId: customer && customer.id,
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
				customerId: customer && customer.id,
				...payment,
				amountPaid:
					Number(transactionBody.price) * Number(transactionBody.quantity),
				balanceOwed: payment.balanceOwed,
				frequency: payment.frequency,
				transId: transaction.id,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, customer, paymentPlan },
			});
		});
	},

	/**
	 * Sell multiple products in a bulk sale.
	 *
	 * Steps:
	 * - Extract the user information and transactions list from the request body.
	 * - Retrieve the company context and authenticated user details.
	 * - Validate that the "transactions" field is present in the request body.
	 * - Initiate a database transaction to ensure atomicity.
	 * - For each transaction in the list:
	 *    - Concurrently fetch the corresponding product by SKU.
	 *    - Validate that each product has enough stock to cover the sale.
	 * - Update the quantity of each product based on the sold amounts.
	 * - If customer details are provided, upsert the customer record.
	 * - Create a bulk sale transaction record that aggregates all sold products.
	 * - Calculate the total amount paid by summing up the individual transaction totals.
	 * - Create a payment plan for the bulk sale with the calculated payment details.
	 * - Return a JSON response with the bulk sale transaction, customer details, and payment plan.
	 */
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

			let customer;
			if (body.customerDetails) {
				customer = await customerUtils.upsertCustomer(
					tx,
					body.customerDetails,
					company
				);
			}

			const transaction = await transactionUtils.createTransaction(
				tx,
				TransactionType.BULK_SALE,
				{
					company,
					userId: authUser.id,
					customerId: customer && customer.id,
					items: body.transactions.map((txn: ProductOperation) => ({
						productId: products.find(p => p.sku === txn.sku)!.id,
						quantity: txn.quantity,
						pricePerUnit: txn.sellingPrice || 0,
						direction: Direction.DEBIT,
					})),
				}
			);

			const amountPaid = body.transactions.reduce((acc: number, txn: any) => {
				return acc + txn.sellingPrice * txn.quantity;
			}, 0);

			const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
				customerId: customer && customer.id,
				...body.payment,
				amountPaid: amountPaid,
				balanceOwed: body.payment.balanceOwed,
				frequency: body.payment.frequency,
				transId: transaction.id,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, customer, paymentPlan },
			});
		});
	},

	/**
	 * Swap a product.
	 *
	 * Steps:
	 * - Extract the user information, URL parameters, and request body data including:
	 *    - Outgoing product details (SKU and quantity to be swapped out).
	 *    - An array of incoming product details.
	 *    - Optional customer details and payment info.
	 * - Validate that the outgoing product and at least one incoming product are specified.
	 * - Retrieve the company context and authenticated user.
	 * - Begin a database transaction.
	 * - Process the outgoing product by reducing its stock quantity accordingly.
	 * - Process each incoming product concurrently, which may involve adding new stock or updating records.
	 * - If provided, upsert the customer record using the provided customer details.
	 * - Create a swap transaction record that captures details for both the outgoing and incoming products.
	 * - If payment details are provided, create a corresponding payment plan.
	 * - Return a JSON response confirming the successful swap, along with transaction, payment, and customer details.
	 */
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
			let customer;
			if (customerDetails) {
				customer = await customerUtils.upsertCustomer(
					tx,
					customerDetails,
					company
				);
			}

			// 4. Create transaction
			const transaction = await transactionUtils.createSwapTransaction(tx, {
				company,
				userId: authUser.id,
				customerId: customer && customer.id,
				outgoingProduct,
				outgoingQuantity: outgoing.quantity,
				incomingProducts,
			});

			// 5. Handle payment if applicable
			const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
				customerId: customer && customer.id,
				transId: transaction.id,
				...payment,
			});

			res.status(StatusCodes.OK).json({
				success: true,
				data: { transaction, paymentPlan, customer },
				message: "Product swap completed successfully",
			});
		});
	},

	/**
	 * Retrieve sold products.
	 *
	 * Steps:
	 * - Extract the user's email and company ID from the request.
	 * - Retrieve the company context based on the user's credentials.
	 * - Fetch all transactions classified as "SALE" or "BULK_SALE" using a helper function.
	 * - Return a JSON response containing the list of sold transactions and the count of transactions.
	 */
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

	/**
	 * Retrieve swap transactions.
	 *
	 * Steps:
	 * - Extract the user's email and company ID from the request.
	 * - Retrieve the company context using the user details.
	 * - Fetch all transactions classified as "SWAP" using a helper function.
	 * - Return a JSON response containing the list of swap transactions and the total number of hits.
	 */
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

	/**
	 * Retrieve a sold transaction by its ID.
	 *
	 * Steps:
	 * - Retrieve the company context from the authenticated user's data.
	 * - Use a helper function to fetch the transaction by its ID, filtering for transactions of type
	 *   "SALE" or "BULK_SALE".
	 * - Return a JSON response containing the details of the found sold transaction.
	 */
	getSoldTransactionByID: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const { transaction } = await soldOrSwapByID({
			company,
			inArray: ["SALE", "BULK_SALE"],
			id: req.params.transactionId,
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Sold transaction found.",
			data: transaction,
		});
	},

	/**
	 * Retrieve a swap transaction by its ID.
	 *
	 * Steps:
	 * - Retrieve the company context from the user's information.
	 * - Use a helper function to fetch the transaction by its ID, ensuring it is of type "SWAP".
	 * - Return a JSON response containing the details of the found swap transaction.
	 */
	getSwapTransactionByID: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const { transaction } = await soldOrSwapByID({
			company,
			inArray: ["SWAP"],
			id: req.params.transactionId,
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Swap transaction found.",
			data: transaction,
		});
	},

	/**
	 * Retrieve a product by its transaction item ID.
	 *
	 * Steps:
	 * - Retrieve the company context using the authenticated user's data.
	 * - Find the transaction item by its ID using Prisma, including related product details
	 *   (and supplier) and transaction details (and customer).
	 * - If the transaction item is not found, throw a "Not Found" error.
	 * - Return a JSON response with the details of the retrieved product.
	 */
	getProductByItemID: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const product = await prisma.transactionItem.findUnique({
			where: { id: req.params.itemId },
			include: {
				Product: { include: { Supplier: true } },
				Transaction: { include: { Customer: true } },
			},
		});

		if (!product) throw new NotFoundError("Product not found.");

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Sold product found.",
			data: product,
		});
	},

	/**
	 * Update the payment balance for a sold product.
	 *
	 * Steps:
	 * - Extract the payment amount and method from the request body.
	 * - Retrieve the company context from the authenticated user.
	 * - Fetch the transaction item along with its associated payment details.
	 * - Validate that there is an outstanding balance and that the payment does not exceed this balance.
	 * - Update the payment plan:
	 *    - Increment the installment count.
	 *    - Create a new payment record with the updated total amount and remaining balance.
	 * - Return a JSON response containing the updated transaction item and payment plan details.
	 */
	updateProductBalance: async (req: Request, res: Response) => {
		const { amount, method } = req.body;
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const product = await prisma.transactionItem.findUnique({
			where: { id: req.params.itemId },
			include: {
				Transaction: {
					select: {
						Payments: {
							select: {
								payments: { orderBy: { paymentDate: "desc" } },
								installmentCount: true,
							},
						},
						customerId: true,
					},
				},
			},
		});

		if (!product) throw new NotFoundError("Product not found.");

		const isBalance =
			product?.Transaction?.Payments?.[0]?.payments?.[0]?.balanceOwed;

		if (Number(isBalance) === 0) {
			throw new BadRequestError("Balance is 0 and cannot be updated.");
		}

		const balance = Number(isBalance) - Number(amount);

		// Prevent overpayment
		if (balance < 0) {
			throw new BadRequestError("Cannot pay more than balance owed");
		}

		const plan = await prisma.paymentPlan.update({
			where: {
				id: product?.Transaction?.Payments?.[0]?.payments?.[0]?.paymentPlanId!,
			},
			data: {
				customerType:
					balance !== 0 ? CustomerType.DEBTOR : CustomerType.CUSTOMER,
				installmentCount:
					product?.Transaction?.Payments?.[0]?.installmentCount! + 1,
				payments: {
					create: {
						method: method
							? method.toUpperCase()
							: (product?.Transaction?.Payments?.[0]?.payments?.[0]
									?.method as PaymentMethod),
						totalAmount:
							Number(amount) +
							Number(
								product?.Transaction?.Payments?.[0]?.payments?.[0]?.totalAmount
							),
						balanceOwed: balance,
					},
				},
			},
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Product balance successfully updated",
			data: { product, plan },
		});
	},

	/**
	 * Update the selling price of a sold product.
	 *
	 * Steps:
	 * - Retrieve the company context from the authenticated user.
	 * - Fetch the transaction item along with its latest payment details.
	 * - Validate that there is no outstanding balance (i.e., balance owed must be zero)
	 *   to allow a price update.
	 * - Calculate the difference between the new price and the current total price.
	 * - Update the transaction item with the new price per unit and the new total price.
	 * - Adjust the latest payment record to reflect the updated total amount.
	 * - Return a JSON response indicating that the product price has been successfully updated.
	 */
	updateSoldPrice: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const product = await prisma.transactionItem.findUnique({
			where: { id: req.params.itemId },
			include: {
				Transaction: {
					select: {
						Payments: {
							select: { payments: { orderBy: { paymentDate: "desc" } } },
						},
						type: true,
					},
				},
			},
		});

		if (!product) throw new NotFoundError("Product not found.");

		const isBalance =
			product?.Transaction?.Payments?.[0]?.payments?.[0]?.balanceOwed;
		if (Number(isBalance) !== 0) {
			throw new BadRequestError(
				"Selling price cannot be updated, payment is outstanding."
			);
		}

		const latestPayment = product?.Transaction?.Payments?.[0]?.payments?.[0];
		const difference =
			Number(latestPayment?.totalAmount) - Number(product?.totalPrice);

		const plan = await prisma.transactionItem.update({
			where: { id: product!.id, transactionId: product!.transactionId },
			data: {
				pricePerUnit: Number(req.body.price) / Number(product?.quantity),
				totalPrice: Number(req.body.price),
			},
		});

		await prisma.payment.update({
			where: { id: latestPayment?.id },
			data: { totalAmount: Number(req.body.price) + difference },
		});

		res.status(StatusCodes.OK).json({
			success: true,
			msg: "Product price successfully updated",
			data: plan,
		});
	},
};
