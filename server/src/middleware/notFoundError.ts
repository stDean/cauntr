import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

export const notFound = (req: Request, res: Response, next: NextFunction) => {
	res.status(StatusCodes.NOT_FOUND).send("Route does not exist");
	next();
};
