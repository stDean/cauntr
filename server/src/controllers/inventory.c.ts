import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

export const InventoryCtrl = {
	createInventoryItem: (req: Request, res: Response) => {
		res.status(StatusCodes.CREATED).json({ msg: "Inventory item(s) created" });
	},
};
