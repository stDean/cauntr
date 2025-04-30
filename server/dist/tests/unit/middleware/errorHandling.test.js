import { StatusCodes } from "http-status-codes";
import { errorHandlerMiddleware } from "../../../middleware/error-handling";
// Mock response object methods
const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};
// Mock next function
const mockNext = jest.fn();
describe("errorHandlerMiddleware", () => {
    let req;
    let res;
    let originalEnv;
    beforeEach(() => {
        req = {};
        res = mockResponse();
        originalEnv = process.env.NODE_ENV ?? "development";
    });
    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.clearAllMocks();
    });
    describe("Prisma Client Errors", () => {
        it("should handle P2002 (unique constraint violation)", () => {
            const error = {
                name: "PrismaClientKnownRequestError",
                code: "P2002",
                meta: { target: ["email"] },
                message: "Unique constraint failed",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.CONFLICT);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Duplicate entry - resource already exists",
            });
        });
        it("should handle P2025 (record not found)", () => {
            const error = {
                name: "PrismaClientKnownRequestError",
                code: "P2025",
                meta: { cause: "User not found" },
                message: "Record not found",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
            expect(res.json).toHaveBeenCalledWith({
                msg: "User not found",
            });
        });
        it("should handle P2003 (foreign key constraint)", () => {
            const error = {
                name: "PrismaClientKnownRequestError",
                code: "P2003",
                meta: { field_name: "authorId" },
                message: "Foreign key constraint failed",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Invalid relation: authorId",
            });
        });
        it("should handle PrismaClientKnownRequestError with code P2016 (invalid ID format)", () => {
            // Arrange: Create an error simulating an invalid identifier format.
            const error = {
                name: "PrismaClientKnownRequestError",
                message: "Invalid id format",
                code: "P2016",
                meta: {},
            };
            // Act: Call the middleware.
            errorHandlerMiddleware(error, req, res, mockNext);
            // Assert: Expect a BAD_REQUEST status and the standardized error message.
            expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Invalid identifier format",
            });
        });
        it("should handle PrismaClientKnownRequestError with code P2000 (column value too long)", () => {
            // Arrange: Create an error simulating a too-long column value.
            const error = {
                name: "PrismaClientKnownRequestError",
                message: "Value too long",
                code: "P2000",
                meta: { column: "username" },
            };
            // Act: Call the middleware.
            errorHandlerMiddleware(error, req, res, mockNext);
            // Assert: Expect a BAD_REQUEST status with an error message:referencing the column.
            expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Value too long for column: username",
            });
        });
        it("should handle PrismaClientKnownRequestError with code P2021 (table does not exist)", () => {
            // Arrange: Create an error simulating a missing database table.
            const error = {
                name: "PrismaClientKnownRequestError",
                message: "Table not found",
                code: "P2021",
                meta: { table: "users" },
            };
            // Act: Call the middleware.
            errorHandlerMiddleware(error, req, res, mockNext);
            // Assert: Expect an INTERNAL_SERVER_ERROR status and a message:referencing the missing table.
            expect(res.status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Database table not found: users",
            });
        });
        it("should handle PrismaClientKnownRequestError with code P2023 (malformed ID)", () => {
            // Arrange: Create an error simulating a malformed ID.
            const error = {
                name: "PrismaClientKnownRequestError",
                message: "Malformed ID",
                code: "P2023",
                meta: {},
            };
            // Act: Call the middleware.
            errorHandlerMiddleware(error, req, res, mockNext);
            // Assert: Expect a BAD_REQUEST status and a standardized invalid ID format message.
            expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Invalid ID format",
            });
        });
    });
    describe("Validation Errors", () => {
        it("should handle Prisma validation errors", () => {
            const error = {
                name: "PrismaClientValidationError",
                message: "Invalid input data",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Invalid input data format",
            });
        });
    });
    describe("General Errors", () => {
        it("should use custom status code and message:when provided", () => {
            const error = {
                statusCode: StatusCodes.UNAUTHORIZED,
                message: "Authentication failed",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.UNAUTHORIZED);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Authentication failed",
            });
        });
        it("should default to 500 for unknown errors", () => {
            const error = new Error("Something went wrong. Please try again later");
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Something went wrong. Please try again later",
            });
        });
    });
    describe("Environment Handling", () => {
        it("should include stack trace in development", () => {
            process.env.NODE_ENV = "development";
            const error = new Error("Test error");
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                msg: expect.any(String),
                stack: expect.any(String),
            }));
        });
        it("should exclude stack trace in production", () => {
            process.env.NODE_ENV = "production";
            const error = new Error("Test error");
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.json).toHaveBeenCalledWith({
                msg: expect.any(String),
            });
        });
    });
    describe("Edge Cases", () => {
        it("should handle missing meta data in Prisma errors", () => {
            const error = {
                name: "PrismaClientKnownRequestError",
                code: "P2002", // Unique constraint
                message: "Unique constraint failed",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Duplicate entry - resource already exists",
            });
        });
        it("should handle unknown Prisma error codes", () => {
            const error = {
                name: "PrismaClientKnownRequestError",
                code: "UNKNOWN_CODE",
                message: "Unknown error",
            };
            errorHandlerMiddleware(error, req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res.json).toHaveBeenCalledWith({
                msg: "Database error: UNKNOWN_CODE",
            });
        });
    });
});
