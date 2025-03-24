import cors from "cors";
import dotenv from "dotenv";
import express, { Application, Request, Response } from "express";
import "express-async-errors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { notFound as notFoundMiddleware } from "./middleware/notFoundError.m.js";
import { errorHandlerMiddleware } from "./middleware/error-handling.m.js";
import { setupGracefulShutdown } from "./utils/shutdown.h.js";
import { prisma } from "./utils/prisma.h.js";
import Routes from "./routes/index.js";
import PayStackWebhook from "./webhook/paystack.w.js";
import { ScheduleJob } from "./jobs/schedule.j.js";
import { scheduleJob } from "node-schedule";
import StripeWebhook from "./webhook/stripe.w.js";

const app: Application = express();
dotenv.config();

// Webhooks
app.use("/api/v1", PayStackWebhook);
app.use("/api/v1", StripeWebhook);

// Middleware order matters (Helmet first for security)
app.use(
  cors({
    origin: true, // Replace with your frontend URL
    credentials: true, // Allow cookies to be sent
  })
); // Enable CORS
app.use(helmet()); // Set security headers
app.use(morgan("tiny")); // Log requests
app.use(express.json()); // Parse JSON bodies
app.use(cookieParser()); // Parse cookies

// Routes
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({ msg: "Hello, world!" });
});

app.use("/api/v1", Routes);

// Error handling middleware
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

/* SUBSCRIPTION SCHEDULING SYSTEM */
function initializeSubscriptionJobs() {
  // Daily check for pending subscription updates
  scheduleJob("0 12 * * *", async () => {
    // 12 PM UTC (8 AM EST)
    try {
      console.log("Checking for pending subscription updates...");
      await ScheduleJob.processPendingSubscriptions();
    } catch (error) {
      console.error("Subscription update check failed:", error);
    }
  });

  // Hourly cleanup of expired scheduling data
  scheduleJob("0 * * * *", async () => {
    const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6);
    await prisma.company.updateMany({
      where: {
        AND: [
          { nextBillingDate: { lte: sixMonthsAgo } },
          { pendingPlanUpdate: { not: null } },
        ],
      },
      data: {
        pendingPlanUpdate: null,
        nextBillingDate: null,
      },
    });
  });
}

async function setupScheduledJobs() {
  try {
    // Initialize subscription-related jobs
    await ScheduleJob.initializeScheduledJobs();
    initializeSubscriptionJobs();

    // Schedule email jobs

    console.log("All scheduled jobs initialized");
  } catch (error) {
    console.error("Failed to initialize scheduled jobs:", error);
    throw error;
  }
}

/* APPLICATION STARTUP */
async function startServer(): Promise<void> {
  try {
    // Connect to database
    await prisma.$connect();
    console.log("Database connected successfully");

    // Initialize all scheduled jobs
    await setupScheduledJobs();

    // Start server
    const port = process.env.PORT || "5001";
    const server = app.listen(parseInt(port), () => {
      console.log(`Server running on port ${port}`);
    });

    // Configure graceful shutdown
    setupGracefulShutdown({ server, prisma });
  } catch (error) {
    console.error("Server startup failed:", error as Error);
    process.exit(1);
  }
}

startServer();
