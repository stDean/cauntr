import { ScheduleJob } from "../../../jobs/schedule.j";
import { prisma } from "../../../helpers/prisma.h";
import { scheduleJob } from "node-schedule";

jest.mock("../../../helpers/prisma.h", () => ({
	prisma: {
		company: {
			findMany: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
		},
		$transaction: jest.fn(),
	},
}));
jest.mock("node-schedule", () => ({
	scheduleJob: jest.fn(),
}));

describe("ScheduleJob", () => {
	const mockCompany = {
		id: "company_123",
		company_name: "Test Corp",
		pendingPlanUpdate: "team_year",
		nextBillingDate: new Date(),
		scheduledDeactivation: new Date(Date.now() + 86400000), // Tomorrow
	};

	beforeEach(() => {
		console.log = jest.fn();
		console.error = jest.fn();
		jest.clearAllMocks();
		jest.restoreAllMocks();
	});

	describe("initializeScheduledJobs", () => {
		it("should schedule pending updates and deactivations", async () => {
			// Mock database response
			(prisma.company.findMany as jest.Mock).mockResolvedValue([mockCompany]);

			// Mock scheduling function
			(scheduleJob as jest.Mock).mockImplementation(() => ({
				name: "test-job",
			}));

			await ScheduleJob.initializeScheduledJobs();

			// Verify database query
			expect(prisma.company.findMany).toHaveBeenCalledWith({
				where: {
					OR: [
						{ NOT: { pendingPlanUpdate: null } },
						{ NOT: { scheduledDeactivation: null } },
					],
				},
			});

			// Verify scheduling calls
			expect(scheduleJob).toHaveBeenCalledTimes(2);
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Initialized 1 scheduled jobs")
			);
		});

		it("should handle database errors", async () => {
			(prisma.company.findMany as jest.Mock).mockRejectedValue(
				new Error("DB Connection Failed")
			);

			await expect(ScheduleJob.initializeScheduledJobs()).rejects.toThrow(
				"DB Connection Failed"
			);

			expect(console.error).toHaveBeenCalledWith(
				"Job initialization failed:",
				expect.any(Error)
			);
		});
	});

	describe("processPendingSubscriptions", () => {
		it("should process overdue subscriptions", async () => {
			// Mock pending companies
			(prisma.company.findMany as jest.Mock).mockResolvedValue([mockCompany]);

			// Mock transaction
			(prisma.$transaction as jest.Mock).mockImplementation(async cb =>
				cb({
					company: {
						findUnique: jest.fn().mockResolvedValue(mockCompany),
						update: jest.fn().mockResolvedValue({}),
					},
				})
			);

			const result = await ScheduleJob.processPendingSubscriptions();

			expect(result.processed).toBe(1);
			expect(prisma.company.findMany).toHaveBeenCalledWith({
				where: {
					pendingPlanUpdate: { not: null },
					nextBillingDate: { lte: expect.any(Date) },
				},
			});
		});

		it("should handle individual failures gracefully", async () => {
			const errorCompany = {
				...mockCompany,
				id: "error_company",
				company_name: "Error Corp",
			};
			(prisma.company.findMany as jest.Mock).mockResolvedValue([
				mockCompany,
				errorCompany,
			]);

			// Mock one successful and one failed update
			(prisma.$transaction as jest.Mock)
				.mockResolvedValueOnce({}) // First success
				.mockRejectedValueOnce(new Error("Update failed")); // Second failure

			const result = await ScheduleJob.processPendingSubscriptions();

			expect(result.processed).toBe(2);
			expect(console.error).toHaveBeenCalledWith(
				"Failed to process subscription for Error Corp:",
				expect.any(Error)
			);
		});
	});

	describe("applyPendingSubscription", () => {
		it("should apply valid pending updates", async () => {
			// Mock transaction chain
			const mockTx = {
				company: {
					findUnique: jest.fn().mockResolvedValue(mockCompany),
					update: jest.fn().mockResolvedValue({
						...mockCompany,
						pendingPlanUpdate: null,
						nextBillingDate: null,
					}),
				},
			};

			// Ensure that when $transaction is called, it uses your mockTx.
			(prisma.$transaction as jest.Mock).mockImplementation(async callback => {
				return await callback(mockTx);
			});

			await ScheduleJob.applyPendingSubscription("company_123");

			expect(mockTx.company.findUnique).toHaveBeenCalledWith({
				where: { id: "company_123" },
				select: { pendingPlanUpdate: true },
			});

			expect(mockTx.company.update).toHaveBeenCalledWith({
				where: { id: "company_123" },
				data: expect.objectContaining({
					pendingPlanUpdate: null,
					Subscription: {
						update: {
							tierType: "YEARLY",
							tier: "TEAM",
						},
					},
				}),
			});
		});

		it("should handle missing pending updates", async () => {
			const mockTx = {
				company: {
					findUnique: jest
						.fn()
						.mockResolvedValue({ ...mockCompany, pendingPlanUpdate: null }),
				},
			};

			(prisma.$transaction as jest.Mock).mockImplementation(async callback => {
				return await callback(mockTx);
			});

			await ScheduleJob.applyPendingSubscription("company_123");
			expect(console.log).toHaveBeenCalledWith(
				"No pending subscription update found"
			);
		});
	});

	describe("deactivateCompany", () => {
		it("should update company status correctly", async () => {
			const mockTx = {
				company: {
					update: jest.fn().mockResolvedValue({
						...mockCompany,
						subscriptionStatus: "CANCELLED",
					}),
				},
			};

			(prisma.$transaction as jest.Mock).mockImplementation(async callback => {
				return await callback(mockTx);
			});

			await ScheduleJob.deactivateCompany("company_123");

			expect(mockTx.company.update).toHaveBeenCalledWith({
				where: { id: "company_123" },
				data: {
					subscriptionStatus: "CANCELLED",
					scheduledDeactivation: null,
					canCancel: false,
					canUpdate: true,
				},
			});
		});
	});

	describe("generateCronTime", () => {
		it("should format cron expression correctly", () => {
			const testDate = new Date("2023-10-01T15:30:00Z"); // UTC time
			const cron = ScheduleJob.generateCronTime(testDate);

			expect(cron).toBe("30 15 1 10 *");
		});

		it("should handle month/day boundaries", () => {
			const testDate = new Date("2023-12-31T22:50:00Z");
			const cron = ScheduleJob.generateCronTime(testDate);

			expect(cron).toBe("50 22 31 12 *");
		});
	});
});
