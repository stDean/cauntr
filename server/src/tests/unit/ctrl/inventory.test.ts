import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../utils/prisma.h";
import * as InventoryCtrlModule from "../../../controllers/inventory.c";
import { BadRequestError, NotFoundError } from "../../../errors";
import {
	userNdCompany,
	getOrCreateSupplier,
	generateSKU,
} from "../../../utils/helper";
import { Condition, Product, Supplier } from "@prisma/client";

jest.mock("../../../utils/helper");
jest.mock("../../../utils/prisma.h", () => ({
	prisma: {
		company: { findUnique: jest.fn() },
		product: {
			create: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
			groupBy: jest.fn(),
			findMany: jest.fn(),
			aggregate: jest.fn(),
			delete: jest.fn(),
		},
		productDeletionEvent: {
			findMany: jest.fn(),
			deleteMany: jest.fn(),
			delete: jest.fn(),
			update: jest.fn(),
			create: jest.fn(),
		},
		users: { findUnique: jest.fn() },
		supplier: {
			create: jest.fn(),
			findUnique: jest.fn(),
			findMany: jest.fn(),
			createMany: jest.fn(),
		},
		$transaction: jest.fn((fn: Function) =>
			fn({
				product: {
					create: jest.fn(),
					update: jest.fn(),
					delete: jest.fn(),
				},
				productDeletionEvent: {
					create: jest.fn(),
					deleteMany: jest.fn(),
					update: jest.fn(),
				},
			})
		),
	},
}));

const mockRequest = (body: any = {}, params: any = {}, user: any = {}) =>
	({
		body,
		params,
		user,
	} as unknown as Request);

const mockResponse = () => {
	const res: Partial<Response> = {};
	res.status = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	return res as Response;
};

