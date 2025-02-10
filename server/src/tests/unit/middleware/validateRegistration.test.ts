import { Request, Response, NextFunction } from "express";
import { validateCompanyRegistration } from "../../../middleware/validateRegistration.m";
import { StatusCodes } from "http-status-codes";

// Mock objects
const mockRequest = (body: any) => ({ body } as Request);
const mockResponse = () => {
	const res = {} as Response;
	res.status = jest.fn().mockReturnThis();
	res.json = jest.fn().mockReturnThis();
	return res;
};
const mockNext = jest.fn() as NextFunction;

describe("validateCompanyRegistration Middleware", () => {
	let req: Request;
	let res: Response;
	let next: NextFunction;

	beforeEach(() => {
		jest.clearAllMocks();
		res = mockResponse();
		next = mockNext;
	});

	// Test 1: Valid request should pass through
	it("should call next() for valid input", () => {
		req = mockRequest({
			company_name: "Acme Corp",
			company_email: "contact@acme.com",
			password: "SecurePass123!",
			country: "USA",
		});

		validateCompanyRegistration(req, res, next);

		expect(next).toHaveBeenCalled();
		expect(res.status).not.toHaveBeenCalled();
	});

	it("should return errors for missing required fields", () => {
		req = mockRequest({}); // Empty request body

		validateCompanyRegistration(req, res, next);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			success: false,
			errors: {
				company_name: "Company name is required",
				company_email: "Company email is required",
				password: "Password is required",
				country: "Country is required",
			},
		});
	});

	it("should detect invalid email format", () => {
		req = mockRequest({
			company_name: "Test Corp",
			company_email: "invalid-email",
			password: "Pass123!",
			country: "Canada",
		});

		validateCompanyRegistration(req, res, next);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				errors: {
					company_email: "Invalid email format",
				},
			})
		);
	});

	it("should enforce password complexity rules", () => {
		req = mockRequest({
			company_name: "Test Corp",
			company_email: "test@example.com",
			password: "weakpass",
			country: "Germany",
		});

		validateCompanyRegistration(req, res, next);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				errors: {
					password: expect.stringContaining("8 characters, one uppercase"),
				},
			})
		);
	});

	it("should enforce company name length limit", () => {
		const longName = "A".repeat(101); // 101 characters
		req = mockRequest({
			company_name: longName,
			company_email: "test@example.com",
			password: "SecurePass123!",
			country: "France",
		});

		validateCompanyRegistration(req, res, next);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				errors: {
					company_name: "Company name must be less than 100 characters",
				},
			})
		);
	});

	it("should return multiple errors for multiple invalid fields", () => {
		req = mockRequest({
			company_name: "", // Invalid
			company_email: "bad-email", // Invalid
			password: "short", // Invalid
			country: "", // Invalid
		});

		validateCompanyRegistration(req, res, next);

		// Assert: Expect a response with all corresponding error messages.
		expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
		expect(res.json).toHaveBeenCalledWith({
			success: false,
			errors: {
				company_name: "Company name is required",
				company_email: "Invalid email format",
				password:
					"Password must contain at least 8 characters, one uppercase, one lowercase, one number and one special character",
				country: "Country is required",
			},
		});
		expect(next).not.toHaveBeenCalled();
	});
});
