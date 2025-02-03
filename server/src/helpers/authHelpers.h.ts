import { sendOtpEmail } from "../services/emailService";
import { prisma } from "./prisma.h";
import crypto from "crypto";

export const generateVerificationToken = async (email: string) => {
	const token = crypto.randomInt(100_000, 1_000_000).toString();
	const expires = new Date(new Date().getTime() + 5 * 60 * 1000); // 5mins

	return { token, expires };
};

export const handleOtpForCompany = async (email: string) => {
	const { token, expires } = await generateVerificationToken(email);
	const existingOtp = await prisma.otp.findFirst({ where: { email } });

	if (existingOtp) {
		await prisma.otp.update({
			where: { id: existingOtp.id },
			data: { otp: token, expiresAt: expires },
		});
	} else {
		await prisma.otp.create({
			data: { email, otp: token, expiresAt: expires },
		});
	}

	sendOtpEmail(email, token);
};
