import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import argon2 from "argon2";
import { prisma } from "../../../utils/prisma";
import * as UserCtrlModule from "../../../controllers/users";
import { userNdCompany } from "../../../utils/helper";
import { CustomerType, Role } from "@prisma/client";
import { BadRequestError } from "../../../errors";

// Mock dependencies
jest.mock("argon2");
jest.mock("../../../utils/prisma.h", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    supplier: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    paymentPlan: { findFirst: jest.fn(), findMany: jest.fn() },
    product: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("../../../utils/helper");
const getUserHelper = jest.spyOn(UserCtrlModule, "getUserHelper");

const mockRequest = (body: any = {}, params: any = {}, user: any = {}) =>
  ({ body, params, user } as unknown as Request);

const mockResponse = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe("User Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (argon2.hash as jest.Mock).mockResolvedValue("hashed_password");
  });

  describe("createUser", () => {
    it("should create a new user successfully", async () => {
      const req = mockRequest(
        { email: "test@example.com", password: "password123" },
        {},
        { companyId: "1", email: "admin@company.com" }
      );
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: "user1",
        email: "test@example.com",
        companyId: "company1",
      });

      await UserCtrlModule.UserCtrl.createUser(req, res);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "test@example.com",
          password: "hashed_password",
          companyId: "company1",
          tenantId: "tenant1",
        }),
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
    });

    it("should throw error for existing user", async () => {
      const req = mockRequest(
        { email: "existing@example.com" },
        {},
        { companyId: "1" }
      );
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "existingUser",
      });

      await expect(
        UserCtrlModule.UserCtrl.createUser(req, res)
      ).rejects.toThrow("User already exists");
    });
  });

  describe("getUsers", () => {
    it("should return all company users", async () => {
      const req = mockRequest({}, {}, { companyId: "1" });
      const res = mockResponse();
      const mockUsers = [{ id: "user1" }, { id: "user2" }];

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

      await UserCtrlModule.UserCtrl.getUsers(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockUsers,
        nbHits: mockUsers.length,
      });
    });
  });

  describe("getUser", () => {
    it("should return user by ID", async () => {
      const req = mockRequest({}, { id: "user1" }, { companyId: "1" });
      const res = mockResponse();
      const mockUser = { id: "user1", name: "Test User" };

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await UserCtrlModule.UserCtrl.getUser(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockUser,
      });
    });

    it("should throw error for non-existent user", async () => {
      const req = mockRequest({}, { id: "invalid" }, { companyId: "1" });
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(UserCtrlModule.UserCtrl.getUser(req, res)).rejects.toThrow(
        "User not found"
      );
    });
  });

  describe("updateUserRole", () => {
    it("should update user role to uppercase", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      (getUserHelper as jest.Mock).mockResolvedValue({ user: { id: "user1" } });
      const req = mockRequest(
        { role: "admin" },
        { id: "user1" },
        { companyId: "company1", email: "test@example.com" }
      );
      const res = mockResponse();
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: "user1",
        role: "ADMIN",
      });

      await UserCtrlModule.UserCtrl.updateUserRole(req as Request, res);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user1", tenantId: "tenant1", companyId: "company1" },
        data: { role: "ADMIN" },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        msg: "User role updated successfully",
        success: true,
      });
    });
  });

  describe("updateUserProfile", () => {
    it("should update user profile with password hash", async () => {
      const req = mockRequest(
        { password: "newpassword", name: "Updated Name" },
        { id: "user1" },
        { companyId: "1" }
      );
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "user1",
        password: "old_hash",
      });

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback({
            user: {
              update: jest.fn().mockResolvedValue({
                id: "user1",
                name: "Updated Name",
              }),
            },
          });
        }
      );

      await UserCtrlModule.UserCtrl.updateUserProfile(req, res);

      expect(argon2.hash).toHaveBeenCalledWith("newpassword");
      expect(res.json).toHaveBeenCalledWith({
        msg: "Profile updated successfully",
        success: true,
        data: expect.any(Object),
      });
    });

    it("should retain old password if new password is empty", async () => {
      const req = mockRequest(
        { password: "", email: "updated@example.com" },
        { id: "user1" },
        { companyId: "company1", email: "test@example.com" }
      );
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      (getUserHelper as jest.Mock).mockResolvedValue({
        user: { id: "user1", email: "test@example.com", password: "oldHashed" },
      });

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb) => await cb(prisma)
      );
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: "user1",
        email: "updated@example.com",
        password: "oldHashed",
      });

      await UserCtrlModule.UserCtrl.updateUserProfile(req as Request, res);

      expect(argon2.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user1", tenantId: "tenant1", companyId: "company1" },
        data: expect.objectContaining({
          email: "updated@example.com",
          password: "oldHashed",
        }),
      });
    });
  });

  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      const req = mockRequest({}, { id: "user1" }, { companyId: "1" });
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "user1",
      });

      await UserCtrlModule.UserCtrl.deleteUser(req, res);

      expect(prisma.user.delete).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        msg: "User deleted successfully",
        success: true,
      });
    });
  });

  // --------------------------------------------------------------------------
  // CUSTOMER OPERATIONS
  // --------------------------------------------------------------------------

  describe("createCustomer", () => {
    it("should create new customer", async () => {
      const req = mockRequest(
        { name: "Test Customer", phone: "1234567890" },
        {},
        { companyId: "1" }
      );
      const res = mockResponse();

      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.customer.create as jest.Mock).mockResolvedValue({
        id: "cust1",
        name: "Test Customer",
      });

      await UserCtrlModule.UserCtrl.createCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Customer created successfully.",
        success: true,
        data: expect.any(Object),
      });
    });

    it("should throw error if customer already exists", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
        id: "cust1",
      });
      const req = mockRequest(
        { name: "John Doe", phone: "1234567890" },
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await expect(
        UserCtrlModule.UserCtrl.createCustomer(req as Request, res)
      ).rejects.toThrow(BadRequestError);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });
  });

  describe("getCustomers", () => {
    it("should return a combined list of customers", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const createdCustomers = [{ id: "cust1" }];
      (prisma.customer.findMany as jest.Mock).mockResolvedValue(
        createdCustomers
      );
      const paymentPlanCustomers = [{ Customer: { id: "cust2" } }];
      (prisma.paymentPlan.findMany as jest.Mock).mockResolvedValue(
        paymentPlanCustomers
      );
      const req = mockRequest(
        {},
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getCustomers(req as Request, res);

      expect(prisma.customer.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant1",
          companyId: "company1",
          Transaction: { none: {} },
        },
      });
      expect(prisma.paymentPlan.findMany).toHaveBeenCalledWith({
        where: { customerType: CustomerType.CUSTOMER },
        select: { Customer: true },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([{ id: "cust1" }, { id: "cust2" }]),
        nbHits: 2,
      });
    });
  });

  describe("getCustomer", () => {
    it("should return a specific customer", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const customer = {
        Customer: { name: "John Doe", phone: "1234567890" },
        Transaction: { type: "SALE", TransactionItem: [] },
        payments: [
          { balanceOwed: 10, method: "cash", paymentDate: new Date() },
        ],
      };
      (prisma.paymentPlan.findFirst as jest.Mock).mockResolvedValue(customer);
      const req = mockRequest(
        {},
        { id: "cust1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getCustomer(req as Request, res);

      expect(prisma.paymentPlan.findFirst).toHaveBeenCalledWith({
        where: { customerType: CustomerType.CUSTOMER, customerId: "cust1" },
        select: {
          Customer: { select: { name: true, phone: true } },
          Transaction: {
            select: {
              type: true,
              TransactionItem: {
                select: {
                  Product: {
                    select: {
                      productName: true,
                      sku: true,
                      serialNo: true,
                      brand: true,
                      productType: true,
                    },
                  },
                  quantity: true,
                  pricePerUnit: true,
                  totalPrice: true,
                },
              },
            },
          },
          payments: {
            select: { balanceOwed: true, method: true, paymentDate: true },
          },
        },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Customer successfully found.",
        success: true,
        data: customer,
      });
    });
  });

  describe("updateCustomer", () => {
    it("should update an existing customer", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const existingCustomer = {
        id: "cust1",
        name: "John Doe",
        phone: "1234567890",
      };
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(
        existingCustomer
      );
      const req = mockRequest(
        { name: "John Doe", phone: "1234567890", address: "New Address" },
        { id: "cust1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();
      (prisma.customer.update as jest.Mock).mockResolvedValue({ id: "cust1" });

      await UserCtrlModule.UserCtrl.updateCustomer(req as Request, res);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: "cust1", tenantId: "tenant1", companyId: "company1" },
        data: req.body,
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Customer updated successfully",
        success: true,
      });
    });
  });

  // --------------------------------------------------------------------------
  // DEBTOR OPERATIONS
  // --------------------------------------------------------------------------
  describe("getDebtors", () => {
    it("should return all debtors", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const paymentPlans = [{ Customer: { id: "cust1" } }];
      (prisma.paymentPlan.findMany as jest.Mock).mockResolvedValue(
        paymentPlans
      );
      const req = mockRequest(
        {},
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getDebtors(req as Request, res);

      expect(prisma.paymentPlan.findMany).toHaveBeenCalledWith({
        where: { customerType: CustomerType.DEBTOR },
        select: { Customer: true },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: paymentPlans.map((c) => c.Customer),
        nbHits: paymentPlans.length,
      });
    });
  });

  describe("getDebtor", () => {
    it("should return a specific debtor", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const customer = {
        Customer: { name: "John Doe", phone: "1234567890" },
        Transaction: { type: "SALE", TransactionItem: [] },
        payments: [
          { balanceOwed: 10, method: "cash", paymentDate: new Date() },
        ],
      };
      (prisma.paymentPlan.findFirst as jest.Mock).mockResolvedValue(customer);
      const req = mockRequest(
        {},
        { id: "cust1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getDebtor(req as Request, res);

      expect(prisma.paymentPlan.findFirst).toHaveBeenCalledWith({
        where: { customerType: CustomerType.DEBTOR, customerId: "cust1" },
        select: {
          Customer: { select: { name: true, phone: true } },
          Transaction: {
            select: {
              type: true,
              TransactionItem: {
                select: {
                  Product: {
                    select: {
                      productName: true,
                      sku: true,
                      serialNo: true,
                      brand: true,
                      productType: true,
                    },
                  },
                  quantity: true,
                  pricePerUnit: true,
                  totalPrice: true,
                },
              },
            },
          },
          payments: {
            select: { balanceOwed: true, method: true, paymentDate: true },
          },
        },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Customer successfully found.",
        success: true,
        data: customer,
      });
    });
  });

  // --------------------------------------------------------------------------
  // SUPPLIER OPERATIONS
  // --------------------------------------------------------------------------
  describe("createSupplier", () => {
    it("should create a new supplier if one doesn't exist", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);
      const newSupplier = {
        id: "supplier1",
        name: "Supplier A",
        contact: "1234567890",
      };
      (prisma.supplier.create as jest.Mock).mockResolvedValue(newSupplier);
      const req = mockRequest(
        { name: "Supplier A", contact: "1234567890" },
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.createSupplier(req as Request, res);

      expect(prisma.supplier.findUnique).toHaveBeenCalledWith({
        where: {
          name_contact: { name: "Supplier A", contact: "1234567890" },
          tenantId: "tenant1",
          companyId: "company1",
        },
      });
      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Supplier A",
          contact: "1234567890",
          tenantId: "tenant1",
          companyId: "company1",
        }),
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Supplier created successfully.",
        success: true,
        data: newSupplier,
      });
    });

    it("should throw an error if supplier already exists", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({
        id: "supplier1",
      });
      const req = mockRequest(
        { name: "Supplier A", contact: "1234567890" },
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await expect(
        UserCtrlModule.UserCtrl.createSupplier(req as Request, res)
      ).rejects.toThrow(BadRequestError);
      expect(prisma.supplier.create).not.toHaveBeenCalled();
    });
  });

  describe("getSuppliers", () => {
    it("should return a list of suppliers", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const suppliers = [{ id: "supplier1" }, { id: "supplier2" }];
      (prisma.supplier.findMany as jest.Mock).mockResolvedValue(suppliers);
      const req = mockRequest(
        {},
        {},
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getSuppliers(req as Request, res);

      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant1", companyId: "company1" },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "All suppliers found.",
        success: true,
        data: suppliers,
        nbHits: suppliers.length,
      });
    });
  });

  describe("getSupplier", () => {
    it("should return a specific supplier", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const supplier = { id: "supplier1", name: "Supplier A" };
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(supplier);
      const req = mockRequest(
        {},
        { id: "supplier1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.getSupplier(req as Request, res);

      expect(prisma.supplier.findUnique).toHaveBeenCalledWith({
        where: { id: "supplier1", tenantId: "tenant1", companyId: "company1" },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({ data: supplier, success: true });
    });
  });

  describe("updateSupplier", () => {
    it("should update an existing supplier", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const existingSupplier = { id: "supplier1", name: "Supplier A" };
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(
        existingSupplier
      );
      const req = mockRequest(
        { name: "Updated Supplier A" },
        { id: "supplier1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();
      const updatedSupplier = { id: "supplier1", name: "Updated Supplier A" };
      (prisma.supplier.update as jest.Mock).mockResolvedValue(updatedSupplier);

      await UserCtrlModule.UserCtrl.updateSupplier(req as Request, res);

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: "supplier1", tenantId: "tenant1", companyId: "company1" },
        data: req.body,
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        data: updatedSupplier,
        success: true,
      });
    });
  });

  describe("deleteSupplier", () => {
    it("should delete supplier if no products exist", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const supplier = { id: "supplier1", products: [] };
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(supplier);
      (prisma.supplier.delete as jest.Mock).mockResolvedValue(supplier);
      const req = mockRequest(
        {},
        { id: "supplier1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.deleteSupplier(req as Request, res);

      expect(prisma.supplier.delete).toHaveBeenCalledWith({
        where: { id: "supplier1", tenantId: "tenant1", companyId: "company1" },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Supplier deleted successfully",
        success: true,
      });
    });

    it("should update products and delete supplier if products exist", async () => {
      (userNdCompany as jest.Mock).mockResolvedValue({
        company: { id: "company1", tenantId: "tenant1" },
      });
      const supplier = {
        id: "supplier1",
        products: [{ quantity: 2 }, { quantity: 3 }],
      };
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(supplier);
      (prisma.product.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.supplier.delete as jest.Mock).mockResolvedValue(supplier);
      const req = mockRequest(
        {},
        { id: "supplier1" },
        { companyId: "company1", email: "test@test.com" }
      );
      const res = mockResponse();

      await UserCtrlModule.UserCtrl.deleteSupplier(req as Request, res);

      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: {
          supplierId: "supplier1",
          companyId: "company1",
          tenantId: "tenant1",
        },
        data: { supplierId: null },
      });
      expect(prisma.supplier.delete).toHaveBeenCalledWith({
        where: { id: "supplier1", tenantId: "tenant1", companyId: "company1" },
      });
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        msg: "Supplier deleted successfully",
        success: true,
      });
    });
  });
});
