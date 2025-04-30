import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  BadRequestError,
  CustomAPIError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors";
import { prisma } from "../utils/prisma";

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

  next();
};

export const CheckActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) throw new UnauthenticatedError("User information is missing.");

  const { companyId } = req.user;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { subscriptionStatus: true },
  });
  if (!company) throw new NotFoundError("User not found");

  if (company.subscriptionStatus !== "ACTIVE") {
    throw new CustomAPIError(
      "Company subscription is not active.",
      StatusCodes.BAD_REQUEST
    );
  }

  next();
};
