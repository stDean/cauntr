import { scheduleJob } from "node-schedule";
import { Tier } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../errors";
import { my_plans } from "../helpers/constants";
import { paystackService } from "../services/paystackService";
import { prisma } from "../helpers/prisma.h";
import { ScheduleJob } from "./schedule.j";

export class SubscriptionJobs {
	/**
	 * Cancels a subscription immediately:
	 * 1. Cancels subscription at the payment provider.
	 * 2. Updates the company's status in the database.
	 * 3. Schedules a deactivation job.
	 */
	static async cancelSubscriptionJob({
		email,
		companyId,
		cancelDate,
	}: {
		email: string;
		companyId: string;
		cancelDate: Date;
	}) {
		try {
			const { error } = await paystackService.cancelSubscription({ email });
			if (error) {
				throw new NotFoundError(error);
			}

			// Calculate deactivation date (10 minutes after cancelDate)
			const deactivationDate = new Date(cancelDate.getTime() + 10 * 60 * 1000);

			// Update company status
			await prisma.company.update({
				where: { id: companyId },
				data: {
					canCancel: false,
					canUpdate: false,
					scheduledDeactivation: deactivationDate,
					Subscription: {
						update: {
							endDate: deactivationDate,
						},
					},
				},
			});

			// Schedule the deactivation job
			await this.scheduleDeactivationJob({ companyId, deactivationDate });

			return { deactivationDate };
		} catch (error: any) {
			console.error(
				`CancelSubscriptionJob failed for company ${companyId}:`,
				error
			);
			throw error;
		}
	}

	/**
	 * Schedules a deactivation job using node-schedule.
	 */
	static async scheduleDeactivationJob({
		companyId,
		deactivationDate,
	}: {
		companyId: string;
		deactivationDate: Date;
	}) {
		const cronExpression = ScheduleJob.generateCronTime(deactivationDate);

		scheduleJob(cronExpression, async () => {
			console.log(`Executing scheduled deactivation for ${companyId}`);
			await ScheduleJob.deactivateCompany(companyId);
		});

		console.log(
			`Scheduled deactivation for ${companyId} at ${deactivationDate.toISOString()}`
		);
	}

	/**
	 * Handles subscription plan changes:
	 * 1. Cancels the current subscription at the payment provider.
	 * 2. If the update is immediate, process it right away.
	 * 3. Otherwise, creates a new subscription and schedules an update.
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

		// If the next billing date is the same day as today, process an immediate update.
		if (this.isSameDay({ date1: nextBillingDate, date2: new Date() })) {
			const { transaction } = await this.processImmediateUpdate({
				email,
				paymentPlan,
				billingType,
			});
			return { success: true, transaction };
		}

		// Create a new subscription starting at the next billing date.
		await paystackService.createSubscription({
			plan: my_plans[
				`${paymentPlan.toLowerCase()}_${billingType.toLowerCase()}`
			],
			customer: customerId,
			start_date: nextBillingDate,
		});

		// Schedule a future update.
		await this.scheduleSubscriptionUpdate({
			executeAt: nextBillingDate,
			companyId,
			paymentPlan,
			billingType,
		});

		return { success: true, msg: "Subscription update scheduled successfully" };
	}

	/**
	 * Processes an immediate subscription update.
	 */
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

		// Update the company's subscription details immediately.
		await prisma.company.update({
			where: { company_email: email },
			data: {
				subscriptionStatus: "ACTIVE",
				canCancel: true,
				canUpdate: true,
				pendingPlanUpdate: null,
				scheduledDeactivation: null,
				nextBillingDate: null,
				Subscription: {
					update: {
						tier: paymentPlan.toUpperCase() as Tier,
						tierType: billingType === "year" ? "YEARLY" : "MONTHLY",
						startDate: new Date(),
					},
				},
			},
		});

		return { transaction };
	}

	/**
	 * Schedules a future subscription update.
	 */
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
		// Save pending update details in the database.
		await prisma.company.update({
			where: { id: companyId },
			data: {
				pendingPlanUpdate: `${paymentPlan}_${billingType}`,
				nextBillingDate: executeAt,
			},
		});

		// Schedule the subscription update.
		const cronExpression = ScheduleJob.generateCronTime(executeAt);

		scheduleJob(cronExpression, async () => {
			console.log(`Executing scheduled update for ${companyId}`);
			await ScheduleJob.applyPendingSubscription(companyId);
		});

		console.log(
			`Scheduled update for ${companyId} at ${executeAt.toISOString()}`
		);
	}

	/**
	 * Utility to check if two dates fall on the same day.
	 */
	static isSameDay({ date1, date2 }: { date1: Date; date2: Date }): boolean {
		const utcDate1 = new Date(
			Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate())
		);
		const utcDate2 = new Date(
			Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate())
		);
		return utcDate1.getTime() === utcDate2.getTime();
	}
}
