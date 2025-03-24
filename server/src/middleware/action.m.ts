import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  BadRequestError,
  CustomAPIError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors";
import { prisma } from "../utils/prisma.h";

export const SubscriptionMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) throw new UnauthenticatedError("User information is missing.");

  const { email, companyId } = req.user;

  const adminUser = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  if (!adminUser) throw new NotFoundError("User not found");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { subscriptionStatus: true },
  });
  if (!company) throw new NotFoundError("User not found");

  if (adminUser?.role === "EMPLOYEE") {
    throw new CustomAPIError(
      "You are unauthorized to perform this action.",
      StatusCodes.UNAUTHORIZED
    );
  }

  if (adminUser?.role === "ADMIN") {
    if (company?.subscriptionStatus === "ACTIVE") {
      next();
    } else {
      throw new BadRequestError(
        "Your subscription is not currently active. Please renew your subscription to access this feature."
      );
    }
  }
};
