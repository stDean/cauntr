import cors from "cors";
import dotenv from "dotenv";
import express, { Application, Request, Response } from "express";
import "express-async-errors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { notFound as notFoundMiddleware } from "./middleware/notFoundError.m.js";
import { errorHandlerMiddleware } from "./middleware/error-handling.m.js";
import { setupGracefulShutdown } from "./helpers/shutdown.h.js";
import { prisma } from "./helpers/prisma.h.js";
import Routes from "./routes/index.js";
import PayStackWebhook from "./webhook/paystack.w.js";

const app: Application = express();
dotenv.config();

// Middleware order matters (Helmet first for security)
app.use(cors()); // Enable CORS
app.use(helmet()); // Set security headers
app.use(morgan("tiny")); // Log requests
app.use(express.json()); // Parse JSON bodies
app.use(cookieParser()); // Parse cookies

// Routes
app.get("/", (req: Request, res: Response) => {
	res.status(200).json({ msg: "Hello, world!" });
});

app.use("/api/v1", Routes);
app.use("/api/v1", PayStackWebhook);

// Error handling middleware
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

/* APPLICATION STARTUP */
async function startServer(): Promise<void> {
	try {
		// Connect to database
		await prisma.$connect();
		console.log("Database connected successfully");

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
