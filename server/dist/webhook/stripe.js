import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import Stripe from "stripe";
import { BadRequestError, CustomAPIError } from "../errors/index.js";
import { getTierByPriceId } from "../data/subTier.js";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
});
const router = Router();
const captureRawBody = (req, res, next) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
        data += chunk;
    });
    req.on("end", () => {
        req.rawBody = data;
        next();
    });
};
const validateStripeSignature = (req, res, next) => {
    try {
        const sig = req.headers["stripe-signature"];
        if (!sig) {
            res.status(401).json({ error: "Invalid signature" });
            return;
        }
        req.signature = sig;
        next();
    }
    catch (error) {
        console.error("Signature validation error:", error);
        res.status(500).json({ error: "Internal server error" });
        return;
    }
};
const handleCreate = async (subscription) => {
    if (!subscription.items?.data?.[0]?.price?.id ||
        !subscription.metadata?.companyId ||
        !subscription.metadata?.tenantId) {
        console.error("Invalid subscription data:", subscription);
        throw new BadRequestError("Invalid subscription data");
    }
    // Determine the subscription tier based on the Stripe price ID
    const tier = getTierByPriceId(subscription.items.data[0].price.id);
    const companyId = subscription.metadata.companyId;
    const tenantId = subscription.metadata.tenantId;
    const customer = subscription.customer;
    // If customer is an object, extract its id; otherwise, use the string value directly
    const customerId = typeof customer === "string" ? customer : customer.id;
    if (!tier) {
        console.error("Tier not found for price ID:", subscription.items.data[0].price.id);
        throw new BadRequestError("Tier not found");
    }
    // Update the user subscription in the database with the new subscription details
    return await prisma.companyStripeSubscription.update({
        where: { companyId, tenantId },
        data: {
            stripeSubscriptionID: subscription.id,
            stripeCustomerID: customerId,
            stripeSubscriptionItemId: subscription.items.data[0].id,
            startDate: new Date(subscription.current_period_start * 1000).toISOString(),
            endDate: new Date(subscription.current_period_end * 1000).toISOString(),
        },
    });
};
const handleCharge = async (charge) => {
    if (!charge.paid)
        throw new BadRequestError("Charge not paid");
    const company = await prisma.company.findUnique({
        where: { company_email: charge.billing_details?.email },
        select: { id: true, tenantId: true },
    });
    if (!company)
        throw new BadRequestError("Company not found");
    const { card } = charge.payment_method_details;
    return await prisma.companyStripeSubscription.update({
        where: { companyId: company?.id, tenantId: company?.tenantId },
        data: {
            last4: card?.last4,
            card_type: card?.brand,
            exp_month: card?.exp_month,
            exp_year: card?.exp_year,
            company: {
                update: {
                    data: {
                        subscriptionStatus: "ACTIVE",
                    },
                },
            },
        },
    });
};
const handleCancelOrUpdate = async (subscription) => {
    // remove this and use jobs to handle cancelled subs
    if (subscription.cancel_at !== null) {
        return await prisma.company.update({
            where: {
                id: subscription.metadata.companyId,
                tenantId: subscription.metadata.tenantId,
            },
            data: {
                scheduledDeactivation: new Date(subscription.cancel_at * 1000).toISOString(),
            },
        });
    }
    const tier = getTierByPriceId(subscription.items.data[0].price.id);
    const customer = subscription.customer;
    const customerId = typeof customer === "string" ? customer : customer.id;
    if (tier == null)
        throw new BadRequestError("Tier not found");
    const splitTier = tier.name.split("(");
    const tierName = splitTier[0].toUpperCase();
    const tierType = splitTier[1].split(")")[0].toUpperCase();
    const subs = await prisma.companyStripeSubscription.findUnique({
        where: { stripeCustomerID: customerId },
    });
    // also this add a update job
    if (subs) {
        return await prisma.companyStripeSubscription.update({
            where: { stripeCustomerID: customerId },
            data: {
                stripeSubscriptionID: subscription.id,
                stripeCustomerID: customerId,
                stripeSubscriptionItemId: subscription.items.data[0].id,
                startDate: new Date(subscription.current_period_start * 1000).toISOString(),
                endDate: new Date(subscription.current_period_end * 1000).toISOString(),
                tier: tierName,
                tierType: tierType,
                company: {
                    update: {
                        data: {
                            scheduledDeactivation: null,
                            subscriptionStatus: "ACTIVE",
                        },
                    },
                },
            },
        });
    }
};
const handleFailedPayment = async (invoice) => {
    const { customer } = invoice;
    const companySubscription = await prisma.companyStripeSubscription.findUnique({
        where: { stripeCustomerID: customer },
        select: { companyId: true, tenantId: true },
    });
    if (!companySubscription) {
        console.error("Company subscription not found for customer:", customer);
        throw new BadRequestError("Company subscription not found");
    }
    // push a notification to the company
    await prisma.notification.create({
        data: {
            companyId: companySubscription.companyId,
            tenantId: companySubscription.tenantId,
            message: "Payment failed, please update your payment method",
            type: "payment_failed",
        },
    });
    // TODO:send email
    // Update the company subscription in the database with the new payment status
    return await prisma.company.update({
        where: {
            id: companySubscription.companyId,
            tenantId: companySubscription.tenantId,
        },
        data: {
            subscriptionStatus: "EXPIRED",
            CompanyStripeSubscription: {
                update: {
                    startDate: null,
                    endDate: null,
                    stripeSubscriptionID: null,
                    stripeSubscriptionItemId: null,
                },
            },
        },
    });
};
router
    .route("/webhook/stripe")
    .post([captureRawBody, validateStripeSignature], async (req, res) => {
    let event;
    try {
        // Construct and verify the Stripe event using the raw request body
        event = stripe.webhooks.constructEvent(req.rawBody, req.signature, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        // Log error if signature verification fails and return a 400 response
        console.error("Webhook signature verification failed:", err);
        throw new BadRequestError("Invalid webhook signature");
    }
    console.log({ a: event.type });
    // Handle the event
    try {
        switch (event.type) {
            case "customer.subscription.created":
                // Handle creation of a new subscription
                await handleCreate(event.data.object);
                break;
            case "charge.succeeded":
                // Handle creation of a new subscription
                await handleCharge(event.data.object);
                break;
            case "customer.subscription.updated":
                // Handle creation of a new subscription
                await handleCancelOrUpdate(event.data.object);
                break;
            case "invoice.payment_failed":
                // Handle creation of a new subscription
                await handleFailedPayment(event.data.object);
                break;
            default:
                // Log unhandled event types for further review
                console.log(`Unhandled event type: ${event.type}`);
        }
    }
    catch (err) {
        console.error("Error processing webhook event:", err);
        throw new CustomAPIError("Webhook handler error", 500);
    }
    // Return a response to acknowledge receipt of the event
    res.status(200).json({ success: true, msg: "Webhook handled" });
});
export default router;
