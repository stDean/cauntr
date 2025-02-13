import { Request, Response } from "express";
import { paystackService } from "../../../services/paystackService";
import { AuthController } from "../../../controllers/auth.c";
import { prisma } from "../../../helpers/prisma.h";
import argon2 from "argon2";
import { StatusCodes } from "http-status-codes";
import {
	createJWT,
	generateVerificationToken,
	handleOtpForCompany,
} from "../../../helpers/authHelpers.h";
import { BadRequestError, CustomAPIError } from "../../../errors";
import { emailService } from "../../../services/emailService";

// ---------------------------------------------------------------------------
// Mocks for external modules
// ---------------------------------------------------------------------------
jest.mock("../../../helpers/prisma.h", () => ({
	prisma: {
		company: {
			create: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
		},
		otp: {
			findFirst: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
			create: jest.fn(),
		},
		user: {
			create: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
		},
	},
}));
jest.mock("../../../helpers/authHelpers.h");
jest.mock("../../../services/paystackService");
jest.mock("../../../services/emailService");
jest.mock("argon2");

// ---------------------------------------------------------------------------
// Helper functions to simulate Express Request/Response objects
// ---------------------------------------------------------------------------
const mockRequest = (body: any = {}, params: any = {}) =>
	({
		body,
		params,
	} as Request);

const mockResponse = () => {
	const res = {} as Response;
	res.status = jest.fn().mockReturnThis();
	res.json = jest.fn().mockReturnThis();
	res.cookie = jest.fn().mockReturnThis();
	res.clearCookie = jest.fn().mockReturnThis();
	return res;
};

