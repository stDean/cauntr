import Paystack from "@paystack/paystack-sdk";
import { my_plans } from "../helpers/constants";

interface InitializeParams {
	email: string;
	amount: string;
	plan?: string;
}

interface TransactionResult {
	transaction: any | null; // Replace 'any' with more specific type if needed
	verify: any | null;
	error: string | null;
}

export interface InitializeTransactionResponseData {
	reference: string;
	authorization_url: string;
	access_code: string;
}

interface InitializeTransactionResponse {
	status: boolean;
	message: string;
	data: InitializeTransactionResponseData;
}

export interface VerifyTransactionResponseData {
	status: string;
	message: string | null;
	customer?: {
		id: number;
		customer_code: string;
		email: string;
	};
}

interface VerifyTransactionResponse {
	status: boolean;
	message: string;
	data: VerifyTransactionResponseData;
}

interface CreateSubscriptionResponseData {
	authorization: { authorization_code: string };
	subscription_code: string;
}

interface CreateSubscriptionResponse {
	status: boolean;
	message: string;
	data: CreateSubscriptionResponseData;
}

interface GetSubscriptionResponse {
	status: boolean;
	message: string;
	data: {
		next_payment_date: string;
	};
}

interface RefundTransactionResponse {
	status: boolean;
	message: string;
}

interface CustomerResponseData {
	status: boolean;
	message: string;
	data: {
		id: string;
		email: string;
	}[];
}

interface SubscriptionsResponseData {
	status: boolean;
	message: string;
	data: {
		id: number;
		status: string;
		email_token: string;
		subscription_code: string;
		next_payment_date: Date;
		plan: { plan_code: string };
	}[];
}

export class PayStackService {
	private paystack: Paystack;

	constructor() {
		this.paystack = new Paystack(process.env.PAY_STACK_SECRET_KEY);
	}

	async initializeTransaction({
		email,
		amount,
		plan,
	}: InitializeParams): Promise<TransactionResult> {
		try {
			// Step 1: Initialize transaction
			const initializeTransactionRes =
				(await this.paystack.transaction.initialize({
					email,
					amount,
					plan,
					channels: ["card"],
					callback_url: process.env.PAY_STACK_REDIRECT_URL,
				})) as InitializeTransactionResponse;

			if (
				!initializeTransactionRes.status ||
				!initializeTransactionRes.data?.reference
			) {
				return {
					error: initializeTransactionRes.message,
					transaction: null,
					verify: null,
				};
			}

			// Step 2: Verify transaction
			const verifyTransRes = (await this.paystack.transaction.verify({
				reference: initializeTransactionRes.data.reference,
			})) as VerifyTransactionResponse;

			if (!verifyTransRes.status) {
				return {
					error: verifyTransRes.message,
					transaction: null,
					verify: null,
				};
			}

			return {
				transaction:
					initializeTransactionRes.data as InitializeTransactionResponseData,
				verify: verifyTransRes.data as VerifyTransactionResponseData,
				error: null,
			};
		} catch (error: any) {
			return {
				error: error.message || "Unknown error occurred",
				transaction: null,
				verify: null,
			};
		}
	}

	async createSubscription({
		plan,
		authorization,
		customer,
		start_date,
	}: {
		plan: string;
		authorization?: string;
		customer: string;
		start_date: Date;
	}) {
		try {
			const createSubRes = (await this.paystack.subscription.create({
				customer,
				plan,
				authorization: authorization || "",
				start_date: start_date,
			})) as CreateSubscriptionResponse;

			if (createSubRes.status === false) {
				return { error: createSubRes.message, subscription: null };
			}

			const { getSub } = await this.getSubscription({
				code: createSubRes?.data.subscription_code,
			});

			return {
				subscription: {
					...createSubRes,
					endDate: getSub?.data.next_payment_date
						? new Date(getSub.data.next_payment_date)
						: "",
				},
				error: null,
			};
		} catch (error: any) {
			return {
				error: error.message || "Unknown error occurred",
				subscription: null,
			};
		}
	}

	async refundTransaction({
		transId,
		amount,
	}: {
		transId: number;
		amount: string;
	}) {
		try {
			const refundRes = (await this.paystack.refund.create({
				transaction: transId,
				amount,
			})) as RefundTransactionResponse;

			if (refundRes.status === false) {
				return { error: refundRes.message };
			}

			return { msg: refundRes.message, error: null };
		} catch (error: any) {
			return {
				error: error.message || "Unknown error occurred",
				msg: null,
			};
		}
	}

	async cancelSubscription({ email }: { email: string }) {
		try {
			const { subscriptions } = await this.getSubscriptions({ email });
			if (!subscriptions || subscriptions.length === 0) {
				return { error: "No active subscriptions found" };
			}

			const disabledRes = await this.paystack.subscription.disable({
				code: subscriptions[0].subscription_code,
				token: subscriptions[0].email_token,
			});
			if (disabledRes.status === false) {
				return { error: disabledRes.message };
			}

			return { success: true };
		} catch (error: any) {
			return {
				error: error.message || "Unknown error occurred",
				msg: null,
			};
		}
	}

	private async getSubscription({ code }: { code: string }) {
		const getSub = (await this.paystack.subscription.fetch({
			code: code,
		})) as GetSubscriptionResponse;

		if (getSub.status === false) {
			return { error: getSub.message, subscription: null };
		}

		return { getSub };
	}

	private async getSubscriptions({ email }: { email: string }) {
		const { theCustomer } = await this.getCustomer({ email });

		const subs = (await this.paystack.subscription.list({
			customer: theCustomer!.id,
		})) as SubscriptionsResponseData;
		if (subs.status === false) {
			return { error: "Something went wrong" };
		}

		const my_plans_array = Array.from(Object.values(my_plans));

		const subscriptions = subs.data.filter(
			subscription =>
				subscription.status === "active" &&
				my_plans_array.indexOf(subscription.plan.plan_code) !== -1
		);

		return { subscriptions };
	}

	private async getCustomer({ email }: { email: string }) {
		const customerRes = (await this.paystack.customer.list(
			{}
		)) as CustomerResponseData;
		if (customerRes.status === false) {
			return { error: "No customer with that email" };
		}

		const theCustomer = customerRes.data.find(
			customer => customer.email === email
		);

		return { theCustomer };
	}
}

export const paystackService = new PayStackService();
