import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

export const AuthController = {
	createCompany: async (req: Request, res: Response): Promise<void> => {
		res.status(StatusCodes.OK).json({ msg: "Company created" });
	},
	loginUser: async (req: Request, res: Response): Promise<void> => {
		res.status(StatusCodes.OK).json({ msg: "User logged in" });
	},
};
