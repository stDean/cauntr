import Paystack from "@paystack/paystack-sdk";

interface InitializeParams {
	email: string;
	amount: string;
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
	}: InitializeParams): Promise<TransactionResult> {
		try {
			// Step 1: Initialize transaction
			const initializeTransactionRes =
				(await this.paystack.transaction.initialize({
					email,
					amount,
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
}

export const paystackService = new PayStackService();
