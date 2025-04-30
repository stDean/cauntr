import { StatusCodes } from "http-status-codes";
import * as SubscriptionModule from "../../../controllers/subscription";
import { BadRequestError, NotFoundError } from "../../../errors";
import { my_plans } from "../../../utils/constants";
import { SubscriptionJobs } from "../../../jobs/subscriptionJob";
import { paystackService } from "../../../services/paystackService";
// Mock my_plans
jest.mock("../../../utils/constants", () => ({
    my_plans: {
        BASIC_MONTHLY: "basic_monthly",
        BASIC_YEARLY: "basic_yearly",
        PREMIUM_MONTHLY: "premium_monthly",
        PREMIUM_YEARLY: "premium_yearly",
    },
}));
// Mock dependencies
jest.mock("../../../utils/prisma.h", () => ({
    prisma: {
        company: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        otp: {
            findFirst: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            create: jest.fn(),
        },
        users: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));
jest.mock("../../../services/paystackService");
jest.mock("../../../jobs/subscriptionJob.j");
// Mock helper functions and services
const mockCheckCompany = jest.spyOn(SubscriptionModule, "checkCompany");
const mockCheckBilling = jest.spyOn(SubscriptionModule, "checkBilling");
const mockUpdateJob = SubscriptionJobs.updateSubscriptionJob;
const mockCancelJob = SubscriptionJobs.cancelSubscriptionJob;
// Mock request/response objects
const mockRequest = (body = {}, user = {}) => ({ body, user });
const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnThis();
    res.json = jest.fn().mockReturnThis();
    return res;
};
describe("Subscription Controller", () => {
    let req;
    let res;
    beforeEach(() => {
        jest.clearAllMocks();
        req = mockRequest();
        res = mockResponse();
    });
    // This is a reusable valid request body for tests
    const validBody = { billingType: "monthly", paymentPlan: "basic" };
    // This is a valid company object that will be returned from the prisma mock
    const validCompany = {
        company_email: "test@company.com",
        id: "company-123",
        Subscription: {
            // For testing, we use a fixed date
            endDate: new Date(),
            payStackCustomerID: "customer-123",
        },
    };
    describe("updateSubscription", () => {
        it("should update subscription successfully", async () => {
            // Setup mocks
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            mockCheckBilling.mockResolvedValue(validBody);
            mockUpdateJob.mockResolvedValue({
                transaction: { authorization_url: "https://payment.url" },
            });
            // Execute
            await SubscriptionModule.SubscriptionCtrl.updateSubscription(req, res);
            // Verify response
            // Verify that the job was called with the expected parameters
            expect(SubscriptionJobs.updateSubscriptionJob).toHaveBeenCalledWith({
                billingType: validBody.billingType,
                paymentPlan: validBody.paymentPlan,
                email: validCompany.company_email,
                nextBillingDate: new Date(validCompany.Subscription.endDate),
                companyId: validCompany.id,
                customerId: validCompany.Subscription.payStackCustomerID,
            });
            expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                paymentUrl: expect.any(String),
            }));
        });
        it("should handle missing company", async () => {
            // Force company check failure
            mockCheckCompany.mockRejectedValue(new NotFoundError("Company not found"));
            // Execute and verify error
            await expect(SubscriptionModule.SubscriptionCtrl.updateSubscription(req, res)).rejects.toThrow("Company not found");
        });
        it("should validate billing parameters", async () => {
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            // Force billing check failure
            mockCheckBilling.mockRejectedValue(new BadRequestError("Billing type and payment plan are required"));
            // Execute and verify error
            await expect(SubscriptionModule.SubscriptionCtrl.updateSubscription(req, res)).rejects.toThrow("Billing type and payment plan are required");
        });
    });
    describe("cancelSubscription", () => {
        it("should cancel subscription successfully", async () => {
            // Setup mocks
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            mockCancelJob.mockResolvedValue({ deactivationDate: new Date() });
            // Execute
            await SubscriptionModule.SubscriptionCtrl.cancelSubscription(req, res);
            // Verify response
            // Verify that the cancellation job was called with the correct parameters
            expect(SubscriptionJobs.cancelSubscriptionJob).toHaveBeenCalledWith({
                email: validCompany.company_email,
                companyId: validCompany.id,
                cancelDate: new Date(validCompany.Subscription.endDate),
            });
            expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                deactivationDate: expect.any(Date),
            }));
        });
        it("should handle cancellation job failure", async () => {
            // Setup mocks
            mockCancelJob.mockRejectedValue(new Error("Job failed"));
            // Execute and verify error
            await expect(SubscriptionModule.SubscriptionCtrl.cancelSubscription(req, res)).rejects.toThrow("Job failed");
        });
    });
    describe("reactivateSubscription", () => {
        it("should reactivate subscription successfully", async () => {
            // Setup mocks
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            mockCheckBilling.mockResolvedValue(validBody);
            paystackService.initializeTransaction.mockResolvedValue({
                transaction: { authorization_url: "https://payment.url" },
            });
            // Execute
            await SubscriptionModule.SubscriptionCtrl.reactivateSubscription(req, res);
            // Verify response
            expect(paystackService.initializeTransaction).toHaveBeenCalledWith({
                email: validCompany.company_email,
                amount: "5000",
                plan: my_plans[`${validBody.paymentPlan}_${validBody.billingType}`],
            });
            expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                paymentUrl: expect.any(String),
            }));
        });
        it("should handle Paystack initialization failure", async () => {
            // Setup mocks
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            mockCheckBilling.mockResolvedValue(validBody);
            paystackService.initializeTransaction.mockResolvedValue({
                error: "Payment failed",
            });
            // Execute and verify error
            await expect(SubscriptionModule.SubscriptionCtrl.reactivateSubscription(req, res)).rejects.toThrow("Payment gateway initialization failed");
        });
        it("should validate plan parameters", async () => {
            mockCheckCompany.mockResolvedValue({ company: validCompany });
            // Force invalid billing type
            mockCheckBilling.mockResolvedValue({
                paymentPlan: "invalid",
                billingType: "invalid",
            });
            // Execute and verify error
            await expect(SubscriptionModule.SubscriptionCtrl.reactivateSubscription(req, res)).rejects.toThrow();
        });
    });
});
