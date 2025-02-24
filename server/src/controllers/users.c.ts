import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

export const UserCtrl = {
	createUser: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "User created successfully.", success: true });
	},
	getUsers: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "All users found.", success: true });
	},
	getUser: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "User successfully found.", success: true });
	},
	updateUserProfile: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "User updated successfully", success: true });
	},
	updateUserRole: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "User role updated successfully", success: true });
	},
	deleteUser: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "User deleted successfully", success: true });
	},

	// ===========================================================================
	// CUSTOMER
	// ===========================================================================

	createCustomer: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Customer created successfully.", success: true });
	},
	getCustomers: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "All customers found.", success: true });
	},
	getCustomer: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Customer successfully found.", success: true });
	},
	updateCustomer: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Customer updated successfully", success: true });
	},
	deleteCustomer: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Customer deleted successfully", success: true });
	},

	// ===========================================================================
	// SUPPLIER
	// ===========================================================================

	createSupplier: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Supplier created successfully.", success: true });
	},
	getSuppliers: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "All suppliers found.", success: true });
	},
	getSupplier: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Supplier successfully found.", success: true });
	},
	updateSupplier: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Supplier updated successfully", success: true });
	},
	deleteSupplier: async (req: Request, res: Response) => {
		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Supplier deleted successfully", success: true });
	},
};
