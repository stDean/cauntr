import { scheduleJob } from "node-schedule";
import { NotFoundError } from "../errors";
import { prisma } from "../helpers/prisma.h";
import { paystackService } from "../services/paystackService";
import { ScheduleController } from "./schedule.j";

export class CancelSubscriptionJobs {
	/**
	 * Handles immediate subscription cancellation tasks
	 * 1. Cancels Stripe subscription
	 * 2. Updates company status
	 * 3. Schedules deactivation job
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

			// Schedule deactivation job
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
	 * Creates scheduled deactivation job using node-schedule
	 * Matches initialization pattern from AuthScheduleController
	 */
	static async scheduleDeactivationJob({
		companyId,
		deactivationDate,
	}: {
		companyId: string;
		deactivationDate: Date;
	}) {
		const cronExpression =
			ScheduleController.generateCronTime(deactivationDate);

		scheduleJob(cronExpression, async () => {
			console.log(`Executing scheduled deactivation for ${companyId}`);
			await ScheduleController.deactivateCompany(companyId);
		});

		console.log(
			`Scheduled deactivation for ${companyId} at ${deactivationDate.toISOString()}`
		);
	}
}
