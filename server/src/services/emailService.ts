import nodemailer from "nodemailer";
import { Transporter } from "nodemailer";

export interface EmailConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: {
		user: string;
		pass: string;
	};
}

export interface EmailOptions {
	to: string;
	subject: string;
	html?: string;
}

export class EmailService {
	private transporter: Transporter;

	constructor(config: EmailConfig) {
		this.transporter = nodemailer.createTransport(config);
	}

	async sendEmail(options: EmailOptions): Promise<void> {
		try {
			await this.transporter.sendMail({
				from: `"Cauntr" <${process.env.EMAIL_FROM}>`,
				...options,
			});
		} catch (error) {
			console.error("Email send failed:", error);
			throw new Error("Failed to send email");
		}
	}

	async sendVerificationOTP({
		email,
		token,
	}: {
		email: string;
		token: string;
	}): Promise<void> {
		if (!token || token.length !== 6) {
			throw new Error("Invalid token: OTP must be exactly 6 characters long.");
		}

		const html = `
      <div style="width: 700px; margin: auto; font-family: Arial, sans-serif;">
        <p style="font-size: 1.5rem; color: #333;">Hi there,</p>
        <p style="font-size: 16px; color: #555;">This is your verification code:</p>
        <div style="font-size: 24px; font-weight: bold; color: #050201; margin: 20px 0;">
          ${token
						.split("")
						.map(
							(char, index) =>
								`<span style="border: 2px solid #ff5722; padding: 6px 12px; margin: 0 2px; display: inline-block; border-radius: 5px;">${char}</span>`
						)
						.join("")}
        </div>
        <p style="font-size: 16px; color: #555;">This code will be valid for the next 5 minutes.</p>
        <p>Thanks,<br />Cauntr Team</p>
      </div>
    `;

		await this.sendEmail({
			to: email,
			subject: "Cauntr Verification Code",
			html,
		});
	}
}

// Configure with environment variables
export const emailService = new EmailService({
	host: process.env.SMTP_HOST!,
	port: parseInt(process.env.SMTP_PORT!),
	secure: process.env.SMTP_SECURE === "true",
	auth: {
		user: process.env.SMTP_USER!,
		pass: process.env.SMTP_PASS!,
	},
});
