import nodemailer from "nodemailer";
import { Transporter } from "nodemailer";
import { prisma } from "../utils/prisma";
import { emit } from "process";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
}

export class EmailService {
  private transporter: Transporter;

  constructor(config: EmailConfig) {
    this.transporter = nodemailer.createTransport(config);
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Cauntr" <${process.env.SMTP_USER}>`,
        ...options,
      });
    } catch (error) {
      console.error("Email send failed:", error);
      throw new Error("Failed to send email");
    }
  }

  async sendVerificationOTP({
    email,
    token,
  }: {
    email: string;
    token: string;
  }): Promise<void> {
    if (!token || token.length !== 6) {
      throw new Error("Invalid token: OTP must be exactly 6 characters long.");
    }

    const html = `
      <div style="width: 700px; margin: auto; font-family: Arial, sans-serif;">
        <p style="font-size: 1.5rem; color: #333;">Hi there,</p>
        <p style="font-size: 16px; color: #555;">This is your verification code:</p>
        <div style="font-size: 24px; font-weight: bold; color: #050201; margin: 20px 0;">
          ${token
            .split("")
            .map(
              (char, index) =>
                `<span style="border: 2px solid #ff5722; padding: 6px 12px; margin: 0 2px; display: inline-block; border-radius: 5px;">${char}</span>`
            )
            .join("")}
        </div>
        <p style="font-size: 16px; color: #555;">This code will be valid for the next 5 minutes.</p>
        <p>Thanks,<br />Cauntr Team</p>
      </div>
    `;

    await this.sendEmail({
      to: email,
      subject: "Cauntr Verification Code",
      html,
    });
  }

  async sendInvoice(invoiceNo: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNo },
      include: {
        Company: { include: { CompanyAccount: true } },
        Transaction: {
          include: {
            Customer: true,
            TransactionItem: { include: { Product: true } },
            Payments: {
              include: {
                payments: {
                  include: { acctPaidTo: { include: { bank: true } } },
                  orderBy: { createdAt: "desc" },
                },
              },
            },
          },
        },
      },
    });

    if (!invoice) throw new Error("Invoice not found.");

    const companyData = {
      name: invoice?.Company?.company_name,
      email: invoice?.Company?.company_email,
      address: invoice?.Company?.CompanyAccount?.businessAddress,
      phone: invoice?.Company?.CompanyAccount?.phoneNumber,
    };

    const customerData = {
      name: invoice?.Transaction?.Customer?.name,
      email: invoice?.Transaction?.Customer?.email,
      phone: invoice?.Transaction?.Customer?.phone,
      address: invoice?.Transaction?.Customer?.address,
    };

    const res = invoice!.Transaction?.TransactionItem.map((t) => ({
      productName: t.Product.productName,
      price: t.Product.sellingPrice,
      qtyBought: t.quantity,
      total: t.totalPrice,
    }));

    const balances = invoice!.Transaction?.Payments[0].payments.map((p) => ({
      subTotal: p.totalAmount,
      balancedOwed: p.balanceOwed,
      totalPay: p.totalPay,
      vat: p.vat,
    }));

    const bankPaidWith = invoice!.Transaction?.Payments[0].payments.map(
      (p) => ({
        bankName: p.acctPaidTo?.bank?.bankName || null,
        acctName: p.acctPaidTo?.bank?.acctName || null,
        acctNo: p.acctPaidTo?.bank?.acctNo || null,
      })
    );

    const emailContent = generateInvoiceEmail(
      invoice, // From Prisma query
      companyData, // Your processed company data
      customerData, // Your processed customer data
      res, // Transaction items array
      balances?.[0],
      bankPaidWith?.[0] // First payment bank details
    );

    await this.sendEmail({
      to: customerData.email!,
      subject: "Sales Invoice",
      html: emailContent,
    });
  }
}

const createProductTable = (products: any) => `
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Product Name</th>
      <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Quantity</th>
      <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Price</th>
      <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Total</th>
    </tr>
    ${products
      .map(
        (p: any) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.productName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.qtyBought}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">$${p.price}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">$${p.total}</td>
      </tr>
    `
      )
      .join("")}
  </table>
`;

const generateInvoiceEmail = (
  invoice: any,
  companyData: any,
  customerData: any,
  products: any,
  paymentData: any,
  bankDetails: any
) => `
<div style="width: 700px; margin: auto; font-family: Arial, sans-serif; color: #333; padding: 20px; border: 1px solid #eee;">
  <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
    <div>
      <h1 style="margin: 0; font-size: 24px;">Invoice-${invoice.invoiceNo}</h1>
      <p style="color: ${
        invoice.status === "PAID" ? "#5cb85c" : "#d9534f"
      }; margin: 5px 0 0;">
        ${invoice.status === "DRAFT" ? "Pending" : invoice.status}
      </p>
    </div>
    <div style="text-align: right;margin-right: 3px;">
      <p style="margin: 3px 0;">Invoice Date: ${new Date(
        invoice.createdAt
      ).toLocaleDateString()}</p>
      <p style="margin: 3px 0;">Payment Date: ${new Date(
        invoice.paymentDate
      ).toLocaleDateString()}</p>
    </div>
  </div>

  <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
    <div style="margin-right: 20px;">
      <h3 style="margin: 0 0 10px;">${companyData.name}</h3>
      <p style="margin: 2px 0;">${companyData.address}</p>
      <p style="margin: 2px 0;">${companyData.phone}</p>
      <p style="margin: 2px 0;">${companyData.email}</p>
    </div>
    <div>
      <h3 style="margin: 0 0 10px;">Bill To</h3>
      <p style="margin: 2px 0;">${customerData.name}</p>
      <p style="margin: 2px 0;">${customerData.address}</p>
      <p style="margin: 2px 0;">${customerData.phone}</p>
      <p style="margin: 2px 0;">${customerData.email}</p>
    </div>
  </div>

  ${createProductTable(products)}

  <div style="text-align: right; margin-top: 20px;">
    <p style="margin: 5px 0;">Subtotal: $${paymentData.subTotal}</p>
    <p style="margin: 5px 0;">VAT: $${paymentData.vat}</p>
    <h3 style="margin: 10px 0; font-size: 18px;">
      Total Amount Paid: $${paymentData.totalPay}
    </h3>
  </div>

  ${
    bankDetails.bankName !== null && bankDetails.acctNo !== null
      ? `
  <div style="margin-top: 30px; padding: 20px; background: #f8f9fa;">
    <h3 style="margin: 0 0 15px;">Payment Details</h3>
    <p style="margin: 5px 0;">Account Name: ${bankDetails.acctName}</p>
    <p style="margin: 5px 0;">Bank Name: ${bankDetails.bankName}</p>
    <p style="margin: 5px 0;">Account Number: ${bankDetails.acctNo}</p>
   
  </div>
  `
      : ""
  }

   ${
     paymentData.balancedOwed > 0 && paymentData.balancedOwed !== null
       ? `
      <p style="color: #d9534f; margin: 10px 0 0;">
        Remaining Balance: $${paymentData.balancedOwed}
      </p>
    `
       : ""
   }

  <p style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
    Thank you for your business!<br>
    <strong>${companyData.name}</strong>
  </p>
</div>
`;

// Configure with environment variables
export const emailService = new EmailService({
  host: process.env.SMTP_HOST!,
  port: parseInt(process.env.SMTP_PORT!),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});
