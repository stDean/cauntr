import Paystack from "@paystack/paystack-sdk";
import { PayStackService } from "../../../services/paystackService";
// Mock my_plans
jest.mock("../../../utils/constants", () => ({
    my_plans: {
        BASIC_MONTHLY: "basic_monthly",
        BASIC_YEARLY: "basic_yearly",
        PREMIUM_MONTHLY: "premium_monthly",
        PREMIUM_YEARLY: "premium_yearly",
    },
}));
// Mock the Paystack SDK
jest.mock("@paystack/paystack-sdk");
const MockedPaystack = Paystack;
// Mock methods
const mockTransactionInitialize = jest.fn();
const mockTransactionVerify = jest.fn();
const mockSubscriptionCreate = jest.fn();
const mockSubscriptionFetch = jest.fn();
const mockRefundCreate = jest.fn();
const mockListTransactions = jest.fn();
const mockSubscriptionList = jest.fn();
const mockSubscriptionDisable = jest.fn();
const mockCustomerList = jest.fn();
// Mock Paystack class implementation
MockedPaystack.mockImplementation(() => ({
    transaction: {
        initialize: mockTransactionInitialize,
        verify: mockTransactionVerify,
        list: mockListTransactions,
    },
    subscription: {
        create: mockSubscriptionCreate,
        fetch: mockSubscriptionFetch,
        list: mockSubscriptionList,
        disable: mockSubscriptionDisable,
    },
    refund: {
        create: mockRefundCreate,
    },
    customer: {
        list: mockCustomerList,
    },
}));
// Setup environment variables
beforeAll(() => {
    process.env.PAY_STACK_SECRET_KEY = "test_secret";
    process.env.PAY_STACK_REDIRECT_URL = "http://example.com/callback";
});
// Clear mocks and initialize service before each test
let service;
beforeEach(() => {
    jest.clearAllMocks();
    service = new PayStackService();
});
describe("PayStackService", () => {
    describe("constructor", () => {
        it("should initialize Paystack client with the secret key", () => {
            // Create a new instance of the service.
            new PayStackService();
            // Verify that the Paystack SDK was initialized with the secret key.
            expect(MockedPaystack).toHaveBeenCalledWith("test_secret");
        });
    });
    describe("initializeTransaction", () => {
        it("should initialize and verify a transaction successfully", async () => {
            // Mock successful initialization
            mockTransactionInitialize.mockResolvedValueOnce({
                status: true,
                message: "Authorization URL created",
                data: {
                    reference: "test_ref",
                    authorization_url: "http://example.com/auth",
                    access_code: "test_code",
                },
            });
            // Mock successful verification
            mockTransactionVerify.mockResolvedValueOnce({
                status: true,
                message: "Transaction verified",
                data: {
                    status: "success",
                    message: null,
                    customer: {
                        id: 1,
                        customer_code: "cust_1",
                        email: "test@example.com",
                    },
                },
            });
            const result = await service.initializeTransaction({
                email: "test@example.com",
                amount: "5000", // Amount in kobo (5000 = ₦50)
            });
            // Validate result
            expect(result.error).toBeNull();
            expect(result.transaction).toMatchObject({
                reference: "test_ref",
                authorization_url: "http://example.com/auth",
                access_code: "test_code",
            });
            expect(result.verify).toMatchObject({
                status: "success",
                customer: expect.any(Object),
            });
            // Validate Paystack SDK calls
            expect(mockTransactionInitialize).toHaveBeenCalledWith({
                email: "test@example.com",
                amount: "5000",
                channels: ["card"],
                callback_url: "http://example.com/callback",
            });
            expect(mockTransactionVerify).toHaveBeenCalledWith({
                reference: "test_ref",
            });
        });
        it("should handle initialization failure", async () => {
            mockTransactionInitialize.mockResolvedValueOnce({
                status: false,
                message: "Invalid amount",
                data: null,
            });
            const result = await service.initializeTransaction({
                email: "test@example.com",
                amount: "invalid_amount",
            });
            expect(result.error).toBe("Invalid amount");
            expect(result.transaction).toBeNull();
        });
        it("should handle verification failure after successful initialization", async () => {
            mockTransactionInitialize.mockResolvedValueOnce({
                status: true,
                message: "Authorization URL created",
                data: { reference: "test_ref" },
            });
            mockTransactionVerify.mockResolvedValueOnce({
                status: false,
                message: "Verification failed",
                data: null,
            });
            const result = await service.initializeTransaction({
                email: "test@example.com",
                amount: "5000",
            });
            expect(result.error).toBe("Verification failed");
        });
        it("should handle exceptions during initialization", async () => {
            mockTransactionInitialize.mockRejectedValueOnce(new Error("API timeout"));
            const result = await service.initializeTransaction({
                email: "test@example.com",
                amount: "5000",
            });
            expect(result.error).toBe("API timeout");
            expect(result.transaction).toBeNull();
            expect(result.verify).toBeNull();
        });
    });
    describe("createSubscription", () => {
        it("should create and fetch a subscription successfully", async () => {
            // Mock subscription creation
            mockSubscriptionCreate.mockResolvedValueOnce({
                status: true,
                message: "Subscription created",
                data: {
                    subscription_code: "sub_123",
                    authorization: { authorization_code: "auth_123" },
                },
            });
            // Mock subscription fetch
            mockSubscriptionFetch.mockResolvedValueOnce({
                status: true,
                message: "Subscription retrieved",
                data: {
                    next_payment_date: "2024-01-01T00:00:00Z",
                },
            });
            const result = await service.createSubscription({
                plan: "plan_123",
                authorization: "auth_123",
                customer: "cust_123",
                start_date: new Date("2023-01-01"),
            });
            expect(result.error).toBeNull();
            expect(result.subscription).toEqual(expect.objectContaining({
                endDate: new Date("2024-01-01T00:00:00Z"),
            }));
            // Validate Paystack SDK calls
            expect(mockSubscriptionCreate).toHaveBeenCalledWith({
                customer: "cust_123",
                plan: "plan_123",
                authorization: "auth_123",
                start_date: new Date("2023-01-01"),
            });
            expect(mockSubscriptionFetch).toHaveBeenCalledWith({
                code: "sub_123",
            });
        });
        it("should handle subscription creation failure", async () => {
            mockSubscriptionCreate.mockResolvedValueOnce({
                status: false,
                message: "Invalid plan",
                data: null,
            });
            const result = await service.createSubscription({
                plan: "invalid_plan",
                authorization: "auth_123",
                customer: "cust_123",
                start_date: new Date(),
            });
            expect(result.error).toBe("Invalid plan");
        });
        it("should handle subscription fetch failure after creation", async () => {
            mockSubscriptionCreate.mockResolvedValueOnce({
                status: true,
                data: { subscription_code: "sub_123" },
            });
            mockSubscriptionFetch.mockResolvedValueOnce({
                status: false,
                message: "Subscription not found",
            });
            const result = await service.createSubscription({
                plan: "plan_123",
                authorization: "auth_123",
                customer: "cust_123",
                start_date: new Date(),
            });
            expect(result.error).toBe("Subscription not found");
            expect(result.subscription).toBe(null);
        });
        it("should handle exceptions during subscription creation", async () => {
            mockSubscriptionCreate.mockRejectedValueOnce(new Error("Network error"));
            const result = await service.createSubscription({
                plan: "plan_123",
                authorization: "auth_123",
                customer: "cust_123",
                start_date: new Date(),
            });
            expect(result.error).toBe("Network error");
            expect(result.subscription).toBeNull();
        });
    });
    describe("refundTransaction", () => {
        it("should refund a transaction successfully", async () => {
            mockRefundCreate.mockResolvedValueOnce({
                status: true,
                message: "Refund processed",
            });
            const result = await service.refundTransaction({
                transId: 12345,
                amount: "5000",
            });
            expect(result.error).toBeNull();
            expect(result.msg).toBe("Refund processed");
            expect(mockRefundCreate).toHaveBeenCalledWith({
                transaction: 12345,
                amount: "5000",
            });
        });
        it("should handle refund failure", async () => {
            mockRefundCreate.mockResolvedValueOnce({
                status: false,
                message: "Insufficient balance",
            });
            const result = await service.refundTransaction({
                transId: 12345,
                amount: "5000",
            });
            expect(result.error).toBe("Insufficient balance");
        });
        it("should handle exceptions during refund", async () => {
            mockRefundCreate.mockRejectedValueOnce(new Error("API failure"));
            const result = await service.refundTransaction({
                transId: 12345,
                amount: "5000",
            });
            expect(result.error).toBe("API failure");
            expect(result.msg).toBeNull();
        });
    });
    describe("cancelSubscription", () => {
        it("should cancel an active subscription successfully", async () => {
            // Mock customer lookup
            mockCustomerList.mockResolvedValueOnce({
                status: true,
                data: [{ id: "cust_123", email: "test@example.com" }],
            });
            // Mock active subscriptions
            mockSubscriptionList.mockResolvedValueOnce({
                status: true,
                data: [
                    {
                        id: 1,
                        status: "active",
                        email_token: "token_123",
                        subscription_code: "sub_123",
                        plan: { plan_code: "basic_monthly" },
                        next_payment_date: new Date(),
                    },
                ],
            });
            // Mock successful disable
            mockSubscriptionDisable.mockResolvedValueOnce({
                status: true,
                message: "Subscription disabled",
            });
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result).toEqual({ success: true, error: null });
            expect(mockSubscriptionDisable).toHaveBeenCalledWith({
                code: "sub_123",
                token: "token_123",
            });
        });
        it("should handle no active subscriptions found", async () => {
            mockCustomerList.mockResolvedValueOnce({
                status: true,
                data: [{ id: "cust_123", email: "test@example.com" }],
            });
            mockSubscriptionList.mockResolvedValueOnce({
                status: true,
                data: [
                    {
                        status: "expired", // Inactive status
                        plan: { plan_code: "basic_monthly" },
                    },
                ],
            });
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result.error).toBe("No active subscriptions found");
        });
        it("should handle subscription disable failure", async () => {
            mockCustomerList.mockResolvedValueOnce({
                status: true,
                data: [{ id: "cust_123", email: "test@example.com" }],
            });
            mockSubscriptionList.mockResolvedValueOnce({
                status: true,
                data: [
                    {
                        id: 1,
                        status: "active",
                        email_token: "token_123",
                        subscription_code: "sub_123",
                        plan: { plan_code: "basic_monthly" },
                        next_payment_date: new Date(),
                    },
                ],
            });
            mockSubscriptionDisable.mockResolvedValueOnce({
                status: false,
                message: "Failed to disable subscription",
            });
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result).toEqual({
                error: "Failed to disable subscription",
                success: false,
            });
        });
        it("should handle customer not found", async () => {
            // No matching customer in list
            mockCustomerList.mockResolvedValueOnce({
                status: true,
                data: [{ id: "cust_456", email: "other@example.com" }],
            });
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result.error).toContain("Cannot read properties of undefined");
        });
        it("should handle database errors gracefully", async () => {
            mockCustomerList.mockRejectedValueOnce(new Error("Database connection failed"));
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result.error).toBe("Database connection failed");
        });
        it("should handle invalid customer list response", async () => {
            mockCustomerList.mockResolvedValueOnce({
                status: false,
                message: "Invalid API key",
            });
            const result = await service.cancelSubscription({
                email: "test@example.com",
            });
            expect(result.error).toContain("Cannot read properties of undefined");
        });
    });
});