describe("Inventory Controller", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("createProduct", () => {
		const validProduct = {
			productName: "Test Product",
			brand: "Test Brand",
			productType: "ELECTRONICS",
			sellingPrice: 100,
			supplierName: "Test Supplier",
			supplierPhone: "1234567890",
		};

		it("should create a product with valid input", async () => {
			const req = mockRequest(
				validProduct,
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				user: { id: "user1" },
				company: { id: "company1", tenantId: "tenant1" },
			});
			(getOrCreateSupplier as jest.Mock).mockResolvedValue({ id: "supplier1" });
			(generateSKU as jest.Mock).mockReturnValue("SKU123");

			const mockProduct = { id: "1", ...validProduct };
			(prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);

			await InventoryCtrlModule.InventoryCtrl.createProduct(req, res);

			expect(userNdCompany).toHaveBeenCalledWith({
				email: "test@test.com",
				companyId: "1",
			});
			expect(getOrCreateSupplier).toHaveBeenCalledWith({
				supplierName: "Test Supplier",
				supplierPhone: "1234567890",
			});
			expect(prisma.product.create).toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Product created successfully",
				success: true,
				data: mockProduct,
			});
		});

		it("should return validation errors for missing required fields", async () => {
			const invalidProduct = { ...validProduct, productName: "" };
			const req = mockRequest(
				invalidProduct,
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			await InventoryCtrlModule.InventoryCtrl.createProduct(req, res);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Product creation failed.",
				success: false,
				errors: expect.arrayContaining([
					{ field: "productName", message: "productName is required" },
				]),
			});
		});

		it("should handle invalid condition value", async () => {
			const req = mockRequest(
				{
					...validProduct,
					condition: "INVALID",
				},
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(prisma.product.create as jest.Mock).mockImplementation(({ data }) =>
				Promise.resolve({ ...data, condition: Condition.NEW })
			);

			await InventoryCtrlModule.InventoryCtrl.createProduct(req, res);

			expect(prisma.product.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ condition: Condition.NEW }),
				})
			);
		});
	});

	describe("createProducts (Bulk)", () => {
		const validProducts = [
			{
				"Product Name": "Product 1",
				"Item Type": "ELECTRONICS",
				"Selling Price": 100,
				Brand: "Brand 1",
				"Supplier Name": "Supplier A",
				"Supplier Phone Number": "1234567890",
				SKU: "SKU-001",
			},
			{
				"Product Name": "Product 2",
				"Item Type": "CLOTHING",
				"Selling Price": 50,
				Brand: "Brand 2",
				"Supplier Name": "Supplier B",
				"Supplier Phone Number": "0987654321",
				SKU: "SKU-002",
			},
		];

		it("should create multiple products with valid input", async () => {
			const req = mockRequest(
				validProducts,
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				user: { id: "user1" },
				company: { id: "company1", tenantId: "tenant1" },
			});

			// Mock suppliers with correct contact/name matching products
			const mockSuppliers = [
				{ id: "supplierA", name: "Supplier A", contact: "1234567890" },
				{ id: "supplierB", name: "Supplier B", contact: "0987654321" },
			];
			(prisma.supplier.findMany as jest.Mock)
				.mockResolvedValueOnce([]) // Initial existing suppliers
				.mockResolvedValue(mockSuppliers); // After creation

			(prisma.product.create as jest.Mock).mockImplementation(({ data }) =>
				Promise.resolve({ ...data, id: Math.random().toString() })
			);

			await InventoryCtrlModule.InventoryCtrl.createProducts(req, res);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
			expect(res.json).toHaveBeenCalledWith({
				message: "All products created successfully",
				data: expect.any(Array),
				success: true,
			});
			expect(prisma.product.create).toHaveBeenCalledTimes(2);
		});

		it("should return validation errors for invalid bulk input", async () => {
			const invalidProducts = [
				validProducts[0],
				{ ...validProducts[1], Brand: "" },
			];
			const req = mockRequest(
				invalidProducts,
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			await InventoryCtrlModule.InventoryCtrl.createProducts(req, res);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Validation errors in input data",
				errors: expect.arrayContaining([{ index: 1, missing: ["Brand"] }]),
			});
		});

		it("should throw error if request body is not an array", async () => {
			const req = mockRequest(
				{ productName: "Product 1" },
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();
			await expect(
				InventoryCtrlModule.InventoryCtrl.createProducts(req as Request, res)
			).rejects.toThrow("Request body must be an array of products");
		});

		it("should handle partial creation with some failures", async () => {
			const mixedProducts = [
				validProducts[0],
				{
					...validProducts[1],
					SKU: "SKU-001",
				},
			];

			const req = mockRequest(
				mixedProducts,
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				user: { id: "user1" },
				company: { id: "company1", tenantId: "tenant1" },
			});

			// Mock suppliers
			const mockSuppliers = [
				{ id: "supplierA", name: "Supplier A", contact: "1234567890" },
			];

			(prisma.supplier.findMany as jest.Mock)
				.mockResolvedValueOnce([])
				.mockResolvedValue(mockSuppliers);

			(prisma.product.create as jest.Mock)
				.mockResolvedValueOnce({ ...validProducts[0], id: "1" }) // Success
				.mockRejectedValue(new Error("Duplicate SKU")); // Failure

			await InventoryCtrlModule.InventoryCtrl.createProducts(req, res);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.MULTI_STATUS);
			expect(res.json).toHaveBeenCalledWith({
				created: 1,
				failed: 1,
				data: expect.arrayContaining([expect.objectContaining({ id: "1" })]),
				errors: expect.arrayContaining([
					expect.objectContaining({
						product: (mixedProducts[1] as any)["Serial Number"],
						error: expect.any(String),
					}),
				]),
			});
		});
	});

	describe("getProductCountsByTypeAndBrand", () => {
		it("should return grouped product counts", async () => {
			const req = mockRequest(
				{},
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const mockGroupedData = [
				{
					productType: "ELECTRONICS",
					brand: "Brand A",
					_count: { productType: 5 },
					_sum: { quantity: 10 },
				},
			];

			(userNdCompany as jest.Mock).mockResolvedValue({
				company: { id: "company1", tenantId: "tenant1" },
			});

			(prisma.product.groupBy as jest.Mock).mockResolvedValue(mockGroupedData);

			await InventoryCtrlModule.InventoryCtrl.getProductCountsByTypeAndBrand(
				req,
				res
			);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				success: true,
				data: mockGroupedData,
			});
		});
	});

	describe("getProductsByTypeAndBrand", () => {
		it("should return products for a given type and brand", async () => {
			const req = mockRequest(
				{},
				{ type: "Type1", brand: "Brand1" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				company: { id: "company1", tenantId: "tenant1" },
			});

			(prisma.product.findMany as jest.Mock).mockResolvedValue([
				{ id: "prod1", productName: "Product 1" },
			]);

			await InventoryCtrlModule.InventoryCtrl.getProductsByTypeAndBrand(
				req as Request,
				res
			);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					data: expect.any(Array),
				})
			);
		});

		it("should throw NotFoundError if no products found", async () => {
			const req = mockRequest(
				{},
				{ type: "Type1", brand: "Brand1" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				company: { id: "company1", tenantId: "tenant1" },
			});

			(prisma.product.findMany as jest.Mock).mockResolvedValue([]);

			await expect(
				InventoryCtrlModule.InventoryCtrl.getProductsByTypeAndBrand(
					req as Request,
					res
				)
			).rejects.toThrow("No products found");
		});
	});

	describe("getProductBySKU", () => {
		it("should return a product by SKU", async () => {
			const req = mockRequest(
				{},
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			// We use a spy on the helper function. In a real test, you might refactor to allow dependency injection.
			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "comp1", tenantId: "tenant1" },
					product: { id: "prod1", productName: "Product 1" } as Product,
				});

			await InventoryCtrlModule.InventoryCtrl.getProductBySKU(
				req as Request,
				res
			);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					data: expect.objectContaining({ productName: "Product 1" }),
				})
			);
			productHelperSpy.mockRestore();
		});
	});

	describe("updateProduct", () => {
		it("should update allowed product fields", async () => {
			const req = mockRequest(
				{ productName: "Updated Name", condition: "USED" },
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "comp1", tenantId: "tenant1" },
					product: { id: "prod1", productName: "Product 1" } as Product,
				});

			(prisma.product.findUnique as jest.Mock).mockResolvedValue({
				id: "1",
				sku: "SKU123",
				companyId: "1",
				tenantId: "tenant1",
				quantity: 10,
			});

			(prisma.product.update as jest.Mock).mockResolvedValue({
				...req.body,
				condition: Condition.USED,
			});

			await InventoryCtrlModule.InventoryCtrl.updateProduct(req, res);

			expect(prisma.product.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						productName: "Updated Name",
						condition: Condition.USED,
					}),
				})
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			productHelperSpy.mockRestore();
		});

		it("should reject invalid fields", async () => {
			const req = mockRequest(
				{ supplierId: "new-supplier", sku: "INVALID" },
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "comp1", tenantId: "tenant1" },
					product: { id: "prod1", productName: "Product 1" } as Product,
				});

			await InventoryCtrlModule.InventoryCtrl.updateProduct(req, res);

			expect(prisma.product.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.not.objectContaining({ supplierId: "new-supplier" }),
				})
			);

			productHelperSpy.mockRestore();
		});
	});

	describe("softDeleteProduct", () => {
		it("should reduce quantity and create deletion event", async () => {
			const req = mockRequest(
				{ deleteQuantity: 5 },
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "comp1", tenantId: "tenant1" },
					product: { id: "prod1", productName: "Product 1" } as Product,
				});

			const mockProduct = {
				id: "1",
				sku: "SKU123",
				quantity: 10,
				companyId: "1",
				tenantId: "tenant1",
			};

			(prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);
			(prisma.$transaction as jest.Mock).mockImplementation(async cb => {
				return cb({
					product: {
						update: jest
							.fn()
							.mockResolvedValue({ ...mockProduct, quantity: 5 }),
					},
					productDeletionEvent: {
						create: jest.fn().mockResolvedValue({}),
					},
				});
			});

			await InventoryCtrlModule.InventoryCtrl.softDeleteProduct(req, res);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				success: true,
				message: "Product deleted successfully",
				data: expect.any(Object),
			});

			productHelperSpy.mockRestore();
		});

		it("should throw error if deleteQuantity is invalid", async () => {
			const req = mockRequest(
				{},
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();
			await expect(
				InventoryCtrlModule.InventoryCtrl.softDeleteProduct(req as Request, res)
			).rejects.toThrow("Invalid delete quantity provided.");
		});
	});

	describe("getSoftDeletedProductsUsingEvents", () => {
		it("should return soft-deleted products using events", async () => {
			const req = mockRequest(
				{},
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				company: { id: "1", tenantId: "tenant123" },
			});
			(prisma.product.findMany as jest.Mock).mockResolvedValue([
				{
					sku: "SKU123",
					productName: "Product 1",
					quantity: 8,
					ProductDeletionEvent: [
						{ deletionDate: new Date("2023-01-01"), quantity: 2 },
						{ deletionDate: new Date("2023-01-02"), quantity: 1 },
					],
				},
			]);
			await InventoryCtrlModule.InventoryCtrl.getSoftDeletedProductsUsingEvents(
				req,
				res
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					data: expect.objectContaining({
						products: expect.any(Array),
						softDeletedProducts: expect.any(Array),
					}),
				})
			);
		});
	});

	describe("restoreProductQuantity", () => {
		it("should throw error if restoreQuantity is invalid", async () => {
			const req = mockRequest(
				{ restoreQuantity: 0 },
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();
			await expect(
				InventoryCtrlModule.InventoryCtrl.restoreProductQuantity(
					req as Request,
					res
				)
			).rejects.toThrow("Invalid restore quantity provided.");
		});

		it("should restore product quantity and adjust deletion events", async () => {
			const req = mockRequest(
				{ restoreQuantity: 2 },
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "company123", tenantId: "tenant123" },
					product: { id: "prod1", quantity: 8 } as Product,
				});

			(prisma.productDeletionEvent.findMany as jest.Mock).mockResolvedValue([
				{ id: "event1", deletionDate: new Date("2023-01-01"), quantity: 1 },
				{ id: "event2", deletionDate: new Date("2023-01-02"), quantity: 2 },
			]);
			(prisma.$transaction as jest.Mock).mockResolvedValue({
				id: "prod1",
				quantity: 10,
			});

			await InventoryCtrlModule.InventoryCtrl.restoreProductQuantity(
				req as Request,
				res
			);

			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					data: { id: "prod1", quantity: 10 },
				})
			);
			productHelperSpy.mockRestore();
		});
	});

	describe("hardDeleteProduct", () => {
		it("should remove deletion events if product has active quantity", async () => {
			const req = mockRequest(
				{},
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					product: { id: "prod1", quantity: 5 } as any,
					company: { id: "company123", tenantId: "tenant123" },
				});
			await InventoryCtrlModule.InventoryCtrl.hardDeleteProduct(
				req as Request,
				res
			);
			expect(prisma.productDeletionEvent.deleteMany).toHaveBeenCalledWith({
				where: { productId: "prod1" },
			});
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					message:
						"Deletion events removed. Product remains with active quantity.",
				})
			);
			productHelperSpy.mockRestore();
		});

		it("should delete product if no active quantity remains", async () => {
			const req = mockRequest(
				{},
				{ sku: "SKU123" },
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			const productHelperSpy = jest
				.spyOn(InventoryCtrlModule, "productHelper")
				.mockResolvedValue({
					company: { id: "comp1", tenantId: "tenant1" },
					product: { id: "prod1", productName: "Product 1" } as Product,
				});
			await InventoryCtrlModule.InventoryCtrl.hardDeleteProduct(
				req as Request,
				res
			);
			expect(prisma.$transaction).toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					message: "Product deleted as no active quantity remains.",
				})
			);
			productHelperSpy.mockRestore();
		});
	});

	describe("bulkHardDeleteSoftDeletedProducts", () => {
		it("should throw error if no SKUs provided", async () => {
			const req = mockRequest(
				{},
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			await expect(
				InventoryCtrlModule.InventoryCtrl.bulkHardDeleteSoftDeletedProducts(
					req as Request,
					res
				)
			).rejects.toThrow("Please provide an array of SKUs to process.");
		});

		it("should process bulk deletion successfully", async () => {
			const req = mockRequest(
				{ skus: ["SKU123", "SKU456"] },
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(prisma.product.findMany as jest.Mock).mockResolvedValue([
				{ id: "prod1", sku: "SKU123", quantity: 5 },
				{ id: "prod2", sku: "SKU456", quantity: 0 },
			]);
			await InventoryCtrlModule.InventoryCtrl.bulkHardDeleteSoftDeletedProducts(
				req as Request,
				res
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					message:
						"Bulk hard deletion of soft-deleted products processed successfully.",
				})
			);
		});
	});

	describe("getInventorySummary", () => {
		it("should return correct inventory totals", async () => {
			const req = mockRequest(
				{},
				{},
				{ companyId: "1", email: "test@test.com" }
			);
			const res = mockResponse();

			(userNdCompany as jest.Mock).mockResolvedValue({
				user: { id: "user1" },
				company: { id: "company1", tenantId: "tenant1" },
			});

			(prisma.product.aggregate as jest.Mock).mockResolvedValue({
				_sum: { quantity: 100 },
			});

			(prisma.product.groupBy as jest.Mock).mockResolvedValue([
				{ productType: "ELECTRONICS" },
				{ productType: "CLOTHING" },
			]);

			(prisma.product.findMany as jest.Mock).mockResolvedValue([
				{ quantity: 10, sellingPrice: 100 },
				{ quantity: 20, sellingPrice: 50 },
			]);

			await InventoryCtrlModule.InventoryCtrl.getInventorySummary(req, res);

			expect(res.json).toHaveBeenCalledWith({
				success: true,
				data: {
					totalStockQuantity: 100,
					totalSellingPrice: 2000, // (10*100) + (20*50)
					categories: 2,
				},
			});
		});
	});
});
