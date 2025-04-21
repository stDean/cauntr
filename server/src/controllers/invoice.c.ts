import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { userNdCompany } from "../utils/helper";
import { UnauthenticatedError } from "../errors";
import { prisma } from "../utils/prisma.h";
import { TransactionType } from "@prisma/client";

export const InvoiceCtrl = {
  createInvoice: async (req: Request, res: Response) => {
    const { user, body } = req;
    const { company, user: authUser } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    return prisma.$transaction(async (tx) => {
      const {
        customerDetails: { name, phone, email, address },
        payment: { method, totalPay, totalAmount, paymentDate, vat },
      } = body;

      const customer = await tx.customer.upsert({
        where: { name_phone: { name, phone } },
        create: {
          name,
          email,
          phone,
          address,
          tenantId: company.tenantId,
          Company: { connect: { id: company.id } },
        },
        update: { name, email, phone, address },
      });

      const transaction = await tx.transaction.create({
        data: {
          tenantId: company.tenantId,
          companyId: company.id,
          createdById: authUser.id,
          type: "SALE",
          customerId: customer.id,
          TransactionItem: {
            create: body.productDetails.map((product: any) => {
              const { productId, pricePerUnit, totalPrice, quantity } = product;
              return {
                productId,
                pricePerUnit,
                totalPrice,
                quantity,
              };
            }),
          },
        },
      });

      await tx.payment.create({
        data: {
          method: method.toUpperCase(),
          totalPay,
          totalAmount,
          acctPaidTo:
            method.toUpperCase() === "CASH"
              ? undefined
              : {
                  connectOrCreate: {
                    where: { userBankId: body.paymentMethod.userBankId },
                    create: {
                      bank: {
                        create: {
                          bankName: body.paymentMethod.bankName,
                          acctName: body.paymentMethod.acctName,
                          acctNo: body.paymentMethod.acctNo,
                        },
                      },
                    },
                  },
                },
          paymentDate: new Date(paymentDate),
          vat,
          PaymentPlan: {
            create: {
              frequency: "ONE_TIME",
              installmentCount: 1,
              customerId: customer.id,
              customerType: "DEBTOR",
              transactionId: transaction.id,
            },
          },
        },
      });

      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceNo: "createdInvoice001",
          paymentDate: new Date(paymentDate),
          tenantId: company.tenantId,
          companyId: company.id,
          status: "DRAFT",
          transactionId: transaction.id,
        },
      });

      res
        .status(StatusCodes.OK)
        .json({ msg: "Invoice successfully created", createdInvoice });
    });
  },

  getInvoices: async (req: Request, res: Response) => {},

  getInvoice: async (req: Request, res: Response) => {},

  resendInvoice: async (req: Request, res: Response) => {},

  markAsPaid: async (req: Request, res: Response) => {},

  recordPayment: async (req: Request, res: Response) => {},
};
