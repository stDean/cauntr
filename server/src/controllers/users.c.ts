import argon2 from "argon2";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors";
import { userNdCompany } from "../utils/helper";
import { prisma } from "../utils/prisma.h";
import { Customer, CustomerType, Role } from "@prisma/client";

const getUserHelper = async ({
	id,
	company,
}: {
	id: string;
	company: { tenantId: string; id: string };
}) => {
	const user = await prisma.user.findUnique({
		where: {
			id: id,
			tenantId: company.tenantId,
			companyId: company.id,
		},
	});
	if (!user) throw new NotFoundError("User not found.");

	return { user };
};

export const UserCtrl = {
	/**
	 * Create a new user.
	 * - Retrieve the company information from the authenticated user's context.
	 * - Check if a user with the provided email already exists within that company/tenant.
	 * - If so, throw a BadRequestError.
	 * - Otherwise, hash the provided password.
	 * - Create a new user record in the database using the hashed password and request data.
	 * - Return a success response with the new user data.
	 */
	createUser: async (req: Request, res: Response) => {
		// Retrieve company info based on authenticated user context
		const { company } = await userNdCompany(req.user);

		// Check if a user with the provided email already exists in this company and tenant
		const existingUser = await prisma.user.findUnique({
			where: {
				email: req.body.email,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});
		if (existingUser) throw new BadRequestError("User already exists.");

		// Hash the password from the request body
		const hashedPassword = await argon2.hash(req.body.password);

		// Create the new user in the database with the hashed password and company details
		const newUser = await prisma.user.create({
			data: {
				...req.body,
				password: hashedPassword,
				companyId: company.id,
				tenantId: company.tenantId,
			},
		});

		// Send a success response with the created user
		res.status(StatusCodes.CREATED).json({
			msg: "User created successfully.",
			success: true,
			data: newUser,
		});
	},

	/**
	 * Get all users.
	 * - Retrieve the company info from the authenticated user.
	 * - Fetch all users belonging to the current company and tenant.
	 * - Return the list of users along with the count.
	 */
	getUsers: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		// Retrieve users filtered by tenant and company
		const users = await prisma.user.findMany({
			where: { tenantId: company.tenantId, companyId: company.id },
		});

		res.status(StatusCodes.OK).json({
			success: true,
			data: users,
			nbHits: users.length,
		});
	},

	/**
	 * Get a single user by ID.
	 * - Retrieve company context from the authenticated user.
	 * - Use a helper (getUserHelper) to fetch the user by ID.
	 * - Return the found user.
	 */
	getUser: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const { user } = await getUserHelper({ id: req.params.id, company });
		res.status(StatusCodes.OK).json({ success: true, data: user });
	},

	/**
	 * Update a user's profile.
	 * - Retrieve company context and the existing user record using a helper.
	 * - If a new password is provided, hash it; otherwise, keep the existing password.
	 * - Extract any bank details from the request body.
	 * - In a transaction:
	 *    - If bank details are provided, create new bank records for the user.
	 *    - Update the user's record with the remaining update data.
	 * - Return a success response with the updated user.
	 */
	updateUserProfile: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const { user } = await getUserHelper({ id: req.params.id, company });

		// If a new password is provided, hash it; otherwise, use the existing password
		if (req.body.password && req.body.password !== "") {
			req.body.password = await argon2.hash(req.body.password);
		} else {
			req.body.password = user.password;
		}

		// Destructure bankDetails out of the request body; remaining fields go into updateData
		const { bankDetails, ...updateData } = req.body;

		// Use a database transaction to update both bank details and user record atomically
		const updateUser = await prisma.$transaction(async prisma => {
			// If bankDetails is provided and is a non-empty array, create bank records
			if (Array.isArray(bankDetails) && bankDetails.length > 0) {
				await Promise.all(
					bankDetails.map(
						async (value: { bankName: string; acctNo: string }) => {
							await prisma.userBank.create({
								data: {
									bankName: value.bankName,
									acctNo: value.acctNo,
									userId: user.id,
								},
							});
						}
					)
				);
			}

			// Update the user record with the remaining update data
			return await prisma.user.update({
				where: {
					id: user.id,
					tenantId: company.tenantId,
					companyId: company.id,
				},
				data: updateData,
			});
		});

		res.status(StatusCodes.OK).json({
			msg: "Profile updated successfully",
			success: true,
			data: updateUser,
		});
	},

	/**
	 * Update a user's role.
	 * - Retrieve company context and the existing user record.
	 * - Update the user's role in the database (converting the provided role to uppercase).
	 * - Return a success response.
	 */
	updateUserRole: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const { user } = await getUserHelper({ id: req.params.id, company });
		await prisma.user.update({
			where: {
				id: user.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
			data: { role: req.body.role.toUpperCase() as Role },
		});

		res
			.status(StatusCodes.OK)
			.json({ msg: "User role updated successfully", success: true });
	},

	/**
	 * Delete a user.
	 * - Retrieve company context and verify that the user exists.
	 * - Delete the user from the database.
	 * - Return a success response.
	 */
	deleteUser: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const { user } = await getUserHelper({ id: req.params.id, company });

		await prisma.user.delete({
			where: {
				id: user.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});
		res
			.status(StatusCodes.OK)
			.json({ msg: "User deleted successfully", success: true });
	},

	// ===========================================================================
	// CUSTOMER OPERATIONS
	// ===========================================================================

	/**
	 * Create a new customer.
	 * - Retrieve the company context.
	 * - Check if a customer with the same name and phone already exists.
	 * - If yes, throw an error.
	 * - Otherwise, create a new customer record with the provided data.
	 * - Return a success response with the new customer data.
	 */
	createCustomer: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const existingCustomer = await prisma.customer.findUnique({
			where: {
				name_phone: {
					name: req.body.name,
					phone: req.body.phone,
				},
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		if (existingCustomer) throw new BadRequestError("Customer already exists.");

		const newCustomer = await prisma.customer.create({
			data: {
				...req.body,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		res.status(StatusCodes.CREATED).json({
			msg: "Customer created successfully.",
			success: true,
			data: newCustomer,
		});
	},

	/**
	 * Get all customers.
	 * - Retrieve the company context.
	 * - Fetch customers that have no associated transactions.
	 * - Also, fetch customers from payment plans with customerType CUSTOMER.
	 * - Combine these lists and return them along with the hit count.
	 */
	getCustomers: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		// Get customers with no transactions
		const createdCustomers = await prisma.customer.findMany({
			where: {
				tenantId: company.tenantId,
				companyId: company.id,
				Transaction: { none: {} },
			},
		});

		// Get customers from payment plans with customerType CUSTOMER
		const customerWithPaymentPlanTypeCustomer =
			await prisma.paymentPlan.findMany({
				where: { customerType: CustomerType.CUSTOMER },
				select: { Customer: true },
			});

		// Combine both customer lists
		const customers = [
			...createdCustomers,
			...customerWithPaymentPlanTypeCustomer.map(c => c.Customer),
		];

		res
			.status(StatusCodes.OK)
			.json({ success: true, data: customers, nbHits: customers.length });
	},

	/**
	 * Get a single customer.
	 * - Retrieve the company context.
	 * - Find the customer through the payment plan that has customerType CUSTOMER.
	 * - Return the customer data.
	 */
	getCustomer: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const customer = await prisma.paymentPlan.findFirst({
			where: { customerType: CustomerType.CUSTOMER, customerId: req.params.id },
			select: {
				Customer: {
					select: { name: true, phone: true },
				},
				Transaction: {
					select: {
						type: true,
						TransactionItem: {
							select: {
								Product: {
									select: {
										productName: true,
										sku: true,
										serialNo: true,
										brand: true,
										productType: true,
									},
								},
								quantity: true,
								pricePerUnit: true,
								totalPrice: true,
							},
						},
					},
				},
				payments: {
					select: {
						balanceOwed: true,
						method: true,
						paymentDate: true,
					},
				},
			},
		});

		if (!customer) throw new BadRequestError("Customer not found.");

		res.status(StatusCodes.OK).json({
			msg: "Customer successfully found.",
			success: true,
			data: customer,
		});
	},

	/**
	 * Update an existing customer.
	 * - Retrieve the company context.
	 * - Check if the customer exists by matching name and phone.
	 * - If not found, throw an error.
	 * - Update the customer record with the new data.
	 * - Return a success response.
	 */
	updateCustomer: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const existingCustomer = await prisma.customer.findUnique({
			where: {
				name_phone: {
					name: req.body.name,
					phone: req.body.phone,
				},
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		if (!existingCustomer)
			throw new BadRequestError("Customer already exists.");

		await prisma.customer.update({
			where: {
				id: req.params.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
			data: req.body,
		});

		res
			.status(StatusCodes.CREATED)
			.json({ msg: "Customer updated successfully", success: true });
	},

	// ===========================================================================
	// DEBTOR OPERATIONS
	// ===========================================================================

	/**
	 * Get all debtors.
	 * - Retrieve the company context.
	 * - Fetch all customers from payment plans that have customerType DEBTOR.
	 * - Return the list of debtor customers along with the count.
	 */
	getDebtors: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const customerWithPaymentPlanTypeCustomer =
			await prisma.paymentPlan.findMany({
				where: { customerType: CustomerType.DEBTOR },
				select: { Customer: true },
			});

		const customers = customerWithPaymentPlanTypeCustomer.map(c => c.Customer);

		res
			.status(StatusCodes.OK)
			.json({ success: true, data: customers, nbHits: customers.length });
	},

	/**
	 * Get a specific debtor.
	 * - Retrieve the company context.
	 * - Find the debtor customer using a payment plan query filtering for customerType DEBTOR.
	 * - Return the debtor's customer data along with related transaction and payment details.
	 */
	getDebtor: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		if (!company) throw new BadRequestError("Company not found.");

		const customer = await prisma.paymentPlan.findFirst({
			where: { customerType: CustomerType.DEBTOR, customerId: req.params.id },
			select: {
				Customer: {
					select: { name: true, phone: true },
				},
				Transaction: {
					select: {
						type: true,
						TransactionItem: {
							select: {
								Product: {
									select: {
										productName: true,
										sku: true,
										serialNo: true,
										brand: true,
										productType: true,
									},
								},
								quantity: true,
								pricePerUnit: true,
								totalPrice: true,
							},
						},
					},
				},
				payments: {
					select: {
						balanceOwed: true,
						method: true,
						paymentDate: true,
					},
				},
			},
		});

		if (!customer) throw new BadRequestError("Customer not found.");

		res.status(StatusCodes.OK).json({
			msg: "Customer successfully found.",
			success: true,
			data: customer,
		});
	},

	// ===========================================================================
	// SUPPLIER OPERATIONS
	// ===========================================================================

	/**
	 * Create a new supplier.
	 * - Retrieve the company context.
	 * - Check if a supplier with the same name and contact exists.
	 * - If so, throw an error.
	 * - Otherwise, create a new supplier record.
	 * - Return a success response with the new supplier.
	 */
	createSupplier: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const existingSupplier = await prisma.supplier.findUnique({
			where: {
				name_contact: {
					name: req.body.name,
					contact: req.body.contact,
				},
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		if (existingSupplier) throw new BadRequestError("Supplier already exists.");

		const newSupplier = await prisma.supplier.create({
			data: {
				...req.body,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		res.status(StatusCodes.CREATED).json({
			msg: "Supplier created successfully.",
			success: true,
			data: newSupplier,
		});
	},

	/**
	 * Get all suppliers.
	 * - Retrieve the company context.
	 * - Fetch all suppliers that belong to the company and tenant.
	 * - Return the list of suppliers along with the hit count.
	 */
	getSuppliers: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);
		const suppliers = await prisma.supplier.findMany({
			where: {
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});

		res.status(StatusCodes.CREATED).json({
			msg: "All suppliers found.",
			success: true,
			data: suppliers,
			nbHits: suppliers.length,
		});
	},

	/**
	 * Get a single supplier.
	 * - Retrieve the company context.
	 * - Find a supplier by its ID, filtered by the company and tenant.
	 * - If not found, throw a NotFoundError.
	 * - Return the supplier data.
	 */
	getSupplier: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const supplier = await prisma.supplier.findUnique({
			where: {
				id: req.params.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});
		if (!supplier) throw new NotFoundError("Supplier not found.");

		res.status(StatusCodes.CREATED).json({ data: supplier, success: true });
	},

	/**
	 * Update an existing supplier.
	 * - Retrieve the company context.
	 * - Find the supplier by its ID.
	 * - If not found, throw a NotFoundError.
	 * - Update the supplier with the new data provided.
	 * - Return a success response with the updated supplier data.
	 */
	updateSupplier: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const existingSupplier = await prisma.supplier.findUnique({
			where: {
				id: req.params.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
		});
		if (!existingSupplier) throw new NotFoundError("Supplier not found.");

		const updatedSupplier = await prisma.supplier.update({
			where: {
				id: existingSupplier.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
			data: req.body,
		});

		res
			.status(StatusCodes.CREATED)
			.json({ data: updatedSupplier, success: true });
	},

	/**
	 * Delete a supplier.
	 * - Retrieve the company context.
	 * - Find the supplier by its ID and include its related products.
	 * - Calculate the total quantity of products associated with the supplier.
	 * - If there are no products or their quantity is zero, delete the supplier.
	 * - Otherwise, update all products linked to the supplier by setting their supplierId to null,
	 *   then delete the supplier.
	 * - Return a success response indicating the supplier has been deleted.
	 */
	deleteSupplier: async (req: Request, res: Response) => {
		const { company } = await userNdCompany(req.user);

		const supplier = await prisma.supplier.findUnique({
			where: {
				id: req.params.id,
				tenantId: company.tenantId,
				companyId: company.id,
			},
			include: { products: { select: { quantity: true } } },
		});
		if (!supplier) throw new NotFoundError("Supplier not found.");

		// Calculate the total quantity of products associated with the supplier
		const productQuantity = supplier.products.reduce(
			(acc, product) => acc + product.quantity,
			0
		);

		// If no products or product quantity is zero, delete supplier directly
		if (supplier.products.length === 0 || productQuantity === 0) {
			await prisma.supplier.delete({
				where: {
					id: supplier.id,
					tenantId: company.tenantId,
					companyId: company.id,
				},
			});
		} else {
			// If products exist, update them to remove association with the supplier
			await prisma.product.updateMany({
				where: {
					supplierId: supplier.id,
					companyId: company.id,
					tenantId: company.tenantId,
				},
				data: { supplierId: null },
			});

			// Delete the supplier after updating products
			await prisma.supplier.delete({
				where: {
					id: supplier.id,
					tenantId: company.tenantId,
					companyId: company.id,
				},
			});
		}

		res.status(StatusCodes.CREATED).json({
			msg: "Supplier deleted successfully",
			success: true,
		});
	},
};
