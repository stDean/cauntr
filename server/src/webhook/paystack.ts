import { NextFunction, Request, Response, Router } from "express";
import { prisma } from "../utils/prisma";
import crypto from "crypto";

const router = Router();

const validatePayStackSignature = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const signature = crypto
      .createHmac("sha512", process.env.PAY_STACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (signature !== req.headers["x-paystack-signature"]) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    next();
  } catch (error) {
    console.error("Signature validation error:", error);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
};

const validateCompany = async ({
  email,
  status,
  tx,
}: {
  email: string;
  status: boolean;
  tx: any;
}) => {
  const company = await tx.company.findUnique({
    where: { company_email: email },
    include: {
      Subscription: {
        select: { payStackCustomerID: true, payStackSubscriptionCode: true },
      },
    },
  });

  if (!company) {
    return;
  }

  if (status) {
    return;
  }

  return { company };
};

const handleChargeSuccess = async (data: any, tx: any) => {
  const {
    id,
    customer: { email },
    authorization: { authorization_code },
    status,
  } = data;

  const companyResult = await validateCompany({
    email,
    status: status !== "success",
    tx,
  });
  if (!companyResult) {
    throw new Error("Company not found or invalid status");
  }
  const { company } = companyResult;

  return await tx.company.update({
    where: { company_email: company.company_email },
    data: {
      Subscription: {
        update: {
          data: { authorization_code, transactionId: id.toString() },
        },
      },
    },
  });
};

const handleSubscriptionCreate = async (data: any, tx: any) => {
  const {
    subscription_code,
    next_payment_date,
    customer: { email },
    status,
    authorization: {
      authorization_code,
      last4,
      exp_month,
      exp_year,
      card_type,
      bank,
    },
  } = data;

  const companyResult = await validateCompany({
    email,
    status: status !== "active",
    tx,
  });
  if (!companyResult) {
    throw new Error("Company not found or invalid status");
  }
  const { company } = companyResult;

  return await tx.company.update({
    where: { company_email: company.company_email },
    data: {
      canUpdate: true,
      canCancel: true,
      Subscription: {
        update: {
          data: {
            payStackSubscriptionCode: subscription_code,
            startDate: new Date(),
            endDate: new Date(next_payment_date),
            authorization_code,
            last4,
            exp_month,
            exp_year,
            card_type,
            bank,
          },
        },
      },
    },
  });
};

const handleInvoiceUpdate = async (data: any, tx: any) => {
  const { subscription, customer, status, authorization } = data;

  const companyResult = await validateCompany({
    email: customer.email,
    status: status !== "success",
    tx,
  });
  if (!companyResult) {
    throw new Error("Company not found or invalid status");
  }
  const { company } = companyResult;

  return await tx.company.update({
    where: { company_email: company.company_email },
    data: {
      subscriptionStatus: "ACTIVE",
      canUpdate: true,
      canCancel: true,
      Subscription: {
        update: {
          data: {
            startDate: new Date(),
            endDate: new Date(subscription.next_payment_date),
            payStackSubscriptionCode: subscription.subscription_code,
            authorization_code: authorization.authorization_code,
            last4: authorization.last4,
            exp_month: authorization.exp_month,
            exp_year: authorization.exp_year,
            card_type: authorization.card_type,
            bank: authorization.bank,
          },
        },
      },
    },
  });
};

const handleInvoiceFailed = async (data: any, tx: any) => {
  const { customer, status } = data;

  const companyResult = await validateCompany({
    email: customer.email,
    status: status !== "success",
    tx,
  });
  if (!companyResult) {
    throw new Error("Company not found or invalid status");
  }
  const { company } = companyResult;

  return await tx.company.update({
    where: { company_email: company.company_email },
    data: {
      subscriptionStatus: "EXPIRED",
      canUpdate: true,
      canCancel: false,
      Subscription: {
        update: {
          data: {
            startDate: null,
            endDate: null,
          },
        },
      },
    },
  });
};

router
  .route("/webhook")
  .post(
    validatePayStackSignature,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const { event, data } = req.body;

          console.log({ event });

          // Validate payload structure
          if (!event && !data) {
            throw new Error("Invalid payload structure");
          }

          // Check for duplicate event
          const existingEvent = await tx.webhookEvent.findUnique({
            where: { eventId: String(data.id) },
          });

          if (existingEvent) {
            return { status: "duplicate", data: null };
          }

          // Create audit record first
          const auditRecord = await tx.webhookEvent.create({
            data: {
              eventId: String(data.id),
              eventType: event,
              payload: data,
              status: "processing",
              attempts: 1,
            },
          });

          try {
            let processedData;
            switch (event) {
              case "charge.success":
                processedData = await handleChargeSuccess(data, tx);
                break;
              case "subscription.create":
                processedData = await handleSubscriptionCreate(data, tx);
                break;
              case "invoice.update":
                processedData = await handleInvoiceUpdate(data, tx);
                break;
              case "invoice.payment_failed":
                processedData = await handleInvoiceFailed(data, tx);
                break;
              // Add other event cases here
              default:
                await tx.webhookEvent.update({
                  where: { id: auditRecord.id },
                  data: { status: "unhandled" },
                });
                return { status: "unhandled", data: null };
            }

            // Update audit record on success
            await tx.webhookEvent.update({
              where: { id: auditRecord.id },
              data: {
                status: "processed",
                processedAt: new Date(),
              },
            });

            return { status: "success", data: processedData };
          } catch (processError) {
            // Update audit record on processing failure
            await tx.webhookEvent.update({
              where: { id: auditRecord.id },
              data: {
                status: "failed",
                attempts: { increment: 1 },
              },
            });
            throw processError;
          }
        });

        // Handle transaction result
        if (result?.status === "duplicate") {
          res.status(200).json({ status: "Event already processed" });
          return;
        }

        if (result?.status === "unhandled") {
          res.status(200).json({ status: "Event not handled" });
          return;
        }

        res.status(200).json({
          status: "Webhook processed successfully",
          data: result?.data,
        });
      } catch (error) {
        console.error("Webhook processing error:", error);

        const statusCode =
          error instanceof Error && error.message.includes("Invalid")
            ? 400
            : 500;

        res.status(statusCode).json({
          error:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }
  );

export default router;
