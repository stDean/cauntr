import { StatusCodes } from "http-status-codes";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";

// Define custom error interface
interface HttpError extends Error {
	statusCode?: number;
	code?: string;
	meta?: {
		target?: string[];
		cause?: string;
		field_name?: string;
		column?: string;
		table?: string;
	};
}

export const errorHandlerMiddleware: ErrorRequestHandler = (
	err: HttpError,
	req: Request,
	res: Response,
	next: NextFunction
) => {
	let customError = {
		statusCode: err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
		msg: err.message || "Something went wrong. Please try again later",
	};

	// Handle Prisma Client Errors
	if (err.name === "PrismaClientKnownRequestError") {
		const prismaError = err as Prisma.PrismaClientKnownRequestError;

		switch (prismaError.code) {
			case "P2002": // Unique constraint
				customError.msg = `Duplicate value for field(s): [${
					err.meta?.target?.join(", ") || "unknown"
				}]`;
				customError.statusCode = StatusCodes.CONFLICT;
				break;

			case "P2025": // Not found
				customError.msg = err.meta?.cause || "Resource not found";
				customError.statusCode = StatusCodes.NOT_FOUND;
				break;

			case "P2003": // Foreign key constraint
				customError.msg = `Invalid relation: ${
					err.meta?.field_name || "unknown field"
				}`;
				customError.statusCode = StatusCodes.BAD_REQUEST;
				break;

			case "P2016": // Invalid ID format
				customError.msg = "Invalid identifier format";
				customError.statusCode = StatusCodes.BAD_REQUEST;
				break;

			case "P2000": // Column value too long
				customError.msg = `Value too long for column: ${err.meta?.column}`;
				customError.statusCode = StatusCodes.BAD_REQUEST;
				break;

			case "P2021": // Table does not exist
				customError.msg = `Database table not found: ${err.meta?.table}`;
				customError.statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
				break;

			case "P2023": // Malformed ID
				customError.msg = "Invalid ID format";
				customError.statusCode = StatusCodes.BAD_REQUEST;
				break;

			default:
				customError.msg = `Database error: ${err.code}`;
				customError.statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
				break;
		}
	}

	// Handle Prisma validation errors (invalid data types)
	if (err.name === "PrismaClientValidationError") {
		customError.msg = "Invalid input data format";
		customError.statusCode = StatusCodes.BAD_REQUEST;
	}

	res.status(customError.statusCode).json({
		msg: customError.msg,
		// Include stack trace in development only
		...(process.env.NODE_ENV === "development" && { stack: err.stack }),
	});

	next();
};
