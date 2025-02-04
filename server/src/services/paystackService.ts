import Paystack from "@paystack/paystack-sdk";

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

class PayStackService {
	private paystack: Paystack;

	constructor() {
		// Validate the environment variable
		if (!process.env.PAY_STACK_SECRET_KEY) {
			console.log("PAYSTACK_SECRET_KEY is missing in environment variables");
			process.exit(1);
		}

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
		authorization: string;
		customer: string;
		start_date: Date;
	}) {
		try {
			const createSubRes = (await this.paystack.subscription.create({
				customer,
				plan,
				authorization,
				start_date,
			})) as CreateSubscriptionResponse;

			if (createSubRes.status === false) {
				return { error: createSubRes.message, subscription: null };
			}

			const getSub = (await this.paystack.subscription.fetch({
				code: createSubRes?.data.subscription_code,
			})) as GetSubscriptionResponse;

			if (getSub.status === false) {
				return { error: getSub.message, subscription: null };
			}

			return {
				subscription: {
					...createSubRes,
					endDate: new Date(getSub?.data.next_payment_date),
				},
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
				transaction: null,
				verify: null,
			};
		}
	}
}

export const paystackService = new PayStackService();
