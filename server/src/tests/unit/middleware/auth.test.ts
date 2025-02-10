import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthMiddleware } from "../../../middleware/auth.m";
import { UnauthenticatedError } from "../../../errors";

// Mock JWT and response methods
jest.mock("jsonwebtoken");
const mockVerify = jwt.verify as jest.Mock;

const mockRequest = (headers: any = {}) => ({ headers } as Request);
const mockResponse = () => {
	const res = {} as Response;
	res.status = jest.fn().mockReturnThis();
	res.json = jest.fn().mockReturnThis();
	return res;
};
const mockNext = jest.fn() as NextFunction;

describe("AuthMiddleware", () => {
	let req: Request;
	let res: Response;
	let next: NextFunction;

	beforeEach(() => {
		process.env.JWT_SECRET = "test_secret";
		jest.clearAllMocks();
		req = mockRequest();
		res = mockResponse();
		next = mockNext;
	});

	it("should throw error when no authorization header exists", () => {
		expect(() => AuthMiddleware(req, res, next)).toThrow(UnauthenticatedError);

		expect(next).not.toHaveBeenCalled();
	});

	it("should throw error for non-Bearer token format", () => {
		req.headers.authorization = "InvalidFormat";

		expect(() => AuthMiddleware(req, res, next)).toThrow(UnauthenticatedError);

		expect(next).not.toHaveBeenCalled();
	});

	it("should throw error when token is missing after Bearer", () => {
		req.headers.authorization = "Bearer ";

		expect(() => AuthMiddleware(req, res, next)).toThrow(UnauthenticatedError);

		expect(next).not.toHaveBeenCalled();
	});

	it("should set user payload and call next() for valid token", () => {
		const testPayload = { companyId: 1, email: "test@example.com" };
		req.headers.authorization = "Bearer validToken";
		mockVerify.mockReturnValue(testPayload);

		AuthMiddleware(req, res, next);

		expect(req.user).toEqual(testPayload);
		expect(next).toHaveBeenCalled();
		expect(mockVerify).toHaveBeenCalledWith("validToken", "test_secret");
	});

	it("should throw error for invalid token", () => {
		req.headers.authorization = "Bearer invalidToken";
		mockVerify.mockImplementation(() => {
			throw new UnauthenticatedError("Invalid or expired token provided.");
		});

		expect(() => AuthMiddleware(req, res, next)).toThrow(UnauthenticatedError);

		expect(next).not.toHaveBeenCalled();
	});

	it("should throw error when JWT_SECRET is missing", () => {
		delete (process.env as any).JWT_SECRET;
		req.headers.authorization = "Bearer validToken";

		expect(() => AuthMiddleware(req, res, next)).toThrow(
			"Invalid or expired token provided."
		);
	});
});
