import argon2 from "argon2";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  BadRequestError,
  CustomAPIError
} from "../errors";
import { emailService } from "../services/emailService";
import {
  createJWT,
  generateVerificationToken,
  handleOtpForCompany,
} from "../utils/authHelpers.h";
import { prisma } from "../utils/prisma.h";

const checkOTP = async ({ email }: { email: string }): Promise<any> => {
  const existingToken = await prisma.otp.findFirst({
    where: { email },
  });
  if (!existingToken) {
    throw new BadRequestError("No OTP was found for that email.");
  }

  const { token, expires } = await generateVerificationToken(
    existingToken!.email
  );

  await prisma.otp.update({
    where: { id: existingToken!.id },
    data: { otp: token, expiresAt: expires },
  });

  await emailService.sendVerificationOTP({
    email: existingToken!.email,
    token,
  });

  return { success: true };
};

export const AuthController = {
  /**
   * Create a new company and initialize its subscription.
   * Steps:
   * - Extract company details and billing info from the request.
   * - Hash the provided password.
   * - Initialize a transaction with the payment gateway (Paystack) to register the company as a customer.
   * - If transaction initialization fails, throw an error.
   * - Verify the customer code from Paystack.
   * - Create the company record with a TRIAL subscription.
   * - Send an OTP to the company email for verification.
   * - Return a response with the payment URL for further action.
   */
  // createCompany: async (req: Request, res: Response): Promise<void> => {
  // 	const {
  // 		company_name,
  // 		company_email,
  // 		password,
  // 		country,
  // 		billingPlan,
  // 		billingType,
  // 	} = req.body;

  // 	// Hash the password before storing it.
  // 	const hashedPassword = await argon2.hash(password);

  // 	// Initialize the company as a customer with Paystack.
  // 	const { error, transaction, verify } =
  // 		await paystackService.initializeTransaction({
  // 			email: company_email,
  // 			amount: "5000",
  // 		});

  // 	// If initialization fails, throw an error.
  // 	if (error || !transaction || !verify) {
  // 		throw new CustomAPIError(
  // 			"Payment gateway initialization failed",
  // 			StatusCodes.BAD_GATEWAY
  // 		);
  // 	}

  // 	// Ensure that the customer was verified successfully.
  // 	if (!verify.customer?.customer_code) {
  // 		throw new CustomAPIError(
  // 			"Payment customer verification failed",
  // 			StatusCodes.BAD_GATEWAY
  // 		);
  // 	}

  // 	// Create the company record in the database with a TRIAL subscription.
  // 	const newCompany = await prisma.company.create({
  // 		data: {
  // 			company_name,
  // 			company_email,
  // 			password: hashedPassword,
  // 			country,
  // 			subscriptionStatus: "TRIAL",
  // 			Subscription: {
  // 				connectOrCreate: {
  // 					where: { payStackCustomerID: verify.customer.customer_code },
  // 					create: {
  // 						tenantId: "change",
  // 						tier: billingPlan.toUpperCase() as Tier,
  // 						tierType: billingType === "month" ? "MONTHLY" : "YEARLY",
  // 						payStackCustomerID: verify?.customer.customer_code,
  // 					},
  // 				},
  // 			},
  // 		},
  // 	});

  // 	// Send an OTP for email verification.
  // 	await handleOtpForCompany(newCompany.company_email).catch(error => {
  // 		throw new CustomAPIError("OTP sending failed", StatusCodes.BAD_GATEWAY);
  // 	});

  // 	// Return success response with the payment URL.
  // 	res.status(StatusCodes.CREATED).json({
  // 		success: true,
  // 		message: "Company created successfully, verify your email to continue.",
  // 		paymentUrl: transaction.authorization_url,
  // 	});
  // },

  createCompanyStripe: async (req: Request, res: Response): Promise<void> => {
    const { company_name, company_email, password, country } = req.body;

    // Hash the password before storing it.
    const hashedPassword = await argon2.hash(password);

    // Create the company record in the database with a TRIAL subscription.
    const newCompany = await prisma.company.create({
      data: {
        company_name,
        company_email,
        password: hashedPassword,
        country,
        subscriptionStatus: "TRIAL",
      },
    });

    await prisma.companyAccount.create({
      data: {
        companyId: newCompany.id,
        tenantId: newCompany.tenantId,
        businessEmail: company_email,
        businessName: company_name,
      },
    });

    await prisma.companyStripeSubscription.create({
      data: { tenantId: newCompany.tenantId, companyId: newCompany.id },
    });

    // Send an OTP for email verification.
    await handleOtpForCompany(newCompany.company_email).catch((error) => {
      throw new CustomAPIError("OTP sending failed", StatusCodes.BAD_GATEWAY);
    });

    // Return success response with the payment URL.
    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Company created successfully, verify your email to continue.",
    });
  },

  /**
   * Verify the OTP sent to the company's email.
   * Steps:
   * - Check that an OTP is provided.
   * - Find a matching, non-expired, unverified OTP record.
   * - Retrieve the company details.
   * - Determine the subscription plan name and set a start date.
   * - Create a Paystack subscription for the company.
   * - Update the company's subscription details, mark it as verified, and remove the OTP record.
   * - Refund the initial fee to the company.
   * - Create a new user record for the company.
   * - Generate and send a JWT via a cookie.
   */
  // verifyOTP: async (req: Request, res: Response): Promise<void> => {
  // 	const { otp, company_email } = req.body;
  // 	if (!otp) {
  // 		throw new BadRequestError("Please enter the OTP sent to your email.");
  // 	}

  // 	// Check for an existing OTP record that matches the provided OTP and is still valid.
  // 	const existingOtp = await prisma.otp.findFirst({
  // 		where: {
  // 			email: company_email,
  // 			otp,
  // 			expiresAt: { gte: new Date() }, // OTP is not expired
  // 			verified: false,
  // 		},
  // 	});
  // 	if (!existingOtp) {
  // 		throw new BadRequestError("Invalid OTP, please try again.");
  // 	}

  // 	// Retrieve the company along with its subscription details.
  // 	const company = await prisma.company.findUnique({
  // 		where: { company_email },
  // 		include: {
  // 			Subscription: {
  // 				select: {
  // 					payStackCustomerID: true,
  // 					tier: true,
  // 					tierType: true,
  // 					authorization_code: true,
  // 					transactionId: true,
  // 				},
  // 			},
  // 		},
  // 	});
  // 	if (!company) {
  // 		throw new BadRequestError("Company not found");
  // 	}

  // 	// Build the plan name based on subscription tier and type.
  // 	const planName = `${company!.Subscription!.tier.toLowerCase()}_${company!
  // 		.Subscription!.tierType.replace("LY", "")
  // 		.toLowerCase()}`;
  // 	// Set the start date (e.g., a 7-day trial period).
  // 	const startDate = new Date();
  // 	startDate.setDate(startDate.getDate() + 1);

  // 	// Create a subscription on Paystack for the company.
  // 	const { error, subscription } = await paystackService.createSubscription({
  // 		customer: company.Subscription!.payStackCustomerID,
  // 		plan: my_plans[planName],
  // 		start_date: startDate,
  // 		authorization: String(company.Subscription!.authorization_code!),
  // 	});

  // 	if (error) {
  // 		throw new CustomAPIError(error, StatusCodes.BAD_GATEWAY);
  // 	}

  // 	// Update the company's subscription details in the database.
  // 	const updatedCompany = await prisma.company.update({
  // 		where: { id: company.id },
  // 		data: {
  // 			subscriptionStatus: "TRIAL",
  // 			verified: true,
  // 			Subscription: {
  // 				update: {
  // 					data: {
  // 						tenantId: company.tenantId,
  // 						payStackSubscriptionCode: subscription?.data.subscription_code,
  // 						startDate: new Date(),
  // 						endDate: subscription?.endDate,
  // 					},
  // 				},
  // 			},
  // 		},
  // 	});

  // 	// Remove the used OTP record.
  // 	await prisma.otp.delete({
  // 		where: { id: existingOtp.id },
  // 	});

  // 	// Refund the initial fee to the company.
  // 	const { error: refundErr, message } = await paystackService.refundTransaction({
  // 		transId: Number(company!.Subscription!.transactionId),
  // 		amount: "5000",
  // 	});

  // 	if (refundErr) {
  // 		throw new CustomAPIError(refundErr, StatusCodes.BAD_GATEWAY);
  // 	}

  // 	// Create a new user record for the company with ADMIN role.
  // 	const user = await prisma.user.create({
  // 		data: {
  // 			tenantId: company.tenantId,
  // 			companyId: updatedCompany.id,
  // 			email: updatedCompany.company_email,
  // 			password: updatedCompany.password,
  // 			role: "ADMIN",
  // 		},
  // 	});

  // 	// Generate a JWT token for authentication.
  // 	const jwtToken = createJWT({
  // 		email: user.email,
  // 		companyId: user.companyId!,
  // 	});

  // 	// Set the JWT token as an HTTP-only cookie.
  // 	res.cookie("token", jwtToken, {
  // 		httpOnly: true,
  // 		secure:isProduction,
  // 		sameSite: "none",
  // 		maxAge: 7 * 24 * 60 * 60 * 1000,
  // 	});

  // 	// Return success response.
  // 	res
  // 		.status(StatusCodes.OK)
  // 		.json({ message: "OTP verified", role: user.role, success: true });
  // },

  verifyOTPStripe: async (req: Request, res: Response): Promise<void> => {
    const { otp, company_email } = req.body;
    if (!otp) {
      throw new BadRequestError("Please enter the OTP sent to your email.");
    }

    // Check for an existing OTP record that matches the provided OTP and is still valid.
    const existingOtp = await prisma.otp.findFirst({
      where: {
        email: company_email,
        otp,
        expiresAt: { gte: new Date() }, // OTP is not expired
        verified: false,
      },
    });
    if (!existingOtp) {
      throw new BadRequestError("Invalid OTP, please try again.");
    }

    // Retrieve the company along with its subscription details.
    const company = await prisma.company.findUnique({
      where: { company_email },
    });
    if (!company) {
      throw new BadRequestError("Company not found");
    }

    // Update the company's subscription details in the database.
    const updatedCompany = await prisma.company.update({
      where: { id: company.id },
      data: {
        subscriptionStatus: "TRIAL",
        verified: true,
      },
    });

    // Remove the used OTP record.
    await prisma.otp.delete({
      where: { id: existingOtp.id },
    });

    // Create a new user record for the company with ADMIN role.
    const user = await prisma.user.create({
      data: {
        tenantId: company.tenantId,
        companyId: updatedCompany.id,
        email: updatedCompany.company_email,
        password: updatedCompany.password,
        role: "ADMIN",
      },
    });

    // Generate a JWT token for authentication.
    const jwtToken = createJWT({
      email: user.email,
      companyId: user.companyId!,
    });

    // Return success response.
    res.status(StatusCodes.OK).json({
      message: "OTP verified",
      role: user.role,
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        phone: user.phone,
        companyStatus: company.subscriptionStatus,
      },
    });
  },

  /**
   * Resend the registration OTP to the provided email.
   * Steps:
   * - Validate that an email is provided.
   * - Ensure a company exists for that email.
   * - Trigger the OTP resend process.
   * - Return a confirmation response.
   */
  resendRegistrationOTP: async (req: Request, res: Response): Promise<void> => {
    const { company_email } = req.body;
    if (!company_email) {
      throw new BadRequestError("Email is required.");
    }

    // Check that a company exists with the provided email.
    const existingCompany = await prisma.company.findUnique({
      where: { company_email },
    });
    if (!existingCompany) {
      throw new BadRequestError("No company was found with that email.");
    }

    // Trigger the OTP check/resend process.
    await checkOTP({ email: existingCompany.company_email });

    res
      .status(StatusCodes.OK)
      .json({ message: "OTP has been sent to your email.", success: true });
  },

  /**
   * Login a user.
   * Steps:
   * - Validate that both email and password are provided.
   * - Find the user by email.
   * - Verify the password.
   * - Create and set a JWT token as an HTTP-only cookie.
   * - Return a success response.
   */
  login: async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new BadRequestError("Please provide email and password");
    }

    // Retrieve the user along with their associated company.
    const user = await prisma.user.findUnique({
      where: { email },
      include: { Company: true },
    });
    if (!user) {
      throw new BadRequestError("No user with this credentials.");
    }

    // Verify that the provided password matches the stored hashed password.
    const passwordMatch = await argon2.verify(user.password, password);
    if (!passwordMatch) {
      throw new BadRequestError("Incorrect password, please try again.");
    }

    // Generate a JWT token.
    const jwtToken = createJWT({
      email: user.email,
      companyId: user.companyId!,
    });

    res.status(StatusCodes.OK).json({
      message: "User logged in successfully.",
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        phone: user.phone,
        companyStatus: user.Company?.subscriptionStatus,
      },
    });
  },

  /**
   * Initiate the password reset process.
   * Steps:
   * - Validate that email and new password are provided.
   * - Find the user by email.
   * - Generate a verification token (OTP) and store it.
   * - Send the OTP to the user's email.
   */
  forgotPassword: async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new BadRequestError("Please provide email and password");
    }

    // Check that a user exists with the provided email.
    const user = await prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new BadRequestError("No user with this credentials.");
    }

    // Generate a verification token and expiration date.
    const { token, expires } = await generateVerificationToken(user!.email);

    // Store the OTP in the database.
    await prisma.otp.create({
      data: { email, otp: token, expiresAt: expires },
    });

    // Send the OTP to the user's email.
    await emailService.sendVerificationOTP({ email, token });

    res.status(StatusCodes.OK).json({
      message: "Reset OTP has been sent to your email.",
      success: true,
    });
  },

  /**
   * Resend an OTP for password reset.
   * Steps:
   * - Validate that an email is provided.
   * - Check that a user exists with that email.
   * - Trigger the OTP resend mechanism.
   * - Return a confirmation response.
   */
  resendOTP: async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    if (!email) {
      throw new BadRequestError("Email is required.");
    }

    // Verify that the user exists.
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (!existingUser) {
      throw new BadRequestError("No user was found with that email.");
    }

    // Trigger OTP resend process.
    await checkOTP({ email: existingUser.email });

    res.status(StatusCodes.OK).json({
      message: "OTP has been sent to your email.",
      success: true,
    });
  },

  /**
   * Reset the user's password using an OTP.
   * Steps:
   * - Validate that email, OTP, and new password are provided.
   * - Find the matching OTP record.
   * - Hash the new password and update the user's password.
   * - Delete the OTP record.
   * - Return a success response.
   */
  resetPassword: async (req: Request, res: Response): Promise<void> => {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) {
      throw new BadRequestError("Please provide email, password and OTP");
    }

    // Find a valid OTP record.
    const existingOtp = await prisma.otp.findFirst({
      where: { email, otp },
    });
    if (!existingOtp) {
      throw new BadRequestError("Invalid OTP.");
    }

    // Hash the new password.
    const hashPassword = await argon2.hash(password);
    // Update the user's password.
    await prisma.user.update({
      where: { email },
      data: { password: hashPassword },
    });

    // Remove the OTP record.
    await prisma.otp.delete({
      where: { id: existingOtp.id },
    });

    res.status(StatusCodes.OK).json({
      message: "Password has been reset successfully.",
      success: true,
    });
  },
};
