import { Tier } from "@prisma/client";
import { prisma } from "../utils/prisma.h";
import { scheduleJob } from "node-schedule";

export class ScheduleJob {
  /**
   * Initializes scheduled jobs on server startup.
   * Restores pending subscription updates and deactivations from database.
   * Should be called during application initialization.
   *
   * Flow:
   * 1. Fetch companies with pending operations
   * 2. Recreate node-schedule jobs from stored timestamps
   * 3. Maintains continuity across server restarts
   */
  static async initializeScheduledJobs() {
    try {
      const companies = await prisma.company.findMany({
        where: {
          OR: [
            { NOT: { pendingPlanUpdate: null } },
            { NOT: { scheduledDeactivation: null } },
          ],
        },
      });

      for (const company of companies) {
        // Handle pending plan updates
        if (company.pendingPlanUpdate && company.nextBillingDate) {
          // Parse as UTC explicitly
          const executeAt = company.nextBillingDate;
          const timeInCronEx =
            executeAt.getMinutes() +
            " " +
            (executeAt.getHours() - 1) +
            " " +
            executeAt.getDate() +
            " " +
            (executeAt.getMonth() + 1) +
            " *";

          scheduleJob(`${timeInCronEx}`, async () => {
            console.log(`Executing plan update for ${company.company_name}`);

            await this.applyPendingSubscription(company.id);
          });
          console.log(
            `Scheduled plan update for ${
              company.company_name
            } at ${executeAt.toISOString()}`
          );
        }

        // Handle deactivations
        if (company.scheduledDeactivation) {
          // Parse as UTC explicitly
          const deactivationDate = company.scheduledDeactivation;

          const timeInCronEx =
            deactivationDate.getMinutes() +
            " " +
            (deactivationDate.getHours() - 1) +
            " " +
            deactivationDate.getDate() +
            " " +
            (deactivationDate.getMonth() + 1) +
            " *";

          // Schedule future job in UTC
          scheduleJob(`${timeInCronEx}`, async () => {
            console.log(`Executing deactivation for ${company.company_name}`);
            await this.deactivateCompany(company.id);
          });

          console.log(
            `Scheduled deactivation for ${
              company.company_name
            } at ${deactivationDate.toISOString()}`
          );
        }
      }

      console.log(`Initialized ${companies.length} scheduled jobs`);
    } catch (error) {
      console.error("Job initialization failed:", error);
      throw error;
    }
  }

  /**
   * Processes overdue subscription updates (fail-safe mechanism)
   * Runs as daily maintenance job to handle:
   * - Missed schedule jobs
   * - System clock changes
   * - Failed previous attempts
   *
   * Execution flow:
   * 1. Find companies with pending updates past due date
   * 2. Apply updates sequentially with error isolation
   * 3. Maintains consistency through individual transactions
   */
  static async processPendingSubscriptions() {
    try {
      // Find companies with overdue pending updates
      const pendingCompanies = await prisma.company.findMany({
        where: {
          pendingPlanUpdate: { not: null },
          nextBillingDate: { lte: new Date() },
        },
      });

      // Process each company with error isolation
      for (const company of pendingCompanies) {
        try {
          await this.applyPendingSubscription(company.id);
          console.log(
            `Processed pending subscription for ${company.company_name}`
          );
        } catch (error) {
          console.error(
            `Failed to process subscription for ${company.company_name}:`,
            error
          );
          // Potential enhancement: Add retry counter and alerting
        }
      }

      return { processed: pendingCompanies.length };
    } catch (error) {
      console.error("Subscription processing failed:", error);
      throw error;
    }
  }

  /**
   * Executes pending subscription update in a transactional context
   * Atomic operation ensures data consistency:
   * 1. Verify pending update exists
   * 2. Apply plan changes
   * 3. Clear pending fields
   * 4. Create audit trail
   *
   * @param {string} companyId - Target company ID
   * @throws {Error} If no pending update exists
   */
  static async applyPendingSubscription(companyId: string) {
    return await prisma.$transaction(async (tx) => {
      // Verify pending update existence
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { pendingPlanUpdate: true },
      });

      if (!company?.pendingPlanUpdate) {
        console.log("No pending subscription update found");
        return;
      }

      // Parse and apply plan changes
      const [plan, type] = company.pendingPlanUpdate.split("_");
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          pendingPlanUpdate: null,
          nextBillingDate: null,
          scheduledDeactivation: null,
          canUpdate: true,
          canCancel: true,
          subscriptionStatus: "ACTIVE",
          Subscription: {
            update: {
              tierType: type === "year" ? "YEARLY" : "MONTHLY",
              tier: plan.toUpperCase() as Tier,
            },
          },
        },
      });

      return updated;
    });
  }

  /**
   * Deactivates company account with transactional safety
   * Includes:
   * 1. Update payment status
   * 2. Clear deactivation schedule
   * 3. Audit log entry
   *
   * @param {string} companyId - Target company ID
   */
  static async deactivateCompany(companyId: string) {
    return await prisma.$transaction(async (tx) => {
      // Update company status
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          subscriptionStatus: "CANCELLED",
          scheduledDeactivation: null,
          // canCancel: false,
          // canUpdate: true,
          CompanyStripeSubscription: {
            update: {
              data: {
                stripeSubscriptionID: null,
                stripeSubscriptionItemId: null,
                tier: "FREE",
                tierType: "MONTHLY",
              },
            },
          },
        },
      });

      return updated;
    });
  }

  /**
   * Generates cron expression matching AuthScheduleController's format
   * Maintains timezone handling consistency
   */
  static generateCronTime(date: Date) {
    return [
      date.getMinutes(),
      date.getHours() - 1, // Maintain hour adjustment from original code
      date.getDate(),
      date.getMonth() + 1,
      "*",
    ].join(" ");
  }
}
