import { CustomerType } from "@prisma/client";
import argon2 from "argon2";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import { userNdCompany } from "../utils/helper.js";
import { prisma } from "../utils/prisma.js";
export const getUserHelper = async ({ id, company, }) => {
    const user = await prisma.user.findUnique({
        where: {
            id: id,
            tenantId: company.tenantId,
            companyId: company.id,
        },
        include: { Company: true },
    });
    if (!user)
        throw new NotFoundError("User not found.");
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
    createUser: async (req, res) => {
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
        if (existingUser)
            throw new BadRequestError("User already exists.");
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
    getUsers: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        // Retrieve users filtered by tenant and company
        const users = await prisma.user.findMany({
            where: { tenantId: company.tenantId, companyId: company.id },
        });
        const returnedUsers = users.map((user) => {
            return {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role,
                phone: user.phone,
                createdAt: user.createdAt,
            };
        });
        res.status(StatusCodes.OK).json({
            success: true,
            data: returnedUsers,
            nbHits: returnedUsers.length,
        });
    },
    /**
     * Get a single user by ID.
     * - Retrieve company context from the authenticated user.
     * - Use a helper (getUserHelper) to fetch the user by ID.
     * - Return the found user.
     */
    getUser: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { id } = req.params;
        const { user } = await getUserHelper({ id: id, company });
        const returnedUser = {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            phone: user.phone,
        };
        // user: {
        //   id: user.id,
        //   email: user.email,
        //   firstName: user.first_name,
        //   lastName: user.last_name,
        //   role: user.role,
        //   phone: user.phone,
        //   companyStatus: company.subscriptionStatus,
        // },
        res.status(StatusCodes.OK).json({ success: true, data: returnedUser });
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
    updateUserProfile: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { user } = await getUserHelper({ id: req.params.id, company });
        // If a new password is provided, hash it; otherwise, use the existing password
        if (req.body.password && req.body.password.trim() !== "") {
            req.body.password = await argon2.hash(req.body.password);
        }
        else {
            req.body.password = user.password;
        }
        console.log({ ...req.body });
        // Use a database transaction to update both bank details and user record atomically
        const updatedUser = await prisma.user.update({
            where: { id: user.id, tenantId: company.tenantId, companyId: company.id },
            data: { ...req.body, role: req.body.role.toUpperCase() },
        });
        res.status(StatusCodes.OK).json({
            msg: "Profile updated successfully",
            success: true,
            data: {
                id: updatedUser.id,
                email: updatedUser.email,
                firstName: updatedUser.first_name,
                lastName: updatedUser.last_name,
                role: updatedUser.role,
                phone: updatedUser.phone,
            },
        });
    },
    /**
     * Update a user's role.
     * - Retrieve company context and the existing user record.
     * - Update the user's role in the database (converting the provided role to uppercase).
     * - Return a success response.
     */
    updateUserRole: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { user } = await getUserHelper({ id: req.params.id, company });
        await prisma.user.update({
            where: {
                id: user.id,
                tenantId: company.tenantId,
                companyId: company.id,
            },
            data: { role: req.body.role.toUpperCase() },
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
    deleteUser: async (req, res) => {
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
    // COMPANY ACCOUNT OPERATIONS
    // ===========================================================================
    getCompanyAccount: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const companyAccount = await prisma.companyAccount.findUnique({
            where: { businessEmail: company.company_email },
            select: {
                banks: { select: { bankName: true, acctNo: true, id: true } },
                businessEmail: true,
                businessName: true,
                businessAddress: true,
                phoneNumber: true,
                category: true,
                taxID: true,
            },
        });
        if (!companyAccount)
            throw new NotFoundError("Company account not found.");
        res.status(StatusCodes.OK).json({
            msg: "Company account found.",
            success: true,
            data: companyAccount,
        });
    },
    updateCompanyAccount: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { bankDetails, ...updateData } = req.body;
        const updatedCompany = await prisma.$transaction(async (prisma) => {
            // If bankDetails is provided and is a non-empty array, create bank records
            if (Array.isArray(bankDetails) && bankDetails.length > 0) {
                await Promise.all(bankDetails.map(async (value) => {
                    await prisma.userBank.create({
                        data: {
                            bankName: value.bankName,
                            acctNo: value.acctNo,
                            acctName: value.acctName,
                            companyAccountId: company.CompanyAccount.id,
                        },
                    });
                }));
            }
            // Update the user record with the remaining update data
            return await prisma.companyAccount.update({
                where: { businessEmail: company.company_email },
                data: updateData,
            });
        });
        res.status(StatusCodes.OK).json({
            msg: "Company account updated successfully",
            success: true,
            data: updatedCompany,
        });
    },
    removeCompanyBank: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { id: bankId } = req.params;
        // Delete the specified bank record
        await prisma.userBank.delete({
            where: {
                id: bankId,
                companyAccountId: company.CompanyAccount.id,
            },
        });
        res.status(StatusCodes.OK).json({
            msg: "Bank removed successfully",
            success: true,
        });
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
    createCustomer: async (req, res) => {
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
        if (existingCustomer)
            throw new BadRequestError("Customer already exists.");
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
    getCustomers: async (req, res) => {
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
        const customerWithPaymentPlanTypeCustomer = await prisma.paymentPlan.findMany({
            where: { customerType: CustomerType.CUSTOMER },
            select: { Customer: true, payments: { where: { balanceOwed: 0 } } },
        });
        // Collect unique customers
        const uniqueCustomers = new Map();
        // Add created customers (no transactions)
        createdCustomers.forEach((customer) => {
            if (customer)
                uniqueCustomers.set(customer.id, customer);
        });
        // Add customers from payment plans
        customerWithPaymentPlanTypeCustomer.forEach((c) => {
            if (c.Customer)
                uniqueCustomers.set(c.Customer.id, c.Customer);
        });
        // Extract unique customer IDs
        const customerIds = Array.from(uniqueCustomers.keys());
        // Get transaction count for each unique customer
        const transactions = await prisma.transaction.groupBy({
            by: ["customerId"],
            where: {
                tenantId: company.tenantId,
                companyId: company.id,
                customerId: { in: customerIds },
                Payments: { every: { payments: { every: { balanceOwed: 0 } } } },
            },
            _count: { _all: true },
        });
        // Map transaction counts for quick lookup
        const transactionCounts = new Map(transactions.map((t) => [t.customerId, t._count._all]));
        // Format response
        const returnedData = {
            customer: Array.from(uniqueCustomers.values()).map((customer) => ({
                id: customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                transactionCount: transactionCounts.get(customer.id) || 0,
                dateAdded: customer.createdAt,
                address: customer.address,
            })),
        };
        res.status(StatusCodes.OK).json({
            success: true,
            data: returnedData,
            nbHits: returnedData.customer.length,
        });
    },
    /**
     * Get a single customer.
     * - Retrieve the company context.
     * - Find the customer through the payment plan that has customerType CUSTOMER.
     * - Return the customer data.
     */
    getCustomer: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        const customer = await prisma.customer.findUnique({
            where: { id: req.params.id },
        });
        const customerTransactions = await prisma.transaction.findMany({
            where: {
                customerId: customer?.id,
                Payments: {
                    every: { payments: { every: { balanceOwed: 0 } } },
                },
            },
            include: { TransactionItem: true, createdBy: true },
        });
        const trans = customerTransactions.map((trans) => ({
            transId: trans.id.slice(0, 8),
            soldBy: `${trans.createdBy.first_name} ${trans.createdBy.last_name}`,
            itemCount: trans.TransactionItem.length,
            dateSold: trans.createdAt,
            id: trans.id,
        }));
        const returnedData = {
            customerData: {
                name: customer?.name,
                email: customer?.email,
                address: customer?.address,
                phone: customer?.phone,
            },
            trans,
        };
        res.status(StatusCodes.OK).json({ success: true, data: returnedData });
    },
    /**
     * Update an existing customer.
     * - Retrieve the company context.
     * - Check if the customer exists by matching name and phone.
     * - If not found, throw an error.
     * - Update the customer record with the new data.
     * - Return a success response.
     */
    updateCustomer: async (req, res) => {
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
    // getDebtors: async (req: Request, res: Response) => {
    //   const { company } = await userNdCompany(req.user);
    //   if (!company) throw new BadRequestError("Company not found.");
    //   const debtors = await prisma.paymentPlan.findMany({
    //     where: { payments: { some: { balanceOwed: { not: 0 } } } },
    //   });
    //   const debtorTransactions = await prisma.transaction.findMany({
    //     where: {
    //       id: {
    //         in: debtors
    //           .map((debtor) => debtor.transactionId)
    //           .filter((id): id is string => id !== null),
    //       },
    //     },
    //     include: { Customer: { include: { Transaction: true } } },
    //   });
    //   const uniqueCustomers = new Map<string, any>();
    //   debtorTransactions.forEach((transaction) => {
    //     const customer = transaction.Customer;
    //     if (!customer) return; // Skip transactions without customers
    //     if (!uniqueCustomers.has(customer.id)) {
    //       uniqueCustomers.set(customer.id, {
    //         id: customer.id,
    //         name: customer.name,
    //         email: customer.email,
    //         phone: customer.phone,
    //         transactionCount: customer.Transaction.length,
    //         dateAdded: customer.createdAt,
    //       });
    //     }
    //   });
    //   // const customersWithTransactions = Array.from(uniqueCustomers.values());
    //   // const uniqueCustomers = new Map<string, any>();
    //   // customerWithPaymentPlanTypeCustomer.forEach((c) => {
    //   //   if (c.Customer) uniqueCustomers.set(c.Customer.id, c.Customer);
    //   // });
    //   // const customers = Array.from(uniqueCustomers.values());
    //   // const returnedData = customers
    //   //   .filter((c) => c !== null)
    //   //   .map((customer) => {
    //   //     return {
    //   //       id: customer!.id,
    //   //       name: customer!.name,
    //   //       email: customer!.email,
    //   //       phone: customer!.phone,
    //   //       transactionCount: customer!.Transaction.length,
    //   //       dateAdded: customer!.createdAt,
    //   //     };
    //   //   });
    //   res.status(StatusCodes.OK).json({
    //     success: true,
    //     data: Array.from(uniqueCustomers.values()), // Convert map values to array
    //     nbHits: uniqueCustomers.size,
    //   });
    // },
    getDebtors: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        // 1. Get active debtors (payment plans with unpaid balances)
        const debtorPlans = await prisma.paymentPlan.findMany({
            where: {
                payments: {
                    some: {
                        balanceOwed: { not: 0 },
                    },
                },
                transactionId: { not: null },
            },
            select: { transactionId: true },
        });
        // 2. Extract unique transaction IDs from debtors
        const debtorTransactionIds = Array.from(new Set(debtorPlans
            .map((plan) => plan.transactionId)
            .filter((id) => id !== null)));
        // 3. Get transactions associated with debtors
        const debtorTransactions = await prisma.transaction.findMany({
            where: {
                id: { in: debtorTransactionIds },
                tenantId: company.tenantId,
                companyId: company.id,
            },
            include: { Customer: true },
        });
        // 4. Get unique customer IDs from debtor transactions
        const customerIds = Array.from(new Set(debtorTransactions
            .map((t) => t.Customer?.id)
            .filter((id) => id !== undefined)));
        // 5. Get ALL transactions for these customers (for accurate counts)
        const transactionsByCustomerId = new Map();
        if (customerIds.length > 0) {
            const allTransactions = await prisma.transaction.findMany({
                where: {
                    customerId: { in: customerIds },
                    tenantId: company.tenantId,
                    companyId: company.id,
                    Payments: {
                        every: { payments: { every: { balanceOwed: { not: 0 } } } },
                    },
                },
            });
            allTransactions.forEach((transaction) => {
                const customerId = transaction.customerId;
                transactionsByCustomerId.set(customerId, [
                    ...(transactionsByCustomerId.get(customerId) || []),
                    transaction,
                ]);
            });
        }
        // 6. Create unique customer entries with debt status
        const uniqueCustomers = new Map();
        debtorTransactions.forEach((transaction) => {
            const customer = transaction.Customer;
            if (!customer)
                return;
            if (!uniqueCustomers.has(customer.id)) {
                uniqueCustomers.set(customer.id, {
                    id: customer.id,
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone,
                    transactionCount: transactionsByCustomerId.get(customer.id)?.length || 0,
                    dateAdded: customer.createdAt,
                });
            }
        });
        res.status(StatusCodes.OK).json({
            success: true,
            data: Array.from(uniqueCustomers.values()),
            nbHits: uniqueCustomers.size,
        });
    },
    /**
     * Get a specific debtor.
     * - Retrieve the company context.
     * - Find the debtor customer using a payment plan query filtering for customerType DEBTOR.
     * - Return the debtor's customer data along with related transaction and payment details.
     */
    getDebtor: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        const debtor = await prisma.customer.findUnique({
            where: { id: req.params.id },
        });
        const debtorTransactions = await prisma.transaction.findMany({
            where: {
                customerId: debtor?.id,
                Payments: {
                    every: { payments: { every: { balanceOwed: { not: 0 } } } },
                },
            },
            include: { TransactionItem: true, createdBy: true },
        });
        const trans = debtorTransactions.map((trans) => ({
            transId: trans.id.slice(0, 8),
            soldBy: `${trans.createdBy.first_name} ${trans.createdBy.last_name}`,
            itemCount: trans.TransactionItem.length,
            dateSold: trans.createdAt,
            id: trans.id,
        }));
        const returnedData = {
            customerData: {
                name: debtor?.name,
                email: debtor?.email,
                address: debtor?.address,
                phone: debtor?.phone,
            },
            trans,
        };
        res.status(StatusCodes.OK).json({ success: true, data: returnedData });
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
    createSupplier: async (req, res) => {
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
        if (existingSupplier)
            throw new BadRequestError("Supplier already exists.");
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
    getSuppliers: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const suppliers = await prisma.supplier.findMany({
            where: {
                tenantId: company.tenantId,
                companyId: company.id,
            },
            include: { products: { select: { quantity: true } } },
        });
        const returnedSupplier = suppliers.map((supplier) => {
            return {
                id: supplier.id,
                name: supplier.name,
                contact: supplier.contact,
                email: supplier.email,
                supplyCount: supplier.products.reduce((acc, product) => acc + product.quantity, 0),
                productCount: supplier.products.length,
                dateAdded: supplier.createdAt,
            };
        });
        res.status(StatusCodes.CREATED).json({
            msg: "All suppliers found.",
            success: true,
            data: returnedSupplier,
            nbHits: returnedSupplier.length,
        });
    },
    /**
     * Get a single supplier.
     * - Retrieve the company context.
     * - Find a supplier by its ID, filtered by the company and tenant.
     * - If not found, throw a NotFoundError.
     * - Return the supplier data.
     */
    getSupplier: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const supplier = await prisma.supplier.findUnique({
            where: {
                id: req.params.id,
                tenantId: company.tenantId,
                companyId: company.id,
            },
            include: {
                products: {
                    select: {
                        productName: true,
                        sellingPrice: true,
                        createdAt: true,
                        quantity: true,
                        serialNo: true,
                    },
                },
            },
        });
        if (!supplier)
            throw new NotFoundError("Supplier not found.");
        const returnedData = {
            id: supplier.id,
            name: supplier.name,
            contact: supplier.contact,
            email: supplier.email,
            address: supplier.warehouseAddress,
            count: supplier.products.length,
            supplyCount: supplier.products.reduce((acc, product) => acc + product.quantity, 0),
            products: supplier.products.map(({ sellingPrice, quantity, serialNo, ...product }) => {
                return {
                    ...product,
                    pricePerUnit: sellingPrice,
                    status: quantity > 0 ? "Available" : "Sold Out",
                    serialNo,
                };
            }),
        };
        res.status(StatusCodes.CREATED).json({ data: returnedData, success: true });
    },
    /**
     * Update an existing supplier.
     * - Retrieve the company context.
     * - Find the supplier by its ID.
     * - If not found, throw a NotFoundError.
     * - Update the supplier with the new data provided.
     * - Return a success response with the updated supplier data.
     */
    updateSupplier: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const existingSupplier = await prisma.supplier.findUnique({
            where: {
                id: req.params.id,
                tenantId: company.tenantId,
                companyId: company.id,
            },
        });
        if (!existingSupplier)
            throw new NotFoundError("Supplier not found.");
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
    deleteSupplier: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const supplier = await prisma.supplier.findUnique({
            where: {
                id: req.params.id,
                tenantId: company.tenantId,
                companyId: company.id,
            },
            include: { products: { select: { quantity: true } } },
        });
        if (!supplier)
            throw new NotFoundError("Supplier not found.");
        // Calculate the total quantity of products associated with the supplier
        const productQuantity = supplier.products.reduce((acc, product) => acc + product.quantity, 0);
        // If no products or product quantity is zero, delete supplier directly
        if (supplier.products.length === 0 || productQuantity === 0) {
            await prisma.supplier.delete({
                where: {
                    id: supplier.id,
                    tenantId: company.tenantId,
                    companyId: company.id,
                },
            });
        }
        else {
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
