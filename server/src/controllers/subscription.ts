import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, CustomAPIError, NotFoundError } from "../errors";
import { prisma } from "../utils/prisma";
import { SubscriptionJobs } from "../jobs/subscriptionJob";
import { paystackService } from "../services/paystackService";
import { my_plans } from "../utils/constants";
import { Tier } from "@prisma/client";

export const checkCompany = async ({ user }: any) => {
  const { email, companyId } = user;
  const company = await prisma.company.findUnique({
    where: { company_email: email, id: companyId },
    include: {
      Subscription: {
        select: { endDate: true, payStackCustomerID: true },
      },
    },
  });
  if (!company) {
    throw new NotFoundError("Company not found");
  }

  return { company };
};

export const checkBilling = async ({ body }: any) => {
  const { paymentPlan, billingType } = body;
  if (!paymentPlan || !billingType) {
    throw new BadRequestError("Billing type and payment plan are required");
  }

  return { paymentPlan, billingType };
};

export const SubscriptionCtrl = {
  /**
   * Update the company's subscription.
   *
   * Steps:
   * - Retrieve the company details for the current user.
   * - Validate and extract billing information (billingType and paymentPlan) from the request body.
   * - Calculate the next billing date from the current subscription's end date.
   * - Call the updateSubscriptionJob with the relevant details (billing info, company email, next billing date, company ID, and Paystack customer ID).
   * - Return a success response along with a payment URL (if provided by the transaction).
   */
  updateSubscription: async (req: Request, res: Response): Promise<void> => {
    // Get the company details for the current user.
    const { company } = await checkCompany({ user: req.user });
    // Validate billing info from the request body.
    const { billingType, paymentPlan } = await checkBilling({ body: req.body });

    // Calculate the next billing date from the current subscription's end date.
    const nextBillingDate = new Date(company.Subscription!.endDate as Date);

    // Execute the subscription update job, passing in the required details.
    const { transaction } = await SubscriptionJobs.updateSubscriptionJob({
      billingType,
      paymentPlan: paymentPlan,
      email: company.company_email,
      nextBillingDate,
      companyId: company.id,
      customerId: company.Subscription!.payStackCustomerID,
    });

    // Return a success response with the authorization URL if a transaction exists.
    res.status(StatusCodes.OK).json({
      msg: "Subscription has been updated successfully.",
      success: true,
      paymentUrl: transaction ? transaction.authorization_url : "",
    });
  },

  /**
   * Cancel the company's subscription.
   *
   * Steps:
   * - Retrieve the company details for the current user.
   * - Execute the cancellation job using the company's email, ID, and the current subscription's end date.
   * - Return a success response with the deactivation date.
   */
  cancelSubscription: async (req: Request, res: Response): Promise<void> => {
    // Retrieve the company details.
    const { company } = await checkCompany({ user: req.user });

    // Execute the subscription cancellation job.
    const { deactivationDate } = await SubscriptionJobs.cancelSubscriptionJob({
      email: company.company_email,
      companyId: company.id,
      cancelDate: company.Subscription!.endDate as Date,
    });

    // Respond with the cancellation result and deactivation date.
    res.status(StatusCodes.OK).json({
      msg: "Subscription has been canceled successfully.",
      success: true,
      deactivationDate,
    });
  },

  /**
   * Reactivate the company's subscription.
   *
   * Steps:
   * - Retrieve the company details for the current user.
   * - Validate and extract billing info from the request body.
   * - Initialize a transaction with the payment gateway (Paystack) using the company's email, the selected plan, and amount.
   * - If transaction initialization fails, throw an error.
   * - Update the company's subscription status to "ACTIVE" and update the subscription tier and billing type in the database.
   * - Return a success response with the payment URL from the transaction.
   */
  reactivateSubscription: async (
    req: Request,
    res: Response
  ): Promise<void> => {
    // Retrieve the company details.
    const { company } = await checkCompany({ user: req.user });
    // Validate and extract billing details.
    const { billingType, paymentPlan } = await checkBilling({ body: req.body });

    // Initialize a transaction with Paystack using the company's email and the chosen plan.
    const { transaction, error } = await paystackService.initializeTransaction({
      email: company.company_email,
      plan: my_plans[
        `${paymentPlan.toLowerCase()}_${billingType.toLowerCase()}`
      ],
      amount: "5000",
    });

    // If there was an error during transaction initialization, throw an error.
    if (error) {
      throw new CustomAPIError(
        "Payment gateway initialization failed",
        StatusCodes.BAD_GATEWAY
      );
    }

    // Update the company's subscription status and details in the database.
    await prisma.company.update({
      where: { id: company.id, company_email: company.company_email },
      data: {
        subscriptionStatus: "ACTIVE",
        Subscription: {
          update: {
            tier: paymentPlan.toUpperCase() as Tier,
            tierType: billingType === "month" ? "MONTHLY" : "YEARLY",
          },
        },
      },
    });

    // Return a success response with the transaction's payment URL.
    res.status(StatusCodes.OK).json({
      msg: "Subscription has been reactivated successfully.",
      success: true,
      paymentUrl: transaction.authorization_url,
    });
  },
};
