import { scheduleJob } from "node-schedule";
import { prisma } from "../../../utils/prisma.h";
import { ScheduleJob } from "../../../jobs/schedule.j";
import { SubscriptionJobs } from "../../../jobs/subscriptionJob.j";
import { paystackService } from "../../../services/paystackService";
import { my_plans } from "../../../utils/constants";

// Mock my_plans
jest.mock("../../../utils/constants", () => ({
	my_plans: {
		BASIC_MONTHLY: "basic_monthly",
		BASIC_YEARLY: "basic_yearly",
		PREMIUM_MONTHLY: "premium_monthly",
		PREMIUM_YEARLY: "premium_yearly",
	},
}));

// Mock external dependencies
jest.mock("../../../utils/prisma.h", () => ({
	prisma: { company: { update: jest.fn() } },
}));
jest.mock("node-schedule", () => ({
	scheduleJob: jest.fn(),
}));
jest.mock("../../../services/paystackService");
jest.mock("../../../jobs/schedule.j");

describe("SubscriptionJobs", () => {
	const mockCompanyId = "company_123";
	const mockEmail = "test@company.com";
	const mockCustomerId = "cust_123";

	// Reset ALL mocks before each test
	beforeEach(() => {
		jest.clearAllMocks();
		jest.restoreAllMocks(); // Critical for cleaning up spies
	});

	describe("cancelSubscriptionJob", () => {
		it("should complete cancellation workflow successfully", async () => {
			// Mock Paystack cancellation
			(paystackService.cancelSubscription as jest.Mock).mockResolvedValue({
				error: null,
			});

			// Mock Prisma update
			(prisma.company.update as jest.Mock).mockResolvedValue({});

			// Mock scheduling
			(ScheduleJob.generateCronTime as jest.Mock).mockReturnValue("* * * * *");

			const cancelDate = new Date();
			const result = await SubscriptionJobs.cancelSubscriptionJob({
				email: mockEmail,
				companyId: mockCompanyId,
				cancelDate,
			});

			// Verify Paystack cancellation
			expect(paystackService.cancelSubscription).toHaveBeenCalledWith({
				email: mockEmail,
			});

			// Verify database update
			expect(prisma.company.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: mockCompanyId },
					data: expect.objectContaining({
						canCancel: false,
						scheduledDeactivation: expect.any(Date),
					}),
				})
			);

			// Verify scheduling
			expect(scheduleJob).toHaveBeenCalled();
			expect(result.deactivationDate).toBeInstanceOf(Date);
		});

		it("should handle Paystack cancellation failure", async () => {
			(paystackService.cancelSubscription as jest.Mock).mockResolvedValue({
				error: "Subscription not found",
			});

			await expect(
				SubscriptionJobs.cancelSubscriptionJob({
					email: mockEmail,
					companyId: mockCompanyId,
					cancelDate: new Date(),
				})
			).rejects.toThrow("Subscription not found");
		});
	});

	describe("updateSubscriptionJob", () => {
		const mockNextBillingDate = new Date();

		it("should process immediate update when dates match", async () => {
			// Mock date comparison
			jest.spyOn(SubscriptionJobs, "isSameDay").mockReturnValue(true);

			(paystackService.cancelSubscription as jest.Mock).mockResolvedValue({
				error: null,
			});

			// Mock the static method processImmediateUpdate
			jest.spyOn(SubscriptionJobs, "processImmediateUpdate").mockResolvedValue({
				transaction: { authorization_url: "https://payment.url" },
			});

			const result = await SubscriptionJobs.updateSubscriptionJob({
				billingType: "month",
				paymentPlan: "premium",
				email: mockEmail,
				nextBillingDate: mockNextBillingDate,
				companyId: mockCompanyId,
				customerId: mockCustomerId,
			});

			// Verify immediate update was called
			expect(SubscriptionJobs.processImmediateUpdate).toHaveBeenCalledWith({
				paymentPlan: "premium",
				billingType: "month",
				email: mockEmail,
			});

			// Verify the result
			expect(paystackService.createSubscription).not.toHaveBeenCalled();
			expect(result).toEqual({
				success: true,
				transaction: { authorization_url: "https://payment.url" },
			});
		});

		it("should schedule future update when dates differ", async () => {
			// Mock date comparison
			jest.spyOn(SubscriptionJobs, "isSameDay").mockReturnValue(false);

			(paystackService.cancelSubscription as jest.Mock).mockResolvedValue({
				error: null,
			});

			// Mock subscription creation
			(paystackService.createSubscription as jest.Mock).mockResolvedValue({
				error: null,
			});

			const result = await SubscriptionJobs.updateSubscriptionJob({
				billingType: "year",
				paymentPlan: "basic",
				email: mockEmail,
				nextBillingDate: new Date("2024-01-01"),
				companyId: mockCompanyId,
				customerId: mockCustomerId,
			});

			// Verify subscription creation
			expect(paystackService.createSubscription).toHaveBeenCalled();

			// Verify scheduling
			expect(scheduleJob).toHaveBeenCalled();
			expect(result).toHaveProperty(
				"msg",
				"Subscription update scheduled successfully"
			);
		});
	});

	describe("isSameDay", () => {
		it("should correctly identify same-day dates", () => {
			const date1 = new Date("2023-10-01T12:00:00Z"); // UTC time
			const date2 = new Date("2023-10-01T18:30:00Z"); // UTC time
			expect(SubscriptionJobs.isSameDay({ date1, date2 })).toBe(true);
		});

		it("should correctly identify different-day dates", () => {
			const date1 = new Date("2023-10-01T23:59:59Z"); // UTC time
			const date2 = new Date("2023-10-02T00:00:00Z"); // UTC time
			expect(SubscriptionJobs.isSameDay({ date1, date2 })).toBe(false);
		});
	});

	describe("processImmediateUpdate", () => {
		it("should complete immediate update successfully", async () => {
			// Mock Paystack transaction
			(paystackService.initializeTransaction as jest.Mock).mockResolvedValue({
				error: null,
				transaction: { authorization_url: "https://payment.url" },
			});

			// Mock database update
			(prisma.company.update as jest.Mock).mockResolvedValue({});

			const resBody = {
				paymentPlan: "team",
				billingType: "monthly",
				email: mockEmail,
			};
			const result = await SubscriptionJobs.processImmediateUpdate(resBody);

			// Verify Paystack initialization
			expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
				expect.objectContaining({
					plan: my_plans[
						`${resBody.paymentPlan.toLowerCase()}_${resBody.billingType.toLowerCase()}`
					],
					amount: "500000",
					email: mockEmail,
				})
			);

			// Verify database update
			expect(prisma.company.update).toHaveBeenCalled();
			expect(result.transaction).toBeDefined();
		});
	});

	describe("scheduleSubscriptionUpdate", () => {
		it("should schedule future updates correctly", async () => {
			const executeDate = new Date("2025-01-01");

			// Mock scheduling
			(ScheduleJob.generateCronTime as jest.Mock).mockReturnValue("0 0 1 1 *");

			await SubscriptionJobs.scheduleSubscriptionUpdate({
				executeAt: executeDate,
				companyId: mockCompanyId,
				paymentPlan: "team",
				billingType: "yearly",
			});

			// Verify database update
			expect(prisma.company.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: {
						pendingPlanUpdate: "team_yearly",
						nextBillingDate: executeDate,
					},
				})
			);

			// Verify scheduling
			expect(scheduleJob).toHaveBeenCalledWith(
				"0 0 1 1 *",
				expect.any(Function)
			);
		});
	});
});
