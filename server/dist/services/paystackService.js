import Paystack from "@paystack/paystack-sdk";
import { my_plans } from "../utils/constants.js";
export class PayStackService {
    constructor() {
        this.paystack = new Paystack(process.env.PAY_STACK_SECRET_KEY);
    }
    async initializeTransaction({ email, amount, plan, }) {
        try {
            // Step 1: Initialize transaction
            const initializeTransactionRes = (await this.paystack.transaction.initialize({
                email,
                amount,
                plan,
                channels: ["card"],
                callback_url: process.env.PAY_STACK_REDIRECT_URL,
            }));
            if (!initializeTransactionRes.status ||
                !initializeTransactionRes.data?.reference) {
                return {
                    error: initializeTransactionRes.message,
                    transaction: null,
                    verify: null,
                };
            }
            // Step 2: Verify transaction
            const verifyTransRes = (await this.paystack.transaction.verify({
                reference: initializeTransactionRes.data.reference,
            }));
            if (!verifyTransRes.status) {
                return {
                    error: verifyTransRes.message,
                    transaction: null,
                    verify: null,
                };
            }
            return {
                transaction: initializeTransactionRes.data,
                verify: verifyTransRes.data,
                error: null,
            };
        }
        catch (error) {
            return {
                error: error.message || "Unknown error occurred",
                transaction: null,
                verify: null,
            };
        }
    }
    async createSubscription({ plan, authorization, customer, start_date, }) {
        try {
            const createSubRes = (await this.paystack.subscription.create({
                customer,
                plan,
                authorization: authorization || "",
                start_date: start_date,
            }));
            if (createSubRes.status === false) {
                return { error: createSubRes.message, subscription: null };
            }
            const { getSub } = await this.getSubscription({
                code: createSubRes?.data.subscription_code,
            });
            if (getSub.status === false) {
                return { error: getSub.message, subscription: null };
            }
            return {
                subscription: {
                    ...createSubRes,
                    endDate: getSub?.data.next_payment_date
                        ? new Date(getSub.data.next_payment_date)
                        : "",
                },
                error: null,
            };
        }
        catch (error) {
            return {
                error: error.message || "Unknown error occurred",
                subscription: null,
            };
        }
    }
    async refundTransaction({ transId, amount, }) {
        try {
            const refundRes = (await this.paystack.refund.create({
                transaction: transId,
                amount,
            }));
            if (refundRes.status === false) {
                return { error: refundRes.message };
            }
            return { msg: refundRes.message, error: null };
        }
        catch (error) {
            return {
                error: error.message || "Unknown error occurred",
                msg: null,
            };
        }
    }
    async cancelSubscription({ email }) {
        try {
            const { subscriptions } = await this.getSubscriptions({ email });
            if (!subscriptions || subscriptions.length === 0) {
                return { error: "No active subscriptions found", success: false };
            }
            const disabledRes = await this.paystack.subscription.disable({
                code: subscriptions[0].subscription_code,
                token: subscriptions[0].email_token,
            });
            if (disabledRes.status === false) {
                return { error: disabledRes.message, success: false };
            }
            return { success: true, error: null };
        }
        catch (error) {
            return {
                error: error.message || "Unknown error occurred",
                msg: null,
            };
        }
    }
    async getSubscription({ code }) {
        const getSub = (await this.paystack.subscription.fetch({
            code: code,
        }));
        return { getSub };
    }
    async getSubscriptions({ email }) {
        const { theCustomer } = await this.getCustomer({ email });
        const subs = (await this.paystack.subscription.list({
            customer: theCustomer.id,
        }));
        if (subs.status === false) {
            return { error: "Something went wrong" };
        }
        const my_plans_array = Array.from(Object.values(my_plans));
        const subscriptions = subs.data.filter((subscription) => subscription.status === "active" &&
            my_plans_array.indexOf(subscription.plan.plan_code) !== -1);
        return { subscriptions };
    }
    async getCustomer({ email }) {
        const customerRes = (await this.paystack.customer.list({}));
        if (customerRes.status === false) {
            return { error: "No customer with that email" };
        }
        const theCustomer = customerRes.data.find((customer) => customer.email === email);
        return { theCustomer };
    }
}
export const paystackService = new PayStackService();
