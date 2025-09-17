import express, { Application } from "express";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";
import { dbService } from "@/config/database";
import { telegramBotService } from "@/services/telegramBotService";

// Import middleware
import {
    helmet,
    cors,
    corsOptions,
    helmetOptions,
    requestLoggingMiddleware,
    errorHandlingMiddleware,
    notFoundMiddleware,
    requestSizeLimitMiddleware,
    timeoutMiddleware,
} from "@/middleware/security";
import { sanitizeMiddleware } from "@/middleware/validation";

// Import routes
import webhookRoutes from "@/routes/webhook";
import apiRoutes from "@/routes/api";

export class App {
    private app: Application;
    private server: any;

    constructor() {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // Trust proxy (important for rate limiting and IP detection)
        this.app.set("trust proxy", 1);

        // Security middleware
        this.app.use(helmet(helmetOptions));
        this.app.use(cors(corsOptions));

        // Request parsing middleware
        this.app.use(express.json({ limit: "10mb" }));
        this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

        // Custom middleware
        this.app.use(requestSizeLimitMiddleware("10mb"));
        this.app.use(timeoutMiddleware(30000)); // 30 second timeout
        this.app.use(sanitizeMiddleware);

        // Request logging (only in development)
        if (config.server.env === "development") {
            this.app.use(requestLoggingMiddleware);
        }
    }

    /**
     * Setup routes
     */
    private setupRoutes(): void {
        // Health check endpoint (no rate limiting)
        this.app.get("/health", (req, res) => {
            res.json({
                status: "healthy",
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || "1.0.0",
                environment: config.server.env,
            });
        });

        // API routes
        this.app.use("/api/v1", apiRoutes);

        // Webhook routes
        this.app.use("/webhook", webhookRoutes);

        // Root endpoint
        this.app.get("/", (req, res) => {
            res.json({
                name: "AO Telegram Trading Bot API",
                version: "1.0.0",
                description:
                    "Backend API for AO token trading via Telegram bot",
                endpoints: {
                    health: "/health",
                    api: "/api/v1",
                    webhook: "/webhook",
                },
            });
        });
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        // 404 handler
        this.app.use(notFoundMiddleware);

        // Global error handler
        this.app.use(errorHandlingMiddleware);
    }

    /**
     * Initialize database connection
     */
    private async initializeDatabase(): Promise<void> {
        try {
            await dbService.connect();
            logger.info("Database initialized successfully");
        } catch (error) {
            logger.error("Failed to initialize database:", error);
            throw error;
        }
    }

    /**
     * Initialize Telegram bot
     */
    private async initializeTelegramBot(): Promise<void> {
        try {
            await telegramBotService.start();
            logger.info("Telegram bot initialized successfully");
        } catch (error) {
            logger.error("Failed to initialize Telegram bot:", error);
            throw error;
        }
    }

    /**
     * Start the application
     */
    public async start(): Promise<void> {
        try {
            logger.info("Starting AO Telegram Trading Bot...", {
                environment: config.server.env,
                port: config.server.port,
            });

            // Initialize database
            await this.initializeDatabase();

            // Initialize Telegram bot (non-blocking)
            this.initializeTelegramBot().catch((error) => {
                logger.error("Failed to initialize Telegram bot:", error);
                logger.warn("Continuing without Telegram bot...");
            });

            // Start HTTP server
            this.server = this.app.listen(config.server.port, () => {
                logger.info(`Server started successfully`, {
                    port: config.server.port,
                    environment: config.server.env,
                    pid: process.pid,
                });
            });

            // Handle server errors
            this.server.on("error", (error: any) => {
                if (error.code === "EADDRINUSE") {
                    logger.error(
                        `Port ${config.server.port} is already in use`
                    );
                } else {
                    logger.error("Server error:", error);
                }
                process.exit(1);
            });

            // Graceful shutdown handling
            this.setupGracefulShutdown();

            logger.info("AO Telegram Trading Bot started successfully");
        } catch (error) {
            logger.error("Failed to start application:", error);
            process.exit(1);
        }
    }

    /**
     * Stop the application
     */
    public async stop(): Promise<void> {
        try {
            logger.info("Stopping AO Telegram Trading Bot...");

            // Stop Telegram bot
            await telegramBotService.stop();

            // Close HTTP server
            if (this.server) {
                await new Promise<void>((resolve) => {
                    this.server.close(() => {
                        logger.info("HTTP server closed");
                        resolve();
                    });
                });
            }

            // Disconnect from database
            await dbService.disconnect();

            logger.info("AO Telegram Trading Bot stopped successfully");
        } catch (error) {
            logger.error("Error during shutdown:", error);
            throw error;
        }
    }

    /**
     * Setup graceful shutdown
     */
    private setupGracefulShutdown(): void {
        const shutdown = async (signal: string) => {
            logger.info(`Received ${signal}, starting graceful shutdown...`);

            try {
                await this.stop();
                process.exit(0);
            } catch (error) {
                logger.error("Error during graceful shutdown:", error);
                process.exit(1);
            }
        };

        // Handle shutdown signals
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));

        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            logger.error("Uncaught Exception:", error);
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on("unhandledRejection", (reason, promise) => {
            logger.error("Unhandled Rejection at:", promise, "reason:", reason);
            process.exit(1);
        });
    }

    /**
     * Get Express app instance
     */
    public getApp(): Application {
        return this.app;
    }
}

export default App;
