import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../utils/prisma.h";
import * as TransactionModule from "../../../controllers/transaction.c";
import { BadRequestError, NotFoundError } from "../../../errors";
import {
	productUtils,
	transactionUtils,
	paymentUtils,
	customerUtils,
	validationUtils,
} from "../../../utils/helperUtils";
import { userNdCompany } from "../../../utils/helper";

jest.mock("../../../utils/prisma.h", () => ({
	prisma: {
		$transaction: jest.fn(),
		transactionItem: { findUnique: jest.fn(), update: jest.fn() },
		paymentPlan: { update: jest.fn() },
		payment: { update: jest.fn() },
	},
}));
jest.mock("../../../utils/helper");
jest.mock("../../../utils/helperUtils");

const handleIncoming = jest.spyOn(TransactionModule, "handleIncomingProduct");
const handleOugoing = jest.spyOn(TransactionModule, "handleOutgoingProduct");
const soldOrSwapByID = jest.spyOn(TransactionModule, "soldOrSwapByID");
const getSoldOrSwapProducts = jest.spyOn(
	TransactionModule,
	"getSoldOrSwapProducts"
);

describe("Transactions Controller", () => {
	let mockReq: Partial<Request>;
	let mockRes: Partial<Response>;
	const mockUser = { id: 1, email: "test@example.com" };
	const mockCompany = { id: 1, name: "Test Company" };

	beforeEach(() => {
		mockReq = {
			user: mockUser,
			params: { sku: "TEST-SKU" },
			body: {
				transaction: { quantity: 2, price: 100 },
				payment: { balanceOwed: 0, frequency: "ONCE" },
			},
		};
		mockRes = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn(),
		};

		// Reset all mocks
		jest.clearAllMocks();

		// Setup common mocks
		(userNdCompany as jest.Mock).mockResolvedValue({
			company: mockCompany,
			user: mockUser,
		});

		(prisma.$transaction as jest.Mock).mockImplementation(callback =>
			callback(prisma)
		);
	});

	describe("sellProduct", () => {
		const mockProduct = {
			id: 1,
			sku: "TEST-SKU",
			quantity: 10,
			price: 100,
			companyId: mockCompany.id,
		};

		it("should successfully sell a product", async () => {
			// Mock product operations
			(productUtils.findProductBySKU as jest.Mock).mockResolvedValue(
				mockProduct
			);
			(productUtils.updateProductQuantity as jest.Mock).mockResolvedValue({
				...mockProduct,
				quantity: 8,
			});

			// Mock transaction creation
			const mockTransaction = { id: 1, type: "SALE" };
			(transactionUtils.createTransaction as jest.Mock).mockResolvedValue(
				mockTransaction
			);

			// Mock payment plan
			const mockPaymentPlan = { id: 1 };
			(paymentUtils.createPaymentPlan as jest.Mock).mockResolvedValue(
				mockPaymentPlan
			);

			await TransactionModule.TransactionsCtrl.sellProduct(
				mockReq as Request,
				mockRes as Response
			);

			expect(productUtils.findProductBySKU).toHaveBeenCalledWith(
				prisma,
				"TEST-SKU",
				mockCompany
			);
			expect(productUtils.validateProductStock).toHaveBeenCalledWith(
				mockProduct,
				2
			);
			expect(transactionUtils.createTransaction).toHaveBeenCalledWith(
				prisma,
				"SALE",
				expect.objectContaining({
					company: mockCompany,
					items: expect.arrayContaining([
						expect.objectContaining({
							productId: 1,
							quantity: 2,
							pricePerUnit: 100,
						}),
					]),
				})
			);
			expect(mockRes.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(mockRes.json).toHaveBeenCalledWith({
				success: true,
				data: expect.objectContaining({
					transaction: mockTransaction,
					paymentPlan: mockPaymentPlan,
				}),
			});
		});

		it("should handle customer creation when details are provided", async () => {
			const mockCustomer = { id: 1, name: "Test Customer" };
			mockReq.body.customerDetails = { name: "Test Customer" };

			(productUtils.findProductBySKU as jest.Mock).mockResolvedValue(
				mockProduct
			);
			(productUtils.updateProductQuantity as jest.Mock).mockResolvedValue({
				...mockProduct,
				quantity: 8,
			});

			(customerUtils.upsertCustomer as jest.Mock).mockResolvedValue(
				mockCustomer
			);

			const mockTransaction = { id: 1, type: "SALE" };
			(transactionUtils.createTransaction as jest.Mock).mockResolvedValue(
				mockTransaction
			);

			await TransactionModule.TransactionsCtrl.sellProduct(
				mockReq as Request,
				mockRes as Response
			);

			expect(customerUtils.upsertCustomer).toHaveBeenCalledWith(
				prisma,
				{ name: "Test Customer" },
				mockCompany
			);
			expect(transactionUtils.createTransaction).toHaveBeenCalledWith(
				prisma,
				"SALE",
				expect.objectContaining({
					customerId: 1,
				})
			);
		});

		it("should handle insufficient stock", async () => {
			(productUtils.findProductBySKU as jest.Mock).mockResolvedValue(
				mockProduct
			);
			(productUtils.validateProductStock as jest.Mock).mockImplementation(
				() => {
					throw new BadRequestError("Insufficient stock");
				}
			);

			await expect(
				TransactionModule.TransactionsCtrl.sellProduct(
					mockReq as Request,
					mockRes as Response
				)
			).rejects.toThrow(BadRequestError);

			expect(mockRes.json).not.toHaveBeenCalled();
		});

		it("should handle product not found", async () => {
			(productUtils.findProductBySKU as jest.Mock).mockRejectedValue(
				new NotFoundError("Product not found")
			);

			await expect(
				TransactionModule.TransactionsCtrl.sellProduct(
					mockReq as Request,
					mockRes as Response
				)
			).rejects.toThrow(NotFoundError);
		});

		it("should validate required fields", async () => {
			delete mockReq.body.transaction;

			// The error will now come from validateRequiredFields
			(validationUtils.validateRequiredFields as jest.Mock).mockImplementation(
				() => {
					throw new BadRequestError("Missing required fields");
				}
			);

			await expect(
				TransactionModule.TransactionsCtrl.sellProduct(
					mockReq as Request,
					mockRes as Response
				)
			).rejects.toThrow(BadRequestError);

			// Verify validation was called
			expect(validationUtils.validateRequiredFields).toHaveBeenCalledWith(
				mockReq.body,
				["transaction"]
			);
		});
	});

	describe("sellProducts (Bulk)", () => {
		const mockProducts = [
			{ id: 1, sku: "SKU1", quantity: 10 },
			{ id: 2, sku: "SKU2", quantity: 5 },
		];

		beforeEach(() => {
			mockReq.body = {
				transactions: [
					{ sku: "SKU1", quantity: 2, sellingPrice: 100 },
					{ sku: "SKU2", quantity: 1, sellingPrice: 50 },
				],
				payment: { balanceOwed: 0, frequency: "weekly" },
			};
		});

		it("should process bulk sales successfully", async () => {
			(validationUtils.validateRequiredFields as jest.Mock).mockReturnValue(
				true
			);

			(productUtils.findProductBySKU as jest.Mock)
				.mockResolvedValueOnce(mockProducts[0])
				.mockResolvedValueOnce(mockProducts[1]);

			(validationUtils.validateStockQuantities as jest.Mock).mockReturnValue(
				true
			);

			const mockTransaction = { id: 2, type: "BULK_SALE" };
			(transactionUtils.createTransaction as jest.Mock).mockResolvedValue(
				mockTransaction
			);

			await TransactionModule.TransactionsCtrl.sellProducts(
				mockReq as Request,
				mockRes as Response
			);

			expect(validationUtils.validateRequiredFields).toHaveBeenCalledWith(
				mockReq.body,
				["transactions"]
			);
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ transaction: mockTransaction }),
				})
			);
		});

		it("should reject invalid bulk transactions", async () => {
			delete mockReq.body.transactions;

			(validationUtils.validateRequiredFields as jest.Mock).mockImplementation(
				() => {
					throw new BadRequestError("Missing transactions");
				}
			);

			await expect(
				TransactionModule.TransactionsCtrl.sellProducts(
					mockReq as Request,
					mockRes as Response
				)
			).rejects.toThrow(BadRequestError);
		});
	});

	describe("swapProduct", () => {
		beforeEach(() => {
			mockReq.body = {
				outgoing: { sku: "OLD-SKU", quantity: 2 },
				incoming: [{ sku: "NEW-SKU", quantity: 1 }],
				payment: { balanceOwed: 0 },
			};
		});

		it("should handle product swaps", async () => {
			const mockOutgoing = { id: 1, sku: "OLD-SKU", quantity: 10 };
			const mockIncoming = { id: 2, sku: "NEW-SKU", quantity: 5 };

			handleIncoming.mockResolvedValue(mockIncoming as any);
			handleOugoing.mockResolvedValue(mockOutgoing as any);

			(transactionUtils.createSwapTransaction as jest.Mock).mockResolvedValue({
				id: 3,
				type: "SWAP",
			});

			await TransactionModule.TransactionsCtrl.swapProduct(
				mockReq as Request,
				mockRes as Response
			);

			expect(transactionUtils.createSwapTransaction).toHaveBeenCalled();
			expect(mockRes.json).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ transaction: expect.anything() }),
				})
			);
		});

		it("should validate swap requirements", async () => {
			delete mockReq.body.outgoing.sku;

			await expect(
				TransactionModule.TransactionsCtrl.swapProduct(
					mockReq as Request,
					mockRes as Response
				)
			).rejects.toThrow(BadRequestError);
		});
	});

	describe("GET Methods", () => {
		const mockTransactions = [
			{ id: 1, type: "SALE" },
			{ id: 2, type: "BULK_SALE" },
		];

		describe("getSoldProducts", () => {
			it("should fetch sales transactions", async () => {
				getSoldOrSwapProducts.mockResolvedValue({
					transactions: mockTransactions,
				} as any);

				await TransactionModule.TransactionsCtrl.getSoldProducts(
					mockReq as Request,
					mockRes as Response
				);

				expect(getSoldOrSwapProducts).toHaveBeenCalledWith(
					expect.objectContaining({
						inArray: ["SALE", "BULK_SALE"],
					})
				);
				expect(mockRes.json).toHaveBeenCalledWith(
					expect.objectContaining({
						nbHits: 2,
					})
				);
			});
		});

		describe("getSwapProducts", () => {
			it("should fetch swap transactions", async () => {
				(getSoldOrSwapProducts as jest.Mock).mockResolvedValue({
					transactions: [mockTransactions[0]],
				});

				await TransactionModule.TransactionsCtrl.getSwapProducts(
					mockReq as Request,
					mockRes as Response
				);

				expect(getSoldOrSwapProducts).toHaveBeenCalledWith(
					expect.objectContaining({
						inArray: ["SWAP"],
					})
				);
			});
		});

		describe("getSoldTransactionByID", () => {
			it("should retrieve specific sale transaction", async () => {
				(soldOrSwapByID as jest.Mock).mockResolvedValue({
					transaction: mockTransactions[0],
				});

				mockReq.params = { transactionId: "1" };

				await TransactionModule.TransactionsCtrl.getSoldTransactionByID(
					mockReq as Request,
					mockRes as Response
				);

				expect(mockRes.json).toHaveBeenCalledWith(
					expect.objectContaining({
						data: mockTransactions[0],
					})
				);
			});
		});

		describe("getProductByItemID", () => {
			it("should fetch transaction item details", async () => {
				const mockItem = {
					id: 1,
					Product: { name: "Test Product" },
					Transaction: { Customer: { name: "Test Customer" } },
				};

				(prisma.transactionItem.findUnique as jest.Mock).mockResolvedValue(
					mockItem
				);

				await TransactionModule.TransactionsCtrl.getProductByItemID(
					{ ...mockReq, params: { itemId: "1" } } as Request,
					mockRes as Response
				);

				expect(prisma.transactionItem.findUnique).toHaveBeenCalledWith(
					expect.objectContaining({
						where: { id: "1" },
						include: {
							Product: { include: { Supplier: true } },
							Transaction: { include: { Customer: true } },
						},
					})
				);
			});
		});
	});

	describe("Update Methods", () => {
		const mockPayment = {
			payments: [{ balanceOwed: 100, totalAmount: 200 }],
			installmentCount: 1,
		};

		describe("updateProductBalance", () => {
			beforeEach(() => {
				mockReq.params = { itemId: "1" };
				mockReq.body = { amount: 50, method: "CASH" };
			});

			it("should update payment balance", async () => {
				(prisma.transactionItem.findUnique as jest.Mock).mockResolvedValue({
					Transaction: { Payments: [mockPayment] },
				});

				await TransactionModule.TransactionsCtrl.updateProductBalance(
					mockReq as Request,
					mockRes as Response
				);

				expect(prisma.paymentPlan.update).toHaveBeenCalled();
				expect(mockRes.json).toHaveBeenCalledWith(
					expect.objectContaining({
						msg: "Product balance successfully updated",
					})
				);
			});

			it("should prevent overpayment", async () => {
				mockReq.body.amount = 150;

				(prisma.transactionItem.findUnique as jest.Mock).mockResolvedValue({
					Transaction: { Payments: [mockPayment] },
				});

				await expect(
					TransactionModule.TransactionsCtrl.updateProductBalance(
						mockReq as Request,
						mockRes as Response
					)
				).rejects.toThrow("Cannot pay more than balance owed");
			});
		});

		describe("updateSoldPrice", () => {
			it("should update price with zero balance", async () => {
				(prisma.transactionItem.findUnique as jest.Mock).mockResolvedValue({
					quantity: 2,
					Transaction: {
						Payments: [{ payments: [{ balanceOwed: 0 }] }],
						type: "SALE",
					},
				});

				mockReq.body = { price: 200 };

				await TransactionModule.TransactionsCtrl.updateSoldPrice(
					mockReq as Request,
					mockRes as Response
				);

				expect(prisma.transactionItem.update).toHaveBeenCalledWith(
					expect.objectContaining({
						data: { pricePerUnit: 100, totalPrice: 200 },
					})
				);
			});

			it("should block price update with outstanding balance", async () => {
				(prisma.transactionItem.findUnique as jest.Mock).mockResolvedValue({
					Transaction: {
						Payments: [{ payments: [{ balanceOwed: 50 }] }],
					},
				});

				await expect(
					TransactionModule.TransactionsCtrl.updateSoldPrice(
						mockReq as Request,
						mockRes as Response
					)
				).rejects.toThrow("outstanding");
			});
		});
	});
});
