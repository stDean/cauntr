import nodemailer from "nodemailer";
import {
	EmailConfig,
	EmailOptions,
	EmailService,
} from "../../../services/emailService";

// Mock nodemailer
jest.mock("nodemailer");
const mockCreateTransport = nodemailer.createTransport as jest.Mock;
const mockSendMail = jest.fn();

describe("EmailService", () => {
	const originalEnv = process.env;
	const testConfig: EmailConfig = {
		host: "smtp.example.com",
		port: 587,
		secure: false,
		auth: { user: "test@example.com", pass: "testpass" },
	};

	beforeEach(() => {
		jest.resetAllMocks();
		mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
		process.env.EMAIL_FROM = "noreply@example.com";
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	describe("Constructor", () => {
		it("should create transporter with provided config", () => {
			new EmailService(testConfig);
			expect(nodemailer.createTransport).toHaveBeenCalledWith(testConfig);
		});
	});

	describe("sendEmail", () => {
		it("should send email with correct parameters", async () => {
			const emailService = new EmailService(testConfig);
			const options: EmailOptions = {
				to: "recipient@example.com",
				subject: "Test Subject",
				html: "<p>Test Content</p>",
			};

			mockSendMail.mockResolvedValueOnce(true);
			await emailService.sendEmail(options);

			expect(mockSendMail).toHaveBeenCalledWith({
				from: `"Cauntr" <${process.env.EMAIL_FROM}>`,
				...options,
			});
		});

		it("should throw error when email sending fails", async () => {
			const emailService = new EmailService(testConfig);
			const consoleSpy = jest.spyOn(console, "error").mockImplementation();
			const testError = new Error("SMTP connection failed");

			mockSendMail.mockRejectedValueOnce(testError);
			await expect(
				emailService.sendEmail({
					to: "recipient@example.com",
					subject: "Test",
				})
			).rejects.toThrow("Failed to send email");

			expect(consoleSpy).toHaveBeenCalledWith("Email send failed:", testError);
		});
	});

	describe("sendVerificationOTP", () => {
		const validToken = "123456";
		const invalidToken = "12345";
		const testEmail = "user@example.com";
		let emailService: EmailService;

		beforeEach(() => {
			emailService = new EmailService(testConfig);
		});

		it("should throw error for invalid token length", async () => {
			await expect(
				emailService.sendVerificationOTP({
					email: testEmail,
					token: invalidToken,
				})
			).rejects.toThrow("OTP must be exactly 6 characters long");
			expect(mockSendMail).not.toHaveBeenCalled();
		});

		it("should generate valid HTML with token spans", async () => {
			const emailService = new EmailService(testConfig);
			mockSendMail.mockResolvedValueOnce(true);

			await emailService.sendVerificationOTP({
				email: testEmail,
				token: validToken,
			});

			const sentHtml = mockSendMail.mock.calls[0][0].html;
			validToken.split("").forEach(char => {
				expect(sentHtml).toContain(
					`<span style="border: 2px solid #ff5722; padding: 6px 12px; margin: 0 2px; display: inline-block; border-radius: 5px;">${char}</span>`
				);
			});
		});

		it("should send an OTP email successfully", async () => {
			mockSendMail.mockResolvedValueOnce({ messageId: "12345" });

			await emailService.sendVerificationOTP({
				email: testEmail,
				token: validToken,
			});

			expect(mockSendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					to: testEmail,
					subject: "Cauntr Verification Code",
				})
			);
		});

		it("should throw an error if email sending fails", async () => {
			mockSendMail.mockRejectedValueOnce(new Error("SMTP error"));

			await expect(
				emailService.sendVerificationOTP({
					email: testEmail,
					token: validToken,
				})
			).rejects.toThrow("Failed to send email");

			expect(mockSendMail).toHaveBeenCalled();
		});
	});
});
