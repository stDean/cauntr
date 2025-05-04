import { Condition, CustomerType, Direction, InstallmentFrequency, TransactionType, } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import { StatusCodes } from "http-status-codes";
import { InvoiceNumber } from "invoice-number";
import { prisma } from "./prisma.js";
// Product Utilities
export const productUtils = {
    findProductBySKU: async (tx, sku, company) => {
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
            throw new NotFoundError(`Product ${sku} not found`);
        return product;
    },
    updateProductQuantity: async (tx, productId, quantityChange) => {
        return tx.product.update({
            where: { id: productId },
            data: { quantity: { increment: quantityChange } },
        });
    },
    validateProductStock: (product, quantity) => {
        if (product.quantity < quantity) {
            throw new BadRequestError(`Insufficient stock for ${product.sku}`);
        }
    },
    normalizeCondition: (condition) => {
        if (!condition)
            return Condition.NEW;
        const upperCondition = condition.toUpperCase();
        return Object.values(Condition).includes(upperCondition)
            ? upperCondition
            : Condition.NEW;
    },
    validateProduct: (product) => {
        const errors = [];
        const requiredFields = ["productName", "productType", "brand", "condition"];
        requiredFields.forEach((field) => {
            if (!product[field]?.toString().trim()) {
                errors.push({ field, message: `${field} is required` });
            }
        });
        return errors.length > 0 ? errors : null;
    },
};
// Customer Utilities
export const customerUtils = {
    upsertCustomer: async (tx, details, company) => {
        return tx.customer.upsert({
            where: {
                name_phone_companyId_tenantId: {
                    name: details.name,
                    phone: details.phone,
                    companyId: company.id,
                    tenantId: company.tenantId,
                },
            },
            create: { ...details, companyId: company.id, tenantId: company.tenantId },
            update: details,
        });
    },
};
// Transaction Utilities
export const transactionUtils = {
    createTransaction: async (tx, type, config) => {
        return tx.transaction.create({
            data: {
                type,
                companyId: config.company.id,
                tenantId: config.company.tenantId,
                createdById: config.userId,
                customerId: config.customerId || null,
                TransactionItem: {
                    create: config.items.map((item) => ({
                        ...item,
                        totalPrice: item.pricePerUnit * item.quantity,
                    })),
                },
            },
            include: { TransactionItem: true },
        });
    },
    createSwapTransaction: async (tx, config) => {
        return tx.transaction.create({
            data: {
                type: TransactionType.SWAP,
                companyId: config.company.id,
                tenantId: config.company.tenantId,
                createdById: config.userId,
                customerId: config.customerId || null,
                TransactionItem: {
                    create: [
                        // Outgoing item
                        {
                            productId: config.outgoingProduct.id,
                            quantity: config.outgoingQuantity,
                            pricePerUnit: config.outgoingProduct.sellingPrice,
                            totalPrice: config.outgoingProduct.sellingPrice * config.outgoingQuantity,
                            direction: Direction.DEBIT,
                        },
                        // Incoming items
                        ...config.incomingProducts.map((product) => ({
                            productId: product.id,
                            quantity: product.quantity,
                            pricePerUnit: product.sellingPrice,
                            totalPrice: product.sellingPrice * product.quantity,
                            direction: Direction.CREDIT,
                        })),
                    ],
                },
            },
            include: { TransactionItem: true },
        });
    },
};
// Payment Utilities
export const paymentUtils = {
    createPaymentPlan: async (tx, config) => {
        return tx.paymentPlan.create({
            data: {
                installmentCount: config.installmentCount || 1,
                transactionId: config.transId,
                frequency: config.frequency?.toUpperCase() ||
                    InstallmentFrequency.ONE_TIME,
                customerId: config.customerId || null,
                customerType: config.balanceOwed
                    ? CustomerType.DEBTOR
                    : CustomerType.CUSTOMER,
                payments: {
                    create: {
                        totalAmount: config.amountPaid ?? 0,
                        method: config.paymentMethod?.toUpperCase() || "CASH",
                        balanceOwed: config.balanceOwed ?? 0,
                        vat: config.vat,
                        totalPay: config.totalPay,
                        acctPaidTo: config.paymentMethod === "BANK_TRANSFER"
                            ? {
                                connectOrCreate: {
                                    where: {
                                        userBankId: config.acctPaidTo?.userBankId,
                                    },
                                    create: {
                                        bank: {
                                            create: {
                                                bankName: config.acctPaidTo?.bankName || "",
                                                acctNo: config.acctPaidTo?.acctNo || "",
                                                acctName: config.acctPaidTo?.acctName || "",
                                            },
                                        },
                                    },
                                },
                            }
                            : undefined,
                    },
                },
            },
        });
    },
};
export const responseUtils = {
    success: (res, data, status = StatusCodes.OK) => {
        res.status(status).json({ success: true, data });
    },
    error: (res, message, status = StatusCodes.BAD_REQUEST, errors) => {
        res
            .status(status)
            .json({ success: false, message, ...(errors && { errors }) });
    },
    multiStatus: (res, results, errors) => {
        res.status(StatusCodes.MULTI_STATUS).json({
            created: results.length,
            failed: errors.length,
            data: results,
            errors,
        });
    },
};
// Validation Utilities
export const validationUtils = {
    validateRequiredFields: (fields, names) => {
        const missing = names.filter((name) => !fields[name]);
        if (missing.length) {
            throw new BadRequestError(`Missing required fields: ${missing.join(", ")}`);
        }
    },
    validateProductsExist: (found, requested) => {
        if (found.length !== requested.length) {
            const missing = requested.filter((sku) => !found.some((p) => p.sku === sku));
            throw new BadRequestError(`Missing products: ${missing.join(", ")}`);
        }
    },
    validateStockQuantities: (products, requests) => {
        const errors = requests
            .map((req) => {
            const product = products.find((p) => p.sku === req.sku);
            return product && product.quantity < req.quantity
                ? `Insufficient stock for ${req.sku} (${product.quantity} < ${req.quantity})`
                : null;
        })
            .filter(Boolean);
        if (errors.length) {
            throw new BadRequestError(errors.join("; "));
        }
    },
};
export function generateInvoice({ previousInvoice, }) {
    if (previousInvoice === undefined) {
        previousInvoice = "INV-0001";
    }
    // Generate the next invoice number based on the previous one
    const newInvoiceNumber = InvoiceNumber.next(previousInvoice);
    return newInvoiceNumber;
}
export async function generateInvoiceNo({ companyId, tenantId, }) {
    const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId },
    });
    if (!company)
        throw new NotFoundError("Company does not exist");
    const companyInitials = company.company_name
        .split(" ")
        .map((name) => name[0])
        .join("");
    const getYearAndDate = new Date();
    const yearLastTwo = getYearAndDate.getFullYear().toString().substr(-2);
    const month = (getYearAndDate.getMonth() + 1).toString().padStart(2, "0");
    const getPrevInvoice = await prisma.invoice.findMany({
        where: { companyId, tenantId },
        orderBy: { invoiceNo: "desc" },
        take: 1,
    });
    const prevInvoiceWithoutFirstFour = getPrevInvoice[0]?.invoiceNo.slice(5);
    const prev = getPrevInvoice[0]?.invoiceNo
        ? `${companyInitials}${yearLastTwo}-${prevInvoiceWithoutFirstFour}`
        : `${companyInitials}${yearLastTwo}-${month}0000`;
    const invoiceNumber = generateInvoice({ previousInvoice: prev });
    return invoiceNumber;
}
export async function getPrevInvoiceNo({ companyId, tenantId, }) {
    const invoiceNos = await prisma.invoice.findMany({
        where: { companyId, tenantId },
        orderBy: { createdAt: "desc" },
    });
    console.log({ invoiceNos });
    if (invoiceNos.length) {
        return { previousInvoice: invoiceNos[0].invoiceNo };
    }
    return { previousInvoice: undefined };
}
