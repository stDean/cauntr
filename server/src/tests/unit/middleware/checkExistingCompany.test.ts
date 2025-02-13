import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../helpers/prisma.h";
import { handleOtpForCompany } from "../../../helpers/authHelpers.h";
import { CustomAPIError } from "../../../errors";
import { checkExistingCompany } from "../../../middleware/checkExistingCompany.m";

jest.mock("../../../helpers/prisma.h", () => ({
	prisma: {
		company: {
			findUnique: jest.fn(),
			delete: jest.fn(),
		},
	},
}));

jest.mock("../../../helpers/authHelpers.h");

const mockRequest = (body: any = {}) => ({ body } as Request);
const mockResponse = () => {
	const res = {} as Response;
	res.status = jest.fn().mockReturnThis();
	res.json = jest.fn().mockReturnThis();
	return res;
};
const mockNext = jest.fn() as NextFunction;

describe("checkExistingCompany Middleware", () => {
	let req: Request;
	let res: Response;
	let next: NextFunction;

	beforeEach(() => {
		jest.clearAllMocks();
		req = mockRequest();
		res = mockResponse();
		next = mockNext;
	});

	describe("when company does NOT exist", () => {
		it("should proceed to next middleware", async () => {
			// Arrange
			req.body.company_email = "new@company.com";

			// Simulate no company found
			(prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

			// Act
			await checkExistingCompany(req, res, next);

			// Assert
			expect(prisma.company.findUnique).toHaveBeenCalledWith({
				where: { company_email: "new@company.com" },
				include: { Subscription: { select: { payStackCustomerID: true } } },
			});
			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
			expect(res.json).not.toHaveBeenCalled();
		});
	});

	describe("when company exists", () => {
		describe("unverified with pending payment and no customer ID", () => {
			it("should send OTP and return 200", async () => {
				// Arrange
				const mockCompany = {
					company_email: "existing@company.com",
					verified: false,
					subscriptionStatus: "TRIAL",
					Subscription: { payStackCustomerID: null },
					id: 1,
				};

				req.body.company_email = mockCompany.company_email;
				(prisma.company.findUnique as jest.Mock).mockResolvedValue(mockCompany);

				// Act
				await checkExistingCompany(req, res, next);

				// Assert: Check that the OTP helper is called and the response is sent.
				expect(handleOtpForCompany).toHaveBeenCalledWith(
					mockCompany.company_email
				);
				expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
				expect(res.json).toHaveBeenCalledWith({
					message: "Check your email for OTP",
					success: true,
				});
				// next() should not be called when a response is sent
				expect(next).not.toHaveBeenCalled();
			});
		});

		describe("verified with pending payment", () => {
			it("should return 400 error", async () => {
				const mockCompany = {
					company_email: "existing@company.com",
					verified: true,
					subscriptionStatus: "TRIAL",
					Subscription: { payStackCustomerID: "cust_123" },
					id: 1,
				};

				req.body.company_email = mockCompany.company_email;
				(prisma.company.findUnique as jest.Mock).mockResolvedValue(mockCompany);

				await checkExistingCompany(req, res, next);

				expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
				expect(res.json).toHaveBeenCalledWith({
					success: false,
					message: "Company already exists. Please update your payment method.",
				});
				expect(next).not.toHaveBeenCalled();
			});
		});

		describe("does not match special conditions", () => {
			it("should delete company and proceed", async () => {
				// Arrange:
				const mockCompany = {
					company_email: "existing@company.com",
					verified: true,
					subscriptionStatus: "ACTIVE",
					Subscription: { payStackCustomerID: "cust_123" },
					id: 1,
				};

				req.body.company_email = mockCompany.company_email;
				(prisma.company.findUnique as jest.Mock).mockResolvedValue(mockCompany);
				(prisma.company.delete as jest.Mock).mockResolvedValue(mockCompany);

				// Act:
				await checkExistingCompany(req, res, next);

				// Asset:
				expect(prisma.company.delete).toHaveBeenCalledWith({
					where: { id: mockCompany.id },
				});
				expect(next).toHaveBeenCalled();
				expect(res.status).not.toHaveBeenCalled();
				expect(res.json).not.toHaveBeenCalled();
			});
		});
	});

	describe("error handling", () => {
		it("should throw CustomAPIError on database failure", async () => {
			// Arrange:
			req.body.company_email = "test@company.com";
			(prisma.company.findUnique as jest.Mock).mockRejectedValue(
				new Error("DB Error")
			);

			// Act & Assert:
			await expect(checkExistingCompany(req, res, next)).rejects.toThrow(
				CustomAPIError
			);

			expect(next).not.toHaveBeenCalled();
		});
	});
});
