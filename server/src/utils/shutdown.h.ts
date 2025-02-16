import { Server } from "http";
import { PrismaClient } from "@prisma/client";

interface GracefulShutdownParams {
	server: Server;
	prisma: PrismaClient;
}

export function setupGracefulShutdown({
	server,
	prisma,
}: GracefulShutdownParams): void {
	const shutdown = async (signal: string): Promise<void> => {
		console.log(`Received ${signal}, shutting down...`);

		// Close server first
		server.close(async () => {
			console.log("HTTP server closed");

			try {
				// Disconnect Prisma
				await prisma.$disconnect();
				console.log("Database connection closed");
			} catch (error) {
				console.error("Error disconnecting from database:", error);
			} finally {
				process.exit(0);
			}
		});

		// Force shutdown after timeout
		const forceTimeout = setTimeout(() => {
			console.error("Forcing shutdown after timeout");
			process.exit(1);
		}, 10000);

		// Clear timeout if normal shutdown completes
		server.on("close", () => clearTimeout(forceTimeout));
	};

	// Handle shutdown signals
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Handle uncaught exceptions
	process.on("uncaughtException", error => {
		console.error("Uncaught Exception:", error);
		shutdown("uncaughtException");
	});

	// Handle unhandled promise rejections
	process.on("unhandledRejection", (reason, promise) => {
		console.error("Unhandled Rejection at:", promise, "reason:", reason);
		shutdown("unhandledRejection");
	});
}
