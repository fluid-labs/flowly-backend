import { Request, Response } from "express";
import { userService } from "@/services/userService";
import { aoWalletService } from "@/services/aoWalletService";
import { logger } from "@/utils/logger";
import { dbService } from "@/config/database";
import { LangChainService } from "@/services/langchainService";

export class ApiController {
    /**
     * Get user information
     */
    public async getUser(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;

            if (!telegramId) {
                res.status(400).json({ error: "Telegram ID is required" });
                return;
            }

            const user = await userService.getUserByTelegramId(telegramId);

            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            // Remove sensitive data
            const { encryptedPrivateKey, ...safeUser } = user;

            res.json(safeUser);
        } catch (error) {
            logger.error("Failed to get user:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    /**
     * Get user wallet balance
     */
    public async getUserBalance(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const balance = await aoWalletService.getWalletBalance(
                user.walletAddress
            );

            res.json({
                address: user.walletAddress,
                balance,
                currency: "AR",
            });
        } catch (error) {
            logger.error("Failed to get user balance:", error);
            res.status(500).json({ error: "Failed to get balance" });
        }
    }

    /**
     * Get user transaction history
     */
    public async getUserTransactions(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const { telegramId } = req.params;
            const { limit = 50, offset = 0 } = req.query;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const transactions = await userService.getUserTransactions(
                user.id,
                parseInt(limit as string),
                parseInt(offset as string)
            );

            res.json({
                transactions,
                pagination: {
                    limit: parseInt(limit as string),
                    offset: parseInt(offset as string),
                    total: transactions.length,
                },
            });
        } catch (error) {
            logger.error("Failed to get user transactions:", error);
            res.status(500).json({ error: "Failed to get transactions" });
        }
    }

