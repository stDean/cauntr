import { Company } from "@prisma/client";
import Stripe from "stripe";
import { BadRequestError } from "../errors";
import { subscriptionTiers, TierNames } from "../data/subTier";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
	apiVersion: "2025-02-24.acacia",
	typescript: true,
});

export class StripeService {
	private static async getCheckoutSession(
		company: Partial<Company>,
		tier: TierNames
	) {
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
			success_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/settings/billing`,
			cancel_url: `${process.env.STRIPE_REDIRECT_CANCEL_URL}/settings/billing`,
		} as Stripe.Checkout.SessionCreateParams);

		return session.url;
	}

	private static async getSubscriptionUpdateSession(
		subscription: {
			stripeCustomerID: string | null;
			stripeSubscriptionID: string | null;
			stripeSubscriptionItemId: string | null;
		},
		tier: TierNames
	) {
		if (
			subscription.stripeCustomerID == null ||
			subscription.stripeSubscriptionID == null ||
			subscription.stripeSubscriptionItemId == null
		) {
			throw new BadRequestError("Error updating subscription");
		}

		const portalSession = await stripe.billingPortal.sessions.create({
			customer: subscription.stripeCustomerID,
			return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/settings/billing`,
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

	static async createCheckoutSession(
		subscription: {
			stripeCustomerID: string | null;
			stripeSubscriptionID: string | null;
			stripeSubscriptionItemId: string | null;
		},
		tier: TierNames,
		company: Partial<Company>
	) {
		// If the user has no Stripe customer ID, create a new checkout session.
		if (
			subscription.stripeCustomerID == null ||
			subscription.stripeCustomerID == ""
		) {
			const url = await this.getCheckoutSession(company, tier);
			if (url == null) {
				console.error("Error creating checkout session");
				return;
			}
			// Redirect the user to the Stripe checkout page.
			return url;
		} else {
			// Otherwise, create a subscription upgrade session.
			const url = await this.getSubscriptionUpdateSession(subscription, tier);
			return url;
		}
	}

	// To manage subscriptions
	static async createCustomerPortalSession(subscription: {
		stripeCustomerID: string;
	}) {
		const portalSession = await stripe.billingPortal.sessions.create({
			customer: subscription.stripeCustomerID,
			return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/settings/billing`,
		});

		return portalSession.url;
	}

	static async createCancelSession(subscription: {
		stripeCustomerID: string;
		stripeSubscriptionID: string;
	}) {
		// Create a billing portal session specifically for canceling a subscription.
		const portalSession = await stripe.billingPortal.sessions.create({
			customer: subscription.stripeCustomerID,
			return_url: `${process.env.STRIPE_REDIRECT_SUCCESS_URL}/settings/billing`,
			flow_data: {
				type: "subscription_cancel",
				subscription_cancel: {
					subscription: subscription.stripeSubscriptionID,
				},
			},
		});

		return portalSession.url;
	}

	static async getAllCustomerInvoices(customerId: string) {
		const invoices = await stripe.invoices.list({
			customer: customerId,
		});

		if (!invoices) {
			throw new BadRequestError("Error getting invoices");
		}

		return { invoices };
	}

	static getTierByPriceId(stripePriceId: string) {
		return Object.values(subscriptionTiers).find(
			tier => tier.stripePriceId === stripePriceId
		);
	}
}
