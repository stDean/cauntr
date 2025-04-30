import { BillingType, Tier } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { getTierByPriceId, TierNames } from "../data/subTier";
import { BadRequestError, NotFoundError } from "../errors";
import { StripeService } from "../services/stripeService";
import { prisma } from "../utils/prisma";
import Stripe from "stripe";

interface BillingHistory {
  planName: string;
  startDate: Date;
  endDate: Date;
  amount: number;
  status: Stripe.Invoice.Status | string;
}

const checkSub = async (companyId: string) => {
  if (!companyId) throw new BadRequestError("Company ID not found");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, tenantId: true, company_email: true },
  });

  const companySubscription = await prisma.companyStripeSubscription.findFirst({
    where: { companyId: company!.id, tenantId: company!.tenantId },
    select: {
      stripeCustomerID: true,
      stripeSubscriptionID: true,
      stripeSubscriptionItemId: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!companySubscription)
    throw new NotFoundError("Company has no subscription");

  return { companySubscription, company };
};

export const StripeCtrl = {
  createSubscription: async (req: Request, res: Response): Promise<void> => {
    const { companySubscription, company } = await checkSub(req.user.companyId);
    const tier = `${req.body.tier}_${req.body.tierType}`;

    const url = await StripeService.createCheckoutSession(
      companySubscription,
      tier as TierNames,
      company!
    );
    if (url === null) {
      throw new BadRequestError("Error creating checkout session");
    }

    await prisma.company.update({
      where: { id: company!.id },
      data: {
        CompanyStripeSubscription: {
          update: {
            startDate: new Date(),
            tier: `${req.body.tier}`.toUpperCase() as Tier,
            tierType: `${req.body.tierType}`.toUpperCase() as BillingType,
          },
        },
      },
    });

    res.status(StatusCodes.OK).json({ success: true, stripePaymentUrl: url });
  },

  cancelStripeSubscription: async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { companySubscription } = await checkSub(req.user.companyId);
    const url = await StripeService.createCancelSession({
      stripeSubscriptionID: companySubscription.stripeSubscriptionID!,
      stripeCustomerID: companySubscription.stripeCustomerID!,
    });
    if (url === null) {
      throw new BadRequestError("Error creating cancel session");
    }

    res.status(StatusCodes.OK).json({ success: true, stripeCancelUrl: url });
  },

  manageStripeSubscription: async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const { companySubscription } = await checkSub(req.user.companyId);
    const url = await StripeService.createCustomerPortalSession({
      stripeCustomerID: companySubscription.stripeCustomerID!,
    });
    if (url === null) {
      throw new BadRequestError("Error creating manage session");
    }

    res.status(StatusCodes.OK).json({ success: true, stripeManageUrl: url });
  },

  getSubDetails: async (req: Request, res: Response): Promise<void> => {
    const { companySubscription } = await checkSub(req.user.companyId);

    const { invoices } = await StripeService.getAllCustomerInvoices(
      companySubscription.stripeCustomerID!
    );

    if (!invoices) throw new BadRequestError("Error getting invoices");

    const cardDetails = await prisma.companyStripeSubscription.findFirst({
      where: { stripeCustomerID: companySubscription.stripeCustomerID! },
      select: {
        last4: true,
        card_type: true,
        exp_month: true,
        exp_year: true,
        company: { select: { company_email: true, subscriptionStatus: true } },
      },
    });

    if (!cardDetails) throw new NotFoundError("Card details not found");

    const billingHistory: BillingHistory[] = invoices.data.map((invoice) => {
      // Get all line items with plans
      const planLineItems = invoice.lines.data.filter((line) => line.plan);

      // Aggregate plan names and amounts
      const { planNames, totalAmount } = planLineItems.reduce(
        (acc, line) => {
          const plan = getTierByPriceId(line.plan!.id);
          acc.planNames.push(`${plan?.name} Plan` || "Unknown");
          acc.totalAmount += line.amount; // Amount in kobo
          return acc;
        },
        { planNames: [] as string[], totalAmount: 0 }
      );

      const statusMap: Record<Stripe.Invoice.Status, string> = {
        draft: "Pending",
        open: "Awaiting Payment",
        paid: "Successful",
        void: "Canceled",
        uncollectible: "Failed",
      };

      return {
        planName: planNames.join(", ") || "Multiple Plans",
        startDate: new Date(companySubscription.startDate!),
        endDate: new Date(companySubscription.endDate!),
        amount: totalAmount / 100, // Convert cents to naira
        status: statusMap[invoice.status!] ?? "Unknown",
      };
    });

    res
      .status(StatusCodes.OK)
      .json({ success: true, billingHistory, cardDetails });
  },
};