describe("AuthController", () => {
	let req: Request;
	let res: Response;

	beforeEach(() => {
		jest.clearAllMocks();
		req = mockRequest();
		res = mockResponse();
	});

	describe("createCompany", () => {
		it("should create a company and return payment URL", async () => {
			// Arrange: Prepare request and response objects and set up mock return values.
			req.body = {
				company_name: "Test Corp",
				company_email: "test@test.com",
				password: "password",
				country: "NG",
				billingPlan: "basic",
				billingType: "month",
			};

			// Mock dependencies
			// Simulate successful hashing of password.
			(argon2.hash as jest.Mock).mockResolvedValue("hashed_password");

			// Simulate successful payment initialization.
			(paystackService.initializeTransaction as jest.Mock).mockResolvedValue({
				error: null,
				transaction: { authorization_url: "https://payment.url" },
				verify: { customer: { customer_code: "cust_123" } },
			});

			// Simulate successful company creation.
			(prisma.company.create as jest.Mock).mockResolvedValue({
				company_email: "test@test.com",
			});

			// Simulate OTP being sent successfully.
			(handleOtpForCompany as jest.Mock).mockResolvedValue(undefined);

			// Act: Call the controller method.
			await AuthController.createCompany(req, res);

			// Assert: Check that dependencies were called with the correct arguments.
			expect(argon2.hash).toHaveBeenCalledWith("password");
			expect(paystackService.initializeTransaction).toHaveBeenCalledWith({
				email: "test@test.com",
				amount: "5000",
			});
			expect(handleOtpForCompany).toHaveBeenCalledWith("test@test.com");
			expect(prisma.company.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						company_name: "Test Corp",
						company_email: "test@test.com",
						password: "hashed_password",
						country: "NG",
						subscriptionStatus: "TRIAL",
						Subscription: expect.objectContaining({
							connectOrCreate: {
								where: { payStackCustomerID: "cust_123" },
								create: {
									tier: "BASIC",
									tierType: "MONTHLY",
									payStackCustomerID: "cust_123",
									tenantId: "change",
								},
							},
						}),
					}),
				})
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: true,
					paymentUrl: "https://payment.url",
				})
			);
		});

		it("should throw an error when payment initialization fails", async () => {
			req.body = {
				/* valid body */
			};

			(paystackService.initializeTransaction as jest.Mock).mockResolvedValue({
				error: "Payment failed",
			});

			// Act & Assert: The controller should throw a CustomAPIError.
			await expect(AuthController.createCompany(req, res)).rejects.toThrow(
				"Payment gateway initialization failed"
			);
			await expect(AuthController.createCompany(req, res)).rejects.toThrow(
				CustomAPIError
			);
		});
	});

	describe("verifyOTP", () => {
		it("should verify OTP and complete registration", async () => {
			// Arrange
			req.body = { otp: "123456", company_email: "test@test.com" };

			// Simulate finding a valid OTP record.
			(prisma.otp.findFirst as jest.Mock).mockResolvedValue({
				id: 1,
				email: "test@test.com",
				otp: "123456",
				expiresAt: new Date(Date.now() + 60000),
				verified: false,
			});

			// Simulate company found with subscription details.
			(prisma.company.findUnique as jest.Mock).mockResolvedValue({
				id: 1,
				company_email: "test@test.com",
				password: "hashedPassword",
				Subscription: {
					payStackCustomerID: "cust123",
					tier: "BASIC",
					tierType: "MONTHLY",
					authorization_code: "authCode",
					transactionId: "111",
				},
			});

			// Simulate a successful subscription creation.
			(paystackService.createSubscription as jest.Mock).mockResolvedValue({
				error: null,
				subscription: {
					data: { subscription_code: "sub_code" },
					endDate: "end_date",
				},
			});

			// Simulate successful update of the company.
			(prisma.company.update as jest.Mock).mockResolvedValue({
				id: 1,
				subscriptionStatus: "ACTIVE",
				verified: true,
			});

			// Simulate OTP deletion.
			(prisma.otp.delete as jest.Mock).mockResolvedValue({});

			// Simulate successful refund.
			(paystackService.refundTransaction as jest.Mock).mockResolvedValue({
				error: null,
				msg: "Refund successful",
			});

			// Simulate creation of a new user.
			(prisma.user.create as jest.Mock).mockResolvedValue({
				email: "test@test.com",
				companyId: 1,
				role: "ADMIN",
				password: "hashedPassword",
			});

			// Simulate JWT creation.
			(createJWT as jest.Mock).mockReturnValue("jwt-token");

			// Act: Call the verifyOTP controller method.
			await AuthController.verifyOTP(req, res);

			// Assert: Verify the flow by checking that the mocks were called with the expected data.
			expect(prisma.otp.findFirst).toHaveBeenCalledWith({
				where: {
					email: "test@test.com",
					otp: "123456",
					expiresAt: { gte: expect.any(Date) },
					verified: false,
				},
			});

			expect(prisma.company.findUnique).toHaveBeenCalledWith({
				where: { company_email: "test@test.com" },
				include: {
					Subscription: {
						select: {
							payStackCustomerID: true,
							tier: true,
							tierType: true,
							authorization_code: true,
							transactionId: true,
						},
					},
				},
			});

			expect(paystackService.createSubscription).toHaveBeenCalled();
			expect(prisma.company.update).toHaveBeenCalled();
			expect(prisma.otp.delete).toHaveBeenCalled();
			expect(paystackService.refundTransaction).toHaveBeenCalled();
			expect(prisma.user.create).toHaveBeenCalled();
			expect(createJWT).toHaveBeenCalledWith({
				email: "test@test.com",
				companyId: 1,
			});
			expect(res.cookie).toHaveBeenCalledWith(
				"token",
				"jwt-token",
				expect.any(Object)
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "OTP verified",
				role: "ADMIN",
				success: true,
			});
		});

		it("should throw an error if OTP is missing", async () => {
			// Arrange: Create a request without OTP.
			req.body = { company_email: "test@test.com" };

			// Act & Assert: The controller should throw a BadRequestError.
			await expect(AuthController.verifyOTP(req, res)).rejects.toThrow(
				BadRequestError
			);
		});

		it("should throw an error if OTP record is not found", async () => {
			// Arrange: Create a request with an OTP that doesn't exist.
			req.body = { otp: "wrongOTP", company_email: "test@test.com" };

			(prisma.otp.findFirst as jest.Mock).mockResolvedValue(null);

			// Act & Assert: Expect a BadRequestError.
			await expect(AuthController.verifyOTP(req, res)).rejects.toThrow(
				BadRequestError
			);
		});
	});

	describe("resendRegistrationOTP", () => {
		it("should resend the registration OTP when the company exists", async () => {
			// Arrange: Create a request with an email.
			req.body = { email: "test@test.com" };

			// Simulate company found in the database.
			(prisma.company.findUnique as jest.Mock).mockResolvedValue({
				company_email: "test@test.com",
			});

			// Simulate the OTP check (inside the helper checkOTP) as successful.
			// (checkOTP calls prisma.otp.findFirst, update and emailService.sendVerificationOTP)
			// this test simply ensures that no error is thrown.
			(prisma.otp.findFirst as jest.Mock).mockResolvedValue({
				id: 1,
				email: "test@test.com",
				otp: "oldOTP",
				expiresAt: new Date(Date.now() + 60000),
			});
			(generateVerificationToken as jest.Mock).mockResolvedValue({
				token: "newOTP",
				expires: new Date(Date.now() + 60000),
			});
			(prisma.otp.update as jest.Mock).mockResolvedValue({});
			(emailService.sendVerificationOTP as jest.Mock).mockResolvedValue({});

			// Act: Call the controller.
			await AuthController.resendRegistrationOTP(req, res);

			// Assert: Verify that the company was found and OTP was re-sent.
			expect(prisma.company.findUnique).toHaveBeenCalledWith({
				where: { company_email: "test@test.com" },
			});
			expect(emailService.sendVerificationOTP).toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "OTP has been sent to your email.",
				success: true,
			});
		});

		it("should throw an error if the company does not exist", async () => {
			// Arrange: Create a request with an email.
			req.body = { email: "nonexistent@test.com" };

			// Simulate that no company was found.
			(prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

			// Act & Assert: Expect a BadRequestError.
			await expect(
				AuthController.resendRegistrationOTP(req, res)
			).rejects.toThrow(BadRequestError);
		});
	});

	describe("login", () => {
		it("should authenticate user and set cookie", async () => {
			// Arrange: Create a request with valid email and password.
			req.body = { email: "test@test.com", password: "password" };

			// Simulate user found in the database with a hashed password.
			(prisma.user.findUnique as jest.Mock).mockResolvedValue({
				email: "test@test.com",
				password: "hashed_password",
				companyId: 1,
				Company: {},
				role: "ADMIN",
			});

			// Simulate successful password verification.
			(argon2.verify as jest.Mock).mockResolvedValue(true);

			// Simulate JWT creation.
			(createJWT as jest.Mock).mockReturnValue("jwt-token");

			// Act: Call the login controller.
			await AuthController.login(req, res);

			// Assert: Check that the password was verified and a cookie was set.
			expect(prisma.user.findUnique).toHaveBeenCalledWith({
				where: { email: "test@test.com" },
				include: { Company: true },
			});
			expect(argon2.verify).toHaveBeenCalledWith("hashed_password", "password");
			expect(createJWT).toHaveBeenCalledWith({
				email: "test@test.com",
				companyId: 1,
			});
			expect(res.cookie).toHaveBeenCalledWith(
				"token",
				"jwt-token",
				expect.any(Object)
			);
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "User logged in successfully.",
				success: true,
			});
		});

		it("should throw an error if email or password is missing", async () => {
			// Arrange: Create a request missing the password.
			req.body = { email: "test@test.com" };

			// Act & Assert: Expect a BadRequestError.
			await expect(AuthController.login(req, res)).rejects.toThrow(
				BadRequestError
			);
		});

		it("should throw an error if no user is found", async () => {
			// Arrange: Create a request with credentials.
			req.body = { email: "nonexistent@test.com", password: "password" };

			(prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

			// Act & Assert: Expect a BadRequestError.
			await expect(AuthController.login(req, res)).rejects.toThrow(
				BadRequestError
			);
		});

		it("should throw an error if password verification fails", async () => {
			// Arrange: Create a request with invalid password.
			req.body = { email: "test@test.com", password: "wrongPassword" };

			(prisma.user.findUnique as jest.Mock).mockResolvedValue({
				email: "test@test.com",
				password: "hashedPassword",
				companyId: 1,
				Company: {},
			});
			(argon2.verify as jest.Mock).mockResolvedValue(false);

			// Act & Assert: Expect a BadRequestError.
			await expect(AuthController.login(req, res)).rejects.toThrow(
				BadRequestError
			);
		});
	});

	describe("logout", () => {
		it("should clear the token cookie and return a success message", async () => {
			// Act: Call the logout controller.
			await AuthController.logout(req, res);

			// Assert: Check that the cookie was cleared and the proper response sent.
			expect(res.clearCookie).toHaveBeenCalledWith("token");
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Logged out successfully",
				success: true,
			});
		});
	});

	describe("forgotPassword", () => {
		it("should send a reset OTP to the user email", async () => {
			// Arrange: Create a request with email and new password.
			req.body = { email: "test@test.com", password: "newpassword" };

			// Simulate finding the user.
			(prisma.user.findUnique as jest.Mock).mockResolvedValue({
				email: "test@test.com",
			});

			// Simulate generating a verification token.
			(generateVerificationToken as jest.Mock).mockResolvedValue({
				token: "resetOTP",
				expires: new Date(Date.now() + 60000),
			});

			// Simulate creating an OTP record.
			(prisma.otp.create as jest.Mock).mockResolvedValue({});

			// Simulate sending the OTP email.
			(emailService.sendVerificationOTP as jest.Mock).mockResolvedValue({});

			// Act: Call the forgotPassword controller.
			await AuthController.forgotPassword(req, res);

			// Assert:
			expect(prisma.user.findUnique).toHaveBeenCalledWith({
				where: { email: "test@test.com" },
			});
			expect(generateVerificationToken).toHaveBeenCalledWith("test@test.com");
			expect(prisma.otp.create).toHaveBeenCalled();
			expect(emailService.sendVerificationOTP).toHaveBeenCalledWith({
				email: "test@test.com",
				token: "resetOTP",
			});
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Reset OTP has been sent to your email.",
				success: true,
			});
		});

		it("should throw an error if email or password is missing", async () => {
			// Arrange: Create a request missing the email.
			req.body = { password: "newpassword" };

			// Act & Assert:
			await expect(AuthController.forgotPassword(req, res)).rejects.toThrow(
				BadRequestError
			);
		});
	});

	describe("resendOTP", () => {
		it("should resend the OTP to the user if the user exists", async () => {
			// Arrange: Create a request with an email.
			req.body = { email: "test@test.com" };

			// Simulate user found.
			(prisma.user.findUnique as jest.Mock).mockResolvedValue({
				email: "test@test.com",
			});

			// Set up OTP helper simulation (similar to resendRegistrationOTP).
			(prisma.otp.findFirst as jest.Mock).mockResolvedValue({
				id: 1,
				email: "test@test.com",
				otp: "oldOTP",
				expiresAt: new Date(Date.now() + 60000),
			});
			(generateVerificationToken as jest.Mock).mockResolvedValue({
				token: "newOTP",
				expires: new Date(Date.now() + 60000),
			});
			(prisma.otp.update as jest.Mock).mockResolvedValue({});
			(emailService.sendVerificationOTP as jest.Mock).mockResolvedValue({});

			// Act: Call the resendOTP controller.
			await AuthController.resendOTP(req, res);

			// Assert:
			expect(prisma.user.findUnique).toHaveBeenCalledWith({
				where: { email: "test@test.com" },
			});
			expect(emailService.sendVerificationOTP).toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "OTP has been sent to your email.",
				success: true,
			});
		});

		it("should throw an error if user is not found", async () => {
			// Arrange:
			req.body = { email: "nonexistent@test.com" };

			(prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

			// Act & Assert:
			await expect(AuthController.resendOTP(req, res)).rejects.toThrow(
				BadRequestError
			);
		});
	});

	describe("resetPassword", () => {
		it("should reset the password when provided a valid OTP", async () => {
			// Arrange: Create a request with email, otp, and new password.
			req.body = {
				email: "test@test.com",
				otp: "123456",
				password: "newPassword",
			};

			// Simulate a valid OTP record.
			(prisma.otp.findFirst as jest.Mock).mockResolvedValue({
				id: 1,
				email: "test@test.com",
				otp: "123456",
			});

			// Simulate successful password hashing.
			(argon2.hash as jest.Mock).mockResolvedValue("hashedNewPassword");

			// Simulate updating the user with the new password.
			(prisma.user.update as jest.Mock).mockResolvedValue({});

			// Simulate deleting the OTP record.
			(prisma.otp.delete as jest.Mock).mockResolvedValue({});

			// Act: Call the resetPassword controller.
			await AuthController.resetPassword(req, res);

			// Assert:
			expect(prisma.otp.findFirst).toHaveBeenCalledWith({
				where: { email: "test@test.com", otp: "123456" },
			});
			expect(argon2.hash).toHaveBeenCalledWith("newPassword");
			expect(prisma.user.update).toHaveBeenCalledWith({
				where: { email: "test@test.com" },
				data: { password: "hashedNewPassword" },
			});
			expect(prisma.otp.delete).toHaveBeenCalledWith({ where: { id: 1 } });
			expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				msg: "Password has been reset successfully.",
				success: true,
			});
		});

		it("should throw an error if email, otp or password is missing", async () => {
			// Arrange: Create a request missing the otp.
			req.body = {
				email: "test@test.com",
				password: "newPassword",
			};

			// Act & Assert:
			await expect(AuthController.resetPassword(req, res)).rejects.toThrow(
				BadRequestError
			);
		});

		it("should throw an error if OTP is invalid", async () => {
			// Arrange: Create a request with an invalid OTP.
			req.body = {
				email: "test@test.com",
				otp: "wrongOTP",
				password: "newPassword",
			};

			(prisma.otp.findFirst as jest.Mock).mockResolvedValue(null);

			// Act & Assert:
			await expect(AuthController.resetPassword(req, res)).rejects.toThrow(
				BadRequestError
			);
		});
	});
});
