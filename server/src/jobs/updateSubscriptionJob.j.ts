import { TIER } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../errors";
import { my_plans } from "../helpers/constants";
import { paystackService } from "../services/paystackService";
import { prisma } from "../helpers/prisma.h";
import { ScheduleController } from "./schedule.j";
import { scheduleJob } from "node-schedule";

export class UpdateSubscriptionJob {
	/**
	 * Handles subscription plan changes with payment provider sync
	 * and scheduled updates using your existing patterns
	 */
	static async updateSubscriptionJob({
		billingType,
		paymentPlan,
		email,
		nextBillingDate,
		companyId,
		customerId,
	}: {
		billingType: string;
		paymentPlan: string;
		email: string;
		nextBillingDate: Date;
		companyId: string;
		customerId: string;
	}) {
		const { error } = await paystackService.cancelSubscription({ email });
		if (error) {
			throw new NotFoundError(error);
		}

		// Handle immediate updates
		if (this.isSameDay({ date1: nextBillingDate, date2: new Date() })) {
			const { transaction } = await this.processImmediateUpdate({
				email,
				paymentPlan,
				billingType,
			});
			return { success: true, transaction };
		}

		await paystackService.createSubscription({
			plan: my_plans[
				`${paymentPlan.toLowerCase()}_${billingType.toLowerCase()}`
			],
			customer: customerId,
			start_date: nextBillingDate,
		});

		// Schedule future update
		await this.scheduleSubscriptionUpdate({
			executeAt: nextBillingDate,
			companyId,
			paymentPlan,
			billingType,
		});

		return { success: true, msg: "Subscription update scheduled successfully" };
	}

	static async processImmediateUpdate({
		paymentPlan,
		billingType,
		email,
	}: {
		paymentPlan: string;
		billingType: string;
		email: string;
	}) {
		const { error, transaction } = await paystackService.initializeTransaction({
			email: email,
			amount: "500000",
			plan: my_plans[
				`${paymentPlan.toLowerCase()}_${billingType.toLowerCase()}`
			],
		});
		if (error) {
			throw new BadRequestError(error);
		}

		// Update subscription directly
		await prisma.company.update({
			where: { company_email: email },
			data: {
				paymentStatus: "ACTIVE",
				canCancel: true,
				canUpdate: true,
				pendingPlanUpdate: null,
				scheduledDeactivation: null,
				Subscription: {
					update: {
						tier: paymentPlan.toUpperCase() as TIER,
						tierType: billingType === "year" ? "YEARLY" : "MONTHLY",
						startDate: new Date(),
					},
				},
			},
		});

		return { transaction };
	}

	static async scheduleSubscriptionUpdate({
		executeAt,
		companyId,
		paymentPlan,
		billingType,
	}: {
		executeAt: Date;
		companyId: string;
		paymentPlan: string;
		billingType: string;
	}) {
		// Store pending update
		await prisma.company.update({
			where: { id: companyId },
			data: {
				pendingPlanUpdate: `${paymentPlan}_${billingType}`,
				nextBillingDate: executeAt,
			},
		});

		// Schedule using existing pattern
		const cronExpression = ScheduleController.generateCronTime(executeAt);

		scheduleJob(cronExpression, async () => {
			console.log(`Executing scheduled update for ${companyId}`);
			await ScheduleController.applyPendingSubscription(companyId);
		});

		console.log(
			`Scheduled update for ${companyId} at ${executeAt.toISOString()}`
		);
	}

	public static isSameDay({ date1, date2 }: { date1: Date; date2: Date }) {
		return (
			date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate()
		);
	}
}
