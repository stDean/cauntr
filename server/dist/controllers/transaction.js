import { Condition, CustomerType, Direction, TransactionType, } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import { generateSKU, userNdCompany } from "../utils/helper.js";
import { customerUtils, generateInvoiceNo, paymentUtils, productUtils, transactionUtils, validationUtils, } from "../utils/helperUtils.js";
import { prisma } from "../utils/prisma.js";
import { supplierService } from "../services/supplierService.js";
import { emailService } from "../services/emailService.js";
// Helper functions
export const handleOutgoingProduct = async (tx, company, sku, quantity) => {
    const product = await tx.product.findUnique({
        where: {
            sku_companyId_tenantId: {
                sku,
                companyId: company.id,
                tenantId: company.tenantId,
            },
        },
    });
    if (!product)
        throw new NotFoundError("Outgoing product not found");
    if (product.quantity < quantity)
        throw new BadRequestError("Insufficient stock");
    return tx.product.update({
        where: { id: product.id },
        data: { quantity: product.quantity - quantity },
    });
};
export const handleIncomingProduct = async (tx, company, userId, item) => {
    const existingProduct = await tx.product.findUnique({
        where: {
            sku_companyId_tenantId: {
                sku: item.sku,
                companyId: company.id,
                tenantId: company.tenantId,
            },
        },
    });
    if (existingProduct) {
        return tx.product.update({
            where: { id: existingProduct.id },
            data: { quantity: existingProduct.quantity + item.quantity },
        });
    }
    let supplier;
    if (item.supplierName || item.supplierPhone) {
        supplier = await supplierService.getOrCreate(item.supplierName || "Swap Supplier", item.supplierPhone || "000-0000000", company.id, company.tenantId);
    }
    return tx.product.create({
        data: {
            sku: item.sku || generateSKU(item.productType),
            productName: item.productName,
            sellingPrice: item.sellingPrice,
            quantity: item.quantity,
            companyId: company.id,
            tenantId: company.tenantId,
            supplierId: supplier ? supplier.id : null,
            createdById: userId,
            condition: item.condition || Condition.NEW,
            brand: item.brand,
            productType: item.productType,
            serialNo: item.serialNo || null,
            description: item.description || null,
            costPrice: item.costPrice || 0,
        },
    });
};
export const getSoldOrSwapProducts = async ({ company, inArray, }) => {
    const transactions = await prisma.transaction.findMany({
        where: {
            type: { in: inArray },
            companyId: company.id,
            tenantId: company.tenantId,
        },
        include: {
            TransactionItem: {
                include: { Product: { include: { Supplier: true } } },
            },
            Customer: true,
            createdBy: true,
            Payments: { include: { payments: true } },
        },
    });
    if (!transactions)
        throw new NotFoundError("No Product found.");
    return { transactions };
};
export const soldOrSwapByID = async ({ company, inArray, id, }) => {
    const transaction = await prisma.transaction.findUnique({
        where: {
            id: id,
            companyId: company.id,
            tenantId: company.tenantId,
            type: { in: inArray },
        },
        include: {
            TransactionItem: {
                include: {
                    Product: {
                        include: {
                            Supplier: true,
                        },
                    },
                },
            },
            Customer: true,
            createdBy: true,
            Payments: {
                include: {
                    payments: {
                        include: { acctPaidTo: { include: { bank: true } } },
                        orderBy: { createdAt: "desc" },
                    },
                },
            },
            Invoice: true,
        },
    });
    if (!transaction)
        throw new NotFoundError("Transaction not found.");
    return { transaction };
};
export const generateSalesReport = (transactions) => {
    const report = {
        totalSales: 0,
        categories: new Set(),
        totalStockSold: 0,
        topSellingProduct: { name: "", quantity: 0 },
        productQuantities: {},
    };
    transactions.forEach((transaction) => {
        // Calculate total sales
        transaction.Payments.forEach((payment) => {
            payment.payments.forEach((p) => {
                report.totalSales += parseFloat(p.totalPay) || 0;
            });
        });
        // Process transaction items
        transaction.TransactionItem.forEach((item) => {
            // Track categories
            report.categories.add(item.Product.productType);
            // Calculate total stock sold
            report.totalStockSold += item.quantity;
            // Track product quantities
            const productName = item.Product.productName;
            report.productQuantities[productName] =
                (report.productQuantities[productName] || 0) + item.quantity;
        });
    });
    // Find top selling product
    report.topSellingProduct = Object.entries(report.productQuantities).reduce((max, [name, quantity]) => quantity > max.quantity ? { name, quantity } : max, { name: "", quantity: 0 });
    return {
        totalSales: Number(report.totalSales.toFixed(2)),
        categories: report.categories.size,
        totalStockSold: report.totalStockSold,
        topSellingProduct: report.topSellingProduct,
    };
};
export const TransactionsCtrl = {
    /**
     * Sell a single product.
     *
     * Steps:
     * - Extract user information, URL parameters (such as the product SKU), and request body data
     *   (transaction details, payment info, and optional customer details).
     * - Retrieve the company context and authenticated user using a helper function.
     * - Start a database transaction to ensure all subsequent operations are executed atomically.
     * - Locate the product by its SKU and validate that there is sufficient stock available.
     * - Update the product’s quantity by deducting the sold amount.
     * - If customer details are provided, perform an upsert to update or create the customer record.
     * - Create a sale transaction record that includes details of the sold product.
     * - Create a payment plan by calculating the total paid amount (price multiplied by quantity)
     *   and setting other payment details.
     * - Return a JSON response containing the transaction, customer (if any), and payment plan details.
     */
    sellProduct: async (req, res) => {
        const { user, params, body } = req;
        const { transaction: transactionBody, payment, customerDetails, vat, totalPay, acctPaidTo, } = body;
        // Add validation for required fields
        validationUtils.validateRequiredFields(body, ["transaction"]);
        const { company, user: authUser } = await userNdCompany(user);
        const transactionRes = await prisma.$transaction(async (tx) => {
            const product = await productUtils.findProductBySKU(tx, params.sku, company);
            productUtils.validateProductStock(product, transactionBody.quantity);
            const updatedProduct = await productUtils.updateProductQuantity(tx, product.id, -transactionBody.quantity);
            let customer;
            if (customerDetails) {
                customer = await customerUtils.upsertCustomer(tx, customerDetails, company);
            }
            const transaction = await transactionUtils.createTransaction(tx, TransactionType.SALE, {
                company,
                userId: authUser.id,
                customerId: customer && customer.id,
                items: [
                    {
                        productId: updatedProduct.id,
                        quantity: transactionBody.quantity,
                        pricePerUnit: transactionBody.price,
                        direction: Direction.DEBIT,
                    },
                ],
            });
            const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
                customerId: customer && customer.id,
                ...payment,
                amountPaid: Number(transactionBody.price) * Number(transactionBody.quantity),
                balanceOwed: payment.balanceOwed,
                frequency: payment.frequency,
                transId: transaction.id,
                vat,
                totalPay,
                acctPaidTo: payment.paymentMethod === "BANK_TRANSFER" ? acctPaidTo : undefined,
            });
            const invoiceNumber = await generateInvoiceNo({
                companyId: company.id,
                tenantId: company.tenantId,
            });
            const createdInvoice = await tx.invoice.create({
                data: {
                    invoiceNo: invoiceNumber,
                    paymentDate: transaction.createdAt,
                    tenantId: company.tenantId,
                    companyId: company.id,
                    transactionId: transaction.id,
                    status: payment.balanceOwed && Number(payment.balanceOwed) !== 0
                        ? "PART_PAID"
                        : "PAID",
                },
            });
            return { createdInvoice };
        });
        if (customerDetails && customerDetails.email) {
            await emailService.sendInvoice(transactionRes.createdInvoice.invoiceNo);
        }
        res.status(StatusCodes.OK).json({
            success: true,
            msg: `Product with sku: ${params.sku} successfully sold`,
        });
    },
    /**
     * Sell multiple products in a bulk sale.
     *
     * Steps:
     * - Extract the user information and transactions list from the request body.
     * - Retrieve the company context and authenticated user details.
     * - Validate that the "transactions" field is present in the request body.
     * - Initiate a database transaction to ensure atomicity.
     * - For each transaction in the list:
     *    - Concurrently fetch the corresponding product by SKU.
     *    - Validate that each product has enough stock to cover the sale.
     * - Update the quantity of each product based on the sold amounts.
     * - If customer details are provided, upsert the customer record.
     * - Create a bulk sale transaction record that aggregates all sold products.
     * - Calculate the total amount paid by summing up the individual transaction totals.
     * - Create a payment plan for the bulk sale with the calculated payment details.
     * - Return a JSON response with the bulk sale transaction, customer details, and payment plan.
     */
    sellProducts: async (req, res) => {
        const { user, body } = req;
        const { company, user: authUser } = await userNdCompany(user);
        validationUtils.validateRequiredFields(body, ["transactions"]);
        const { createdInvoice, customerDetails } = await prisma.$transaction(async (tx) => {
            const products = await Promise.all(body.transactions.map((txn) => productUtils.findProductBySKU(tx, txn.sku, company)));
            validationUtils.validateStockQuantities(products, body.transactions);
            await Promise.all(body.transactions.map((txn) => productUtils.updateProductQuantity(tx, products.find((p) => p.sku === txn.sku).id, -txn.quantity)));
            let customer;
            if (body.customerDetails) {
                customer = await customerUtils.upsertCustomer(tx, body.customerDetails, company);
            }
            const transaction = await transactionUtils.createTransaction(tx, TransactionType.BULK_SALE, {
                company,
                userId: authUser.id,
                customerId: customer && customer.id,
                items: body.transactions.map((txn) => ({
                    productId: products.find((p) => p.sku === txn.sku).id,
                    quantity: txn.quantity,
                    pricePerUnit: txn.sellingPrice || 0,
                    direction: Direction.DEBIT,
                })),
            });
            const invoiceNumber = await generateInvoiceNo({
                companyId: company.id,
                tenantId: company.tenantId,
            });
            const createdInvoice = await tx.invoice.create({
                data: {
                    invoiceNo: invoiceNumber,
                    paymentDate: transaction.createdAt,
                    tenantId: company.tenantId,
                    companyId: company.id,
                    transactionId: transaction.id,
                    status: body.payment.balanceOwed && Number(body.payment.balanceOwed) !== 0
                        ? "PART_PAID"
                        : "PAID",
                },
            });
            const amountPaid = body.transactions.reduce((acc, txn) => {
                return acc + txn.sellingPrice * txn.quantity;
            }, 0);
            const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
                customerId: customer && customer.id,
                ...body.payment,
                amountPaid: amountPaid,
                balanceOwed: body.payment.balanceOwed,
                frequency: body.payment.frequency,
                transId: transaction.id,
                vat: body.vat,
                totalPay: body.totalPay,
                acctPaidTo: body.payment.paymentMethod === "BANK_TRANSFER"
                    ? body.acctPaidTo
                    : undefined,
            });
            return { createdInvoice, customerDetails: body.customerDetails };
        });
        if (customerDetails && customerDetails.email) {
            await emailService.sendInvoice(createdInvoice.invoiceNo);
        }
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Products successfully sold.",
        });
    },
    /**
     * Swap a product.
     *
     * Steps:
     * - Extract the user information, URL parameters, and request body data including:
     *    - Outgoing product details (SKU and quantity to be swapped out).
     *    - An array of incoming product details.
     *    - Optional customer details and payment info.
     * - Validate that the outgoing product and at least one incoming product are specified.
     * - Retrieve the company context and authenticated user.
     * - Begin a database transaction.
     * - Process the outgoing product by reducing its stock quantity accordingly.
     * - Process each incoming product concurrently, which may involve adding new stock or updating records.
     * - If provided, upsert the customer record using the provided customer details.
     * - Create a swap transaction record that captures details for both the outgoing and incoming products.
     * - If payment details are provided, create a corresponding payment plan.
     * - Return a JSON response confirming the successful swap, along with transaction, payment, and customer details.
     */
    // swapProduct: async (req: Request, res: Response) => {
    //   const { user, body, params } = req;
    //   const { outgoing, incoming, customerDetails, payment } =
    //     body as SwapProductRequest;
    //   // Validate input
    //   if (!outgoing?.sku || !outgoing?.quantity || !incoming?.length) {
    //     throw new BadRequestError(
    //       "Invalid swap request: Missing required fields"
    //     );
    //   }
    //   // Get company context
    //   const { company, user: authUser } = await userNdCompany(user);
    //   return prisma.$transaction(async (tx) => {
    //     // 1. Process outgoing product
    //     const outgoingProduct = await handleOutgoingProduct(
    //       tx,
    //       company,
    //       params.sku,
    //       outgoing.quantity
    //     );
    //     // 2. Process incoming products
    //     const incomingProducts = await Promise.all(
    //       incoming.map((item) =>
    //         handleIncomingProduct(tx, company, authUser.id, item)
    //       )
    //     );
    //     // 3. Handle customer
    //     let customer;
    //     if (customerDetails) {
    //       customer = await customerUtils.upsertCustomer(
    //         tx,
    //         customerDetails,
    //         company
    //       );
    //     }
    //     // 4. Create transaction
    //     const transaction = await transactionUtils.createSwapTransaction(tx, {
    //       company,
    //       userId: authUser.id,
    //       customerId: customer && customer.id,
    //       outgoingProduct,
    //       outgoingQuantity: outgoing.quantity,
    //       incomingProducts,
    //     });
    //     // 5. Handle payment if applicable
    //     const paymentPlan = await paymentUtils.createPaymentPlan(tx, {
    //       customerId: customer && customer.id,
    //       transId: transaction.id,
    //       ...payment,
    //     });
    //     res.status(StatusCodes.OK).json({
    //       success: true,
    //       data: { transaction, paymentPlan, customer },
    //       message: "Product swap completed successfully",
    //     });
    //   });
    // },
    /**
     * Retrieve sold products.
     *
     * Steps:
     * - Extract the user's email and company ID from the request.
     * - Retrieve the company context based on the user's credentials.
     * - Fetch all transactions classified as "SALE" or "BULK_SALE" using a helper function.
     * - Return a JSON response containing the list of sold transactions and the count of transactions.
     */
    getSoldProducts: async (req, res) => {
        const { email, companyId } = req.user;
        const { company } = await userNdCompany({ email, companyId });
        const { transactions } = await getSoldOrSwapProducts({
            company,
            inArray: ["SALE", "BULK_SALE"],
        });
        const transactionSummary = generateSalesReport(transactions);
        const returnedData = transactions.map((transaction) => {
            return {
                transactionId: transaction.id,
                employee: `${transaction.createdBy?.first_name} ${transaction.createdBy.last_name}`,
                email: transaction.createdBy?.email,
                salesType: transaction.type,
                transactionDate: transaction.createdAt,
                itemCount: transaction.TransactionItem.length,
                shortId: transaction.id.slice(0, 8),
            };
        });
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Products sold successfully",
            data: returnedData,
            nbHits: transactions.length,
            transactionSummary,
        });
    },
    /**
     * Retrieve swap transactions.
     *
     * Steps:
     * - Extract the user's email and company ID from the request.
     * - Retrieve the company context using the user details.
     * - Fetch all transactions classified as "SWAP" using a helper function.
     * - Return a JSON response containing the list of swap transactions and the total number of hits.
     */
    getSwapProducts: async (req, res) => {
        const { email, companyId } = req.user;
        const { company } = await userNdCompany({ email, companyId });
        const { transactions } = await getSoldOrSwapProducts({
            company,
            inArray: ["SWAP"],
        });
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Products sold successfully",
            data: transactions,
            nbHits: transactions.length,
        });
    },
    /**
     * Retrieve a sold transaction by its ID.
     *
     * Steps:
     * - Retrieve the company context from the authenticated user's data.
     * - Use a helper function to fetch the transaction by its ID, filtering for transactions of type
     *   "SALE" or "BULK_SALE".
     * - Return a JSON response containing the details of the found sold transaction.
     */
    getSoldTransactionByID: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { transaction } = await soldOrSwapByID({
            company,
            inArray: ["SALE", "BULK_SALE"],
            id: req.params.transactionId,
        });
        const salesSummary = transaction.TransactionItem.map((item) => ({
            productName: item.Product.productName,
            qty: item.quantity,
            price: item.pricePerUnit,
        }));
        const paymentHistory = transaction.Payments[0].payments.map((pay) => ({
            date: pay.createdAt,
            amount: pay.totalAmount,
            modeOfPay: pay.method,
            balanceOwed: pay.balanceOwed,
            amountPaid: pay.totalPay,
            balancePaid: pay.balancePaid,
        }));
        const returnedData = {
            soldBy: {
                name: `${transaction.createdBy.first_name} ${transaction.createdBy.last_name}`,
                type: transaction.type,
            },
            customer: {
                name: transaction.Customer?.name,
                email: transaction.Customer?.email,
                phone: transaction.Customer?.phone,
            },
            salesSummary: salesSummary,
            paymentHistory: paymentHistory,
            totalPay: transaction.Payments[0].payments[0].totalAmount,
            invoiceNo: transaction.Invoice?.invoiceNo,
        };
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Sold transaction found.",
            data: returnedData,
        });
    },
    /**
     * Retrieve a swap transaction by its ID.
     *
     * Steps:
     * - Retrieve the company context from the user's information.
     * - Use a helper function to fetch the transaction by its ID, ensuring it is of type "SWAP".
     * - Return a JSON response containing the details of the found swap transaction.
     */
    getSwapTransactionByID: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        const { transaction } = await soldOrSwapByID({
            company,
            inArray: ["SWAP"],
            id: req.params.transactionId,
        });
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Swap transaction found.",
            data: transaction,
        });
    },
    /**
     * Retrieve a product by its transaction item ID.
     *
     * Steps:
     * - Retrieve the company context using the authenticated user's data.
     * - Find the transaction item by its ID using Prisma, including related product details
     *   (and supplier) and transaction details (and customer).
     * - If the transaction item is not found, throw a "Not Found" error.
     * - Return a JSON response with the details of the retrieved product.
     */
    getProductByItemID: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        const product = await prisma.transactionItem.findUnique({
            where: { id: req.params.itemId },
            select: {
                Product: {
                    select: {
                        serialNo: true,
                        productName: true,
                        sellingPrice: true,
                        sku: true,
                        // Supplier: true,
                    },
                },
                Transaction: {
                    include: {
                        Customer: true,
                        Payments: {
                            include: {
                                payments: { orderBy: { createdAt: "desc" } },
                            },
                        },
                        Invoice: true,
                    },
                },
            },
        });
        if (!product)
            throw new NotFoundError("Product not found.");
        const returnedData = {
            salesDetails: {
                customerName: product.Transaction.Customer?.name,
                salesAmount: product.Transaction.Payments[0].payments[0].totalAmount,
                balanceOwed: product.Transaction.Payments[0].payments[0].balanceOwed,
                salesType: product.Transaction.type,
                itemId: req.params.itemId,
                alreadyPaid: product.Transaction.Payments[0].payments[0].totalPay,
            },
            paymentHistory: product.Transaction.Payments[0].payments
                .filter((p) => p.balancePaid !== null && Number(p.balancePaid) !== 0)
                .map((p) => ({
                paymentDate: p.createdAt,
                amount: p.totalPay,
                balancePaid: p.balancePaid,
            })),
        };
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Sold product found.",
            data: returnedData,
        });
    },
    /**
     * Update the payment balance for a sold product.
     *
     * Steps:
     * - Extract the payment amount and method from the request body.
     * - Retrieve the company context from the authenticated user.
     * - Fetch the transaction item along with its associated payment details.
     * - Validate that there is an outstanding balance and that the payment does not exceed this balance.
     * - Update the payment plan:
     *    - Increment the installment count.
     *    - Create a new payment record with the updated total amount and remaining balance.
     * - Return a JSON response containing the updated transaction item and payment plan details.
     */
    updateProductBalance: async (req, res) => {
        const { amount, method, acctPaidTo } = req.body;
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        const transaction = await prisma.transaction.findUnique({
            where: { id: req.params.itemId },
            include: {
                Payments: {
                    select: {
                        payments: { orderBy: { paymentDate: "desc" } },
                        installmentCount: true,
                        id: true,
                    },
                },
                Customer: { select: { email: true } },
            },
        });
        if (!transaction)
            throw new NotFoundError("Transaction not found.");
        const isBalance = transaction?.Payments?.[0]?.payments?.[0]?.balanceOwed;
        if (Number(isBalance) === 0) {
            throw new BadRequestError("Balance is 0 and cannot be updated.");
        }
        const balance = Number(isBalance) - Number(amount);
        // Prevent overpayment
        if (balance < 0) {
            throw new BadRequestError("Cannot pay more than balance owed");
        }
        // const plan = await prisma.paymentPlan.update({
        //   where: {
        //     id: transaction?.Payments?.[0]?.payments?.[0]?.paymentPlanId!,
        //   },
        //   data: {
        //     customerType:
        //       balance !== 0 ? CustomerType.DEBTOR : CustomerType.CUSTOMER,
        //     installmentCount: transaction?.Payments?.[0]?.installmentCount! + 1,
        //     payments: {
        //       create: {
        //         method: method
        //           ? method.toUpperCase()
        //           : (transaction?.Payments?.[0]?.payments?.[0]
        //               ?.method as PaymentMethod),
        //         totalAmount: Number(
        //           transaction?.Payments?.[0]?.payments?.[0]?.totalAmount
        //         ),
        //         balanceOwed: balance,
        //         balancePaid: Number(amount),
        //         totalPay:
        //           Number(amount) +
        //           Number(transaction?.Payments?.[0]?.payments?.[0]?.totalPay),
        //         acctPaidTo:
        //           method === "BANK_TRANSFER"
        //             ? {
        //                 connectOrCreate: {
        //                   where: {
        //                     userBankId: acctPaidTo?.userBankId,
        //                   },
        //                   create: {
        //                     bank: {
        //                       create: {
        //                         bankName: acctPaidTo?.bankName || "",
        //                         acctNo: acctPaidTo?.acctNo || "",
        //                         acctName: acctPaidTo?.acctName || "",
        //                       },
        //                     },
        //                   },
        //                 },
        //               }
        //             : undefined,
        //       },
        //     },
        //   },
        // });
        const updatedInvoice = await prisma.invoice.update({
            where: { transactionId: transaction.id },
            data: {
                status: balance === 0 ? "PAID" : "PART_PAID",
                paymentDate: new Date(),
                Transaction: {
                    update: {
                        Payments: {
                            update: {
                                where: { id: transaction.Payments[0].id },
                                data: {
                                    customerType: balance !== 0 ? CustomerType.DEBTOR : CustomerType.CUSTOMER,
                                    installmentCount: transaction?.Payments?.[0]?.installmentCount + 1,
                                    payments: {
                                        create: {
                                            method: method
                                                ? method.toUpperCase()
                                                : transaction?.Payments?.[0]?.payments?.[0]
                                                    ?.method,
                                            totalAmount: Number(transaction?.Payments?.[0]?.payments?.[0]?.totalAmount),
                                            balanceOwed: balance,
                                            balancePaid: Number(amount),
                                            totalPay: Number(amount) +
                                                Number(transaction?.Payments?.[0]?.payments?.[0]?.totalPay),
                                            acctPaidTo: method === "BANK_TRANSFER"
                                                ? {
                                                    connectOrCreate: {
                                                        where: {
                                                            userBankId: acctPaidTo?.userBankId,
                                                        },
                                                        create: {
                                                            bank: {
                                                                create: {
                                                                    bankName: acctPaidTo?.bankName || "",
                                                                    acctNo: acctPaidTo?.acctNo || "",
                                                                    acctName: acctPaidTo?.acctName || "",
                                                                },
                                                            },
                                                        },
                                                    },
                                                }
                                                : undefined,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (transaction.Customer?.email) {
            await emailService.sendInvoice(updatedInvoice.invoiceNo);
        }
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Product balance successfully submitted",
            // data: { product, plan },
        });
    },
    /**
     * Update the selling price of a sold product.
     *
     * Steps:
     * - Retrieve the company context from the authenticated user.
     * - Fetch the transaction item along with its latest payment details.
     * - Validate that there is no outstanding balance (i.e., balance owed must be zero)
     *   to allow a price update.
     * - Calculate the difference between the new price and the current total price.
     * - Update the transaction item with the new price per unit and the new total price.
     * - Adjust the latest payment record to reflect the updated total amount.
     * - Return a JSON response indicating that the product price has been successfully updated.
     */
    updateSoldPrice: async (req, res) => {
        const { company } = await userNdCompany(req.user);
        if (!company)
            throw new BadRequestError("Company not found.");
        const product = await prisma.transactionItem.findUnique({
            where: { id: req.params.itemId },
            include: {
                Transaction: {
                    select: {
                        Payments: {
                            select: { payments: { orderBy: { paymentDate: "desc" } } },
                        },
                        type: true,
                    },
                },
            },
        });
        if (!product)
            throw new NotFoundError("Product not found.");
        const isBalance = product?.Transaction?.Payments?.[0]?.payments?.[0]?.balanceOwed;
        if (Number(isBalance) !== 0) {
            throw new BadRequestError("Selling price cannot be updated, payment is outstanding.");
        }
        const latestPayment = product?.Transaction?.Payments?.[0]?.payments?.[0];
        const difference = Number(latestPayment?.totalAmount) - Number(product?.totalPrice);
        const plan = await prisma.transactionItem.update({
            where: { id: product.id, transactionId: product.transactionId },
            data: {
                pricePerUnit: Number(req.body.price) / Number(product?.quantity),
                totalPrice: Number(req.body.price),
            },
        });
        await prisma.payment.update({
            where: { id: latestPayment?.id },
            data: { totalAmount: Number(req.body.price) + difference },
        });
        res.status(StatusCodes.OK).json({
            success: true,
            msg: "Product price successfully updated",
            data: plan,
        });
    },
};
