import crypto from "crypto";
import { emailService } from "../services/emailService.js";
import { prisma } from "./prisma.js";
import jwt from "jsonwebtoken";
export const generateVerificationToken = async (email) => {
    const token = crypto.randomInt(100000, 1000000).toString();
    const expires = new Date(new Date().getTime() + 5 * 60 * 1000); // 5mins
    return { token, expires };
};
export const handleOtpForCompany = async (email) => {
    const { token, expires } = await generateVerificationToken(email);
    const existingOtp = await prisma.otp.findFirst({ where: { email } });
    if (existingOtp) {
        await prisma.otp.update({
            where: { id: existingOtp.id },
            data: { otp: token, expiresAt: expires },
        });
    }
    else {
        await prisma.otp.create({
            data: { email, otp: token, expiresAt: expires },
        });
    }
    await emailService.sendVerificationOTP({ email, token });
};
export const createJWT = ({ email, companyId, }) => {
    return jwt.sign({ email, companyId }, process.env.JWT_SECRET, {
        expiresIn: "7d",
    });
};
