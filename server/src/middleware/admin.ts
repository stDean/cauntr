import { NextFunction, Request, Response } from "express";
import { UnauthenticatedError } from "../errors/index.js";
import { prisma } from "../utils/prisma.js";

export const AdminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { email } = req.user;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new UnauthenticatedError("User not found.");
  }

  if (user.role !== "ADMIN") {
    throw new UnauthenticatedError(
      "You are not authorized to perform this action"
    );
  }

  next();
};
