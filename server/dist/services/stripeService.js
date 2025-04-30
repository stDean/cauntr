import Stripe from "stripe";
import { BadRequestError } from "../errors/index.js";
import { subscriptionTiers } from "../data/subTier.js";
if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe secret key is missing. Please check your .env file.");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
});
export class StripeService {
    static async getCheckoutSession(company, tier) {
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer_email: company.company_email,
            subscription_data: {
                metadata: {
                    companyId: company.id,
                    tenantId: company.tenantId,
                },
            },
            payment_method_types: ["card"],
            line_items: [
                {
                    price: subscriptionTiers[tier].stripePriceId,
                    quantity: 1,
                },
            ],
            success_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/api/revalidate?tag=subscriptionHistory`,
            cancel_url: `${process.env.STRIPE_REDIRECT_CANCEL_URL}/settings?q=billing`,
        });
        return session.url;
    }
    static async getSubscriptionUpdateSession(subscription, tier) {
        if (subscription.stripeCustomerID == null ||
            subscription.stripeSubscriptionID == null ||
            subscription.stripeSubscriptionItemId == null) {
            throw new BadRequestError("Error updating subscription");
        }
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: subscription.stripeCustomerID,
            return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/api/revalidate?tag=subscriptionHistory`,
            flow_data: {
                type: "subscription_update_confirm",
                subscription_update_confirm: {
                    subscription: subscription.stripeSubscriptionID,
                    items: [
                        {
                            id: subscription.stripeSubscriptionItemId,
                            price: subscriptionTiers[tier].stripePriceId,
                            quantity: 1,
                        },
                    ],
                },
            },
        });
        return portalSession.url;
    }
    static async createCheckoutSession(subscription, tier, company) {
        // If the user has no Stripe customer ID, create a new checkout session.
        if (subscription.stripeCustomerID == null ||
            subscription.stripeCustomerID == "") {
            const url = await this.getCheckoutSession(company, tier);
            if (url == null) {
                console.error("Error creating checkout session");
                return;
            }
            // Redirect the user to the Stripe checkout page.
            return url;
        }
        else {
            // Otherwise, create a subscription upgrade session.
            const url = await this.getSubscriptionUpdateSession(subscription, tier);
            return url;
        }
    }
    // To manage subscriptions
    static async createCustomerPortalSession(subscription) {
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: subscription.stripeCustomerID,
            return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/api/revalidate?tag=subscriptionHistory`,
        });
        return portalSession.url;
    }
    static async createCancelSession(subscription) {
        // Create a billing portal session specifically for canceling a subscription.
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: subscription.stripeCustomerID,
            return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/api/revalidate?tag=subscriptionHistory`,
            flow_data: {
                type: "subscription_cancel",
                subscription_cancel: {
                    subscription: subscription.stripeSubscriptionID,
                },
            },
        });
        return portalSession.url;
    }
    static async getAllCustomerInvoices(customerId) {
        const invoices = await stripe.invoices.list({ customer: customerId });
        const subs = await stripe.subscriptions.list({
            customer: customerId,
        });
        if (!invoices) {
            throw new BadRequestError("Error getting invoices");
        }
        return { invoices, subs };
    }
}
