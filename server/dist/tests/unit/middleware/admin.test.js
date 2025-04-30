import { AdminMiddleware } from "../../../middleware/admin";
import { prisma } from "../../../utils/prisma";
import { UnauthenticatedError } from "../../../errors";
// Mock Prisma client
jest.mock("../../../utils/prisma.h", () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));
const mockRequest = (user) => ({ user });
const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnThis();
    res.json = jest.fn().mockReturnThis();
    return res;
};
const mockNext = jest.fn();
describe("AdminMiddleware", () => {
    let req;
    let res;
    let next;
    beforeEach(() => {
        jest.clearAllMocks();
        res = mockResponse();
        next = mockNext;
    });
    it("should call next() for admin user", async () => {
        // Mock user data
        req = mockRequest({ email: "admin@example.com" });
        prisma.user.findUnique.mockResolvedValue({
            email: "admin@example.com",
            role: "ADMIN",
        });
        await AdminMiddleware(req, res, next);
        // Verify database query
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { email: "admin@example.com" },
        });
        // Verify middleware progression
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    it("should throw error for non-admin user", async () => {
        req = mockRequest({ email: "user@example.com" });
        prisma.user.findUnique.mockResolvedValue({
            email: "user@example.com",
            role: "USER",
        });
        // Use async/await with rejects to handle thrown error
        await expect(AdminMiddleware(req, res, next)).rejects.toThrow(UnauthenticatedError);
        // Verify error message
        await expect(AdminMiddleware(req, res, next)).rejects.toThrow("You are not authorized to perform this action");
    });
    it("should throw error when user doesn't exist", async () => {
        req = mockRequest({ email: "missing@example.com" });
        prisma.user.findUnique.mockResolvedValue(null);
        await expect(AdminMiddleware(req, res, next)).rejects.toThrow("User not found.");
    });
    it("should throw error when no user in request", async () => {
        req = mockRequest({ email: "email@email.com" });
        prisma.user.findUnique.mockResolvedValue(null);
        await expect(AdminMiddleware(req, res, next)).rejects.toThrow(UnauthenticatedError);
    });
    it("should propagate database errors", async () => {
        req = mockRequest({ email: "admin@example.com" });
        prisma.user.findUnique.mockRejectedValue(new Error("Database connection failed"));
        await expect(AdminMiddleware(req, res, next)).rejects.toThrow("Database connection failed");
    });
});