    /**
     * Send tokens
     */
    public async sendTokens(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;
            const { processId, recipient, quantity, tags } = req.body;

            if (!processId || !recipient || !quantity) {
                res.status(400).json({
                    error: "Process ID, recipient, and quantity are required",
                });
                return;
            }

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            // Get user wallet
            const wallet = await userService.getUserWallet(user.id);

            // Create transaction record
            const transaction = await userService.createTransaction({
                user: { connect: { id: user.id } },
                txId: "", // Will be updated after sending
                processId,
                type: "SEND",
                action: "Transfer",
                amount: quantity.toString(),
                fromAddress: wallet.address,
                toAddress: recipient,
                status: "PENDING",
            });

            try {
                // Send tokens
                const messageId = await aoWalletService.transferTokens(wallet, {
                    processId,
                    recipient,
                    quantity: quantity.toString(),
                    tags,
                });

                // Update transaction with message ID
                await userService.updateTransactionStatus(
                    transaction.id,
                    "PENDING",
                    { messageId }
                );

                res.json({
                    success: true,
                    transactionId: transaction.id,
                    messageId,
                });
            } catch (transferError) {
                // Update transaction as failed
                await userService.updateTransactionStatus(
                    transaction.id,
                    "FAILED",
                    null,
                    transferError instanceof Error
                        ? transferError.message
                        : "Transfer failed"
                );

                throw transferError;
            }
        } catch (error) {
            logger.error("Failed to send tokens:", error);
            res.status(500).json({ error: "Failed to send tokens" });
        }
    }

    /**
     * Get token balance
     */
    public async getTokenBalance(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId, tokenProcessId } = req.params;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const wallet = await userService.getUserWallet(user.id);
            const tokenBalance = await aoWalletService.getTokenBalance(
                wallet,
                tokenProcessId
            );

            res.json(tokenBalance);
        } catch (error) {
            logger.error("Failed to get token balance:", error);
            res.status(500).json({ error: "Failed to get token balance" });
        }
    }

    /**
     * Get token information
     */
    public async getTokenInfo(req: Request, res: Response): Promise<void> {
        try {
            const { tokenProcessId } = req.params;

            const tokenInfo = await aoWalletService.getTokenInfo(
                tokenProcessId
            );

            res.json(tokenInfo);
        } catch (error) {
            logger.error("Failed to get token info:", error);
            res.status(500).json({ error: "Failed to get token info" });
        }
    }

    /**
     * Get user statistics
     */
    public async getUserStats(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const stats = await userService.getUserStats(user.id);

            res.json(stats);
        } catch (error) {
            logger.error("Failed to get user stats:", error);
            res.status(500).json({ error: "Failed to get user stats" });
        }
    }

    /**
     * Create additional wallet
     */
    public async createWallet(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;
            const { name, description, walletType } = req.body;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const wallet = await userService.createWallet({
                userId: user.id,
                name,
                description,
                walletType,
            });

            res.json(wallet);
        } catch (error) {
            logger.error("Failed to create wallet:", error);
            res.status(500).json({ error: "Failed to create wallet" });
        }
    }

    /**
     * Get user wallets
     */
    public async getUserWallets(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;

            const user = await userService.getUserByTelegramId(telegramId);
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            const wallets = await userService.getUserWallets(user.id);

            res.json(wallets);
        } catch (error) {
            logger.error("Failed to get user wallets:", error);
            res.status(500).json({ error: "Failed to get user wallets" });
        }
    }

    /**
     * System health check
     */
    public async healthCheck(req: Request, res: Response): Promise<void> {
        try {
            // Check database connection
            const dbHealthy = await dbService.healthCheck();

            // Check AO network connectivity
            let aoHealthy = false;
            try {
                // Try to generate a test wallet to verify AO connectivity
                await aoWalletService.generateWallet();
                aoHealthy = true;
            } catch (error) {
                logger.warn("AO network health check failed:", error);
            }

            const status = dbHealthy && aoHealthy ? "healthy" : "degraded";
            const statusCode = status === "healthy" ? 200 : 503;

            res.status(statusCode).json({
                status,
                timestamp: new Date().toISOString(),
                services: {
                    database: dbHealthy ? "healthy" : "unhealthy",
                    ao_network: aoHealthy ? "healthy" : "unhealthy",
                },
            });
        } catch (error) {
            logger.error("Health check failed:", error);
            res.status(500).json({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: "Health check failed",
            });
        }
    }

    /**
     * Get system statistics
     */
    public async getSystemStats(req: Request, res: Response): Promise<void> {
        try {
            // This would require admin authentication in production
            const stats = {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
            };

            res.json(stats);
        } catch (error) {
            logger.error("Failed to get system stats:", error);
            res.status(500).json({ error: "Failed to get system stats" });
        }
    }
    /**
     * Create a test user
     */
    public async createTestUser(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;
            const { firstName, lastName, telegramUsername } = req.body;

            if (!telegramId) {
                res.status(400).json({
                    error: "Telegram ID is required",
                });
                return;
            }

            // Check if user already exists
            const existingUser = await userService.getUserByTelegramId(
                telegramId
            );
            if (existingUser) {
                res.json({
                    success: true,
                    message: "User already exists",
                    user: {
                        id: existingUser.id,
                        telegramId: existingUser.telegramId,
                        walletAddress: existingUser.walletAddress,
                        firstName: existingUser.firstName,
                    },
                });
                return;
            }

            // Create new user
            const user = await userService.createUser({
                telegramId,
                firstName: firstName || "Test User",
                lastName: lastName || "",
                telegramUsername: telegramUsername || "",
            });

            res.json({
                success: true,
                message: "User created successfully",
                user: {
                    id: user.id,
                    telegramId: user.telegramId,
                    walletAddress: user.walletAddress,
                    firstName: user.firstName,
                },
            });
        } catch (error) {
            logger.error("Create test user error:", error);
            res.status(500).json({
                error: "Failed to create test user",
                details:
                    error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    /**
     * Test LangChain functionality
     */
    public async testLangChain(req: Request, res: Response): Promise<void> {
        try {
            const { telegramId } = req.params;
            const { message } = req.body;

            if (!telegramId || !message) {
                res.status(400).json({
                    error: "Telegram ID and message are required",
                });
                return;
            }

            const langChainService = new LangChainService();

            const response = await langChainService.processMessage(
                parseInt(telegramId),
                message,
                []
            );

            res.json({
                success: true,
                userMessage: message,
                aiResponse: response,
                telegramId: telegramId,
            });
        } catch (error) {
            logger.error("LangChain test error:", error);
            res.status(500).json({
                error: "Failed to process LangChain request",
                details:
                    error instanceof Error ? error.message : "Unknown error",
            });
        }
    }
}

export const apiController = new ApiController();
