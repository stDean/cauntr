import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors";
import { emailService } from "../services/emailService";
import { userNdCompany } from "../utils/helper";
import { prisma } from "../utils/prisma.h";
import { generateInvoiceNo } from "../utils/helperUtils";

export const InvoiceCtrl = {
  createInvoice: async (req: Request, res: Response) => {
    const { user, body } = req;
    const { company, user: authUser } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    return prisma.$transaction(async (tx) => {
      const {
        customerDetails: { name, phone, email, address },
        payment: { method, totalAmount, paymentDate, vat },
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
                pricePerUnit: Number(pricePerUnit),
                totalPrice: Number(totalPrice),
                quantity: Number(quantity),
              };
            }),
          },
        },
      });

      await tx.payment.create({
        data: {
          method: method.toUpperCase(),
          totalPay: 0,
          totalAmount: Number(totalAmount),
          balanceOwed: Number(totalAmount),
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

      const invoiceNumber = await generateInvoiceNo({
        companyId: company.id,
        tenantId: company.tenantId,
      });

      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceNo: invoiceNumber,
          paymentDate: new Date(paymentDate),
          tenantId: company.tenantId,
          companyId: company.id,
          status: "DRAFT",
          transactionId: transaction.id,
        },
      });

      res
        .status(StatusCodes.CREATED)
        .json({ msg: "Invoice successfully created", createdInvoice });
    });
  },

  getInvoices: async (req: Request, res: Response) => {
    const { company } = await userNdCompany(req.user);
    if (!company) throw new UnauthenticatedError("No company found");

    const invoices = await prisma.invoice.findMany({
      where: { companyId: company.id, tenantId: company.tenantId },
      include: {
        Transaction: {
          include: {
            Customer: true,
            Payments: {
              include: { payments: { orderBy: { createdAt: "desc" } } },
            },
          },
        },
      },
      orderBy: { invoiceNo: "asc" },
    });

    const returnedData = invoices.map((i) => ({
      invoiceNo: i.invoiceNo,
      customerName: i.Transaction?.Customer?.name,
      amount: i.Transaction?.Payments[0].payments[0].totalAmount,
      status: i.status,
      email: i.Transaction?.Customer?.email,
      planId: i.Transaction?.Payments[0].id,
      paymentId: i.Transaction?.Payments[0].payments[0].id,
    }));

    res
      .status(StatusCodes.OK)
      .json({ msg: "Success", data: returnedData, nbHits: invoices.length });
  },

  getInvoice: async (req: Request, res: Response) => {
    const {
      user,
      params: { invoiceNo },
    } = req;
    const { company } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNo, tenantId: company.tenantId, companyId: company.id },
      include: {
        Transaction: {
          include: {
            Payments: {
              include: {
                payments: {
                  orderBy: { createdAt: "desc" },
                  include: { acctPaidTo: { include: { bank: true } } },
                },
              },
            },
            Company: { include: { CompanyAccount: true } },
            Customer: true,
            TransactionItem: { include: { Product: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundError("Invoice does not exist");

    const returnedData = {
      invoiceData: {
        invoiceNo: invoice.invoiceNo,
        invoiceDate: invoice.createdAt,
        paymentDate: invoice.paymentDate,
        status: invoice.status,
      },
      companyData: {
        name: invoice.Transaction?.Company.company_name,
        email: invoice.Transaction?.Company.company_email,
        phone: invoice.Transaction?.Company.CompanyAccount?.phoneNumber,
        address: invoice.Transaction?.Company.CompanyAccount?.businessAddress,
      },
      billTo: {
        name: invoice.Transaction?.Customer?.name,
        email: invoice.Transaction?.Customer?.email,
        phone: invoice.Transaction?.Customer?.phone,
        address: invoice.Transaction?.Customer?.address,
      },
      balanceDue: {
        amount: invoice.Transaction?.Payments[0].payments[0].balanceOwed,
        dueDate: invoice.paymentDate,
      },
      products: invoice.Transaction?.TransactionItem.map((p) => ({
        name: p.Product.productName,
        qty: p.quantity,
        ppu: p.pricePerUnit,
        total: Number(p.pricePerUnit) * Number(p.quantity),
        totalPrice: p.totalPrice,
      })),
      payments: {
        subTotal: invoice.Transaction?.Payments[0].payments[0].totalAmount,
        totalPaid: invoice.Transaction?.Payments[0].payments[0].totalPay,
      },
      bankPaidTo: {
        bankName:
          invoice.Transaction?.Payments[0].payments[0].acctPaidTo?.bank
            ?.bankName,
        acctNo:
          invoice.Transaction?.Payments[0].payments[0].acctPaidTo?.bank?.acctNo,
        acctName:
          invoice.Transaction?.Payments[0].payments[0].acctPaidTo?.bank
            ?.acctName,
      },
    };

    console.log({
      a: invoice.Transaction?.Payments[0].payments[0].acctPaidTo?.bank
        ?.bankName,
    });

    res.status(StatusCodes.OK).json({ msg: "Success", data: returnedData });
  },

  resendInvoice: async (req: Request, res: Response) => {
    const {
      user,
      params: { invoiceNo },
    } = req;
    const { company } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    await emailService.sendInvoice(invoiceNo);

    res.status(StatusCodes.OK).json({ msg: "Email sent successfully!" });
  },

  markAsPaid: async (req: Request, res: Response) => {
    const {
      user,
      params: { invoiceNo, paymentId, planId },
    } = req;
    const { company } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    const getPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { totalAmount: true },
    });

    const updatedInvoice = await prisma.invoice.update({
      where: { invoiceNo, tenantId: company.tenantId, companyId: company.id },
      data: {
        paymentDate: new Date(),
        status: "PAID",
        Transaction: {
          update: {
            Payments: {
              update: {
                where: { id: planId },
                data: {
                  customerType: "CUSTOMER",
                  payments: {
                    update: {
                      where: { id: paymentId },
                      data: { totalPay: getPayment?.totalAmount },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    res
      .status(StatusCodes.OK)
      .json({ msg: "Invoice successfully paid.", data: updatedInvoice });
  },

  recordPayment: async (req: Request, res: Response) => {
    const {
      user,
      params: { invoiceNo, planId },
      body: { amount, method, paymentMethod },
    } = req;
    const { company } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    return prisma.$transaction(async (tx) => {
      const paymentPlan = await tx.paymentPlan.findUnique({
        where: { id: planId },
        include: { payments: { orderBy: { createdAt: "desc" } } },
      });

      if (Number(amount) > Number(paymentPlan?.payments[0].balanceOwed)) {
        throw new BadRequestError("Cannot pay more than you owe.");
      }

      const payment = await tx.payment.create({
        data: {
          method: method.toUpperCase(),
          totalPay: Number(amount) + Number(paymentPlan?.payments[0].totalPay),
          balanceOwed:
            Number(paymentPlan?.payments[0].balanceOwed) - Number(amount),
          acctPaidTo:
            method.toUpperCase() === "CASH"
              ? undefined
              : {
                  connectOrCreate: {
                    where: { userBankId: paymentMethod.userBankId },
                    create: {
                      bank: {
                        create: {
                          bankName: paymentMethod.bankName,
                          acctName: paymentMethod.acctName,
                          acctNo: paymentMethod.acctNo,
                        },
                      },
                    },
                  },
                },
          totalAmount: Number(paymentPlan?.payments[0].totalAmount!),
          balancePaid: Number(amount),
        },
      });

      const updatedInvoice = await tx.invoice.update({
        where: { invoiceNo, tenantId: company.tenantId, companyId: company.id },
        data: {
          paymentDate: new Date(),
          status:
            Number(paymentPlan?.payments[0].balanceOwed) - Number(amount) === 0
              ? "PAID"
              : "PART_PAID",
          Transaction: {
            update: {
              Payments: {
                update: {
                  where: { id: planId },
                  data: {
                    customerType:
                      Number(paymentPlan?.payments[0].balanceOwed) -
                        Number(amount) ===
                      0
                        ? "CUSTOMER"
                        : "DEBTOR",
                    payments: {
                      connect: { id: payment.id },
                    },
                  },
                },
              },
            },
          },
        },
      });

      res.status(StatusCodes.OK).json({
        msg: `Payment of ${amount} successful.`,
        updatedInvoice,
      });
    });
  },

  invoiceSummary: async (req: Request, res: Response) => {
    const { user } = req;
    const { company } = await userNdCompany(user);
    if (!company) throw new UnauthenticatedError("No company found");

    const invoices = await prisma.invoice.findMany({
      where: { companyId: company.id, tenantId: company.tenantId },
      include: {
        Transaction: {
          include: {
            Customer: true,
            Payments: {
              include: { payments: { orderBy: { createdAt: "desc" } } },
            },
          },
        },
      },
    });

    const customers = Array.from(
      new Map(
        invoices
          .map((i) => i.Transaction?.Customer)
          .filter((customer) => customer)
          .map((customer) => [customer?.id, customer])
      ).values()
    );

    const pay = invoices.map((i) => ({
      totalAmount: i.Transaction?.Payments[0].payments[0].totalAmount,
      totalPaid: i.Transaction?.Payments[0].payments[0].totalPay,
    }));

    const returnedData = {
      clientServed: customers.length,
      invoiceGenerated: invoices.length,
      invoiceAmount: pay.reduce((a, p) => {
        return a + Number(p.totalAmount);
      }, 0),
      invoicePaid: pay.reduce((a, p) => {
        return a + Number(p.totalPaid);
      }, 0),
    };

    res.status(StatusCodes.OK).json({ msg: "success", returnedData });
  },
};
