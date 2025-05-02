import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UnauthenticatedError } from "../errors/index.js";

declare module "express" {
	export interface Request {
		user?: any;
	}
}

export const AuthMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer")) {
		throw new UnauthenticatedError("Invalid Authentication");
	}

	const token = authHeader.split(" ")[1];
	if (!token) {
		throw new UnauthenticatedError("No token provided.");
	}

	const payload = jwt.verify(token, process.env.JWT_SECRET);
	if (!payload) {
		throw new UnauthenticatedError("Invalid or expired token provided.");
	}
  
	req.user = payload;
	next();
};
