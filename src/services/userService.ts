import { User, Wallet, Transaction, Prisma } from "@prisma/client";
import { db } from "@/config/database";
import { logger } from "@/utils/logger";
import { encryptionService } from "@/utils/encryption";
import { aoWalletService, AOWallet } from "@/services/aoWalletService";

export interface CreateUserParams {
    telegramId: string;
    telegramUsername?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
    isBot?: boolean;
    isPremium?: boolean;
}

export interface UserWithWallet extends User {
    wallets: Wallet[];
}

export interface CreateWalletParams {
    userId: string;
    name?: string;
    description?: string;
    walletType?: "MAIN" | "TRADING" | "SAVINGS" | "STAKING";
}

export class UserService {
    /**
     * Create a new user with encrypted wallet
     * @param params - User creation parameters
     * @returns Promise<UserWithWallet> - Created user with wallet
     */
    public async createUser(params: CreateUserParams): Promise<UserWithWallet> {
        try {
            logger.info("Creating new user", { telegramId: params.telegramId });

            // Check if user already exists
            const existingUser = await this.getUserByTelegramId(
                params.telegramId
            );
            if (existingUser) {
                logger.warn("User already exists", {
                    telegramId: params.telegramId,
                });
                return existingUser;
            }

            // Generate new AO wallet
            const wallet = await aoWalletService.generateWallet();

            // Encrypt private key
            const encryptedPrivateKey = encryptionService.encrypt(
                wallet.privateKey
            );

            // Create user with wallet in transaction
            const user = await db.$transaction(async (tx) => {
                // Create user
                const newUser = await tx.user.create({
                    data: {
                        telegramId: params.telegramId,
                        telegramUsername: params.telegramUsername,
                        firstName: params.firstName,
                        lastName: params.lastName,
                        languageCode: params.languageCode,
                        isBot: params.isBot || false,
                        isPremium: params.isPremium || false,
                        encryptedPrivateKey,
                        walletAddress: wallet.address,
                    },
                });

                // Create main wallet record
                const mainWallet = await tx.wallet.create({
                    data: {
                        userId: newUser.id,
                        processId: wallet.address, // Using address as initial process ID
                        name: "Main Wallet",
                        description: "Primary wallet for AO transactions",
                        walletType: "MAIN",
                    },
                });

                return { ...newUser, wallets: [mainWallet] };
            });

            logger.info("User created successfully", {
                userId: user.id,
                telegramId: params.telegramId,
                walletAddress: wallet.address,
            });

            return user;
        } catch (error) {
            logger.error("Failed to create user:", error);
            throw new Error("Failed to create user");
        }
    }

    /**
     * Get user by Telegram ID
     * @param telegramId - Telegram user ID
     * @returns Promise<UserWithWallet | null> - User with wallets or null
     */
    public async getUserByTelegramId(
        telegramId: string
    ): Promise<UserWithWallet | null> {
        try {
            const user = await db.user.findUnique({
                where: { telegramId },
                include: { wallets: true },
            });

            if (user) {
                logger.debug("User found", { userId: user.id, telegramId });
            }

            return user;
        } catch (error) {
            logger.error("Failed to get user by Telegram ID:", error);
            throw new Error("Failed to get user");
        }
    }

    /**
     * Get user by ID
     * @param userId - User ID
     * @returns Promise<UserWithWallet | null> - User with wallets or null
     */
    public async getUserById(userId: string): Promise<UserWithWallet | null> {
        try {
            const user = await db.user.findUnique({
                where: { id: userId },
                include: { wallets: true },
            });

            return user;
        } catch (error) {
            logger.error("Failed to get user by ID:", error);
            throw new Error("Failed to get user");
        }
    }

    /**
     * Update user information
     * @param userId - User ID
     * @param updateData - Data to update
     * @returns Promise<User> - Updated user
     */
    public async updateUser(
        userId: string,
        updateData: Partial<User>
    ): Promise<User> {
        try {
            logger.info("Updating user", { userId });

            const user = await db.user.update({
                where: { id: userId },
                data: {
                    ...updateData,
                    updatedAt: new Date(),
                },
            });

            logger.info("User updated successfully", { userId });
            return user;
        } catch (error) {
            logger.error("Failed to update user:", error);
            throw new Error("Failed to update user");
        }
    }

    /**
     * Update user's last active timestamp
     * @param userId - User ID
     * @returns Promise<void>
     */
    public async updateLastActive(userId: string): Promise<void> {
        try {
            await db.user.update({
                where: { id: userId },
                data: { lastActiveAt: new Date() },
            });
        } catch (error) {
            logger.error("Failed to update last active:", error);
            // Don't throw error for this operation
        }
    }

    /**
     * Get user's decrypted wallet
     * @param userId - User ID
     * @returns Promise<AOWallet> - Decrypted wallet
     */
    public async getUserWallet(userId: string): Promise<AOWallet> {
        try {
            const user = await db.user.findUnique({
                where: { id: userId },
                select: { encryptedPrivateKey: true, walletAddress: true },
            });

            if (!user) {
                throw new Error("User not found");
            }

            // Load wallet from encrypted private key
            const wallet = await aoWalletService.loadWallet(
                user.encryptedPrivateKey
            );

            return wallet;
        } catch (error) {
            logger.error("Failed to get user wallet:", error);
            throw new Error("Failed to get user wallet");
        }
    }

    /**
     * Create additional wallet for user
     * @param params - Wallet creation parameters
     * @returns Promise<Wallet> - Created wallet
     */
    public async createWallet(params: CreateWalletParams): Promise<Wallet> {
        try {
            logger.info("Creating additional wallet", {
                userId: params.userId,
            });

            // Generate new wallet
            const aoWallet = await aoWalletService.generateWallet();

            // Create wallet record
            const wallet = await db.wallet.create({
                data: {
                    userId: params.userId,
                    processId: aoWallet.address,
                    name: params.name || "Additional Wallet",
                    description: params.description,
                    walletType: params.walletType || "TRADING",
                },
            });

            logger.info("Additional wallet created", {
                walletId: wallet.id,
                userId: params.userId,
                processId: aoWallet.address,
            });

            return wallet;
        } catch (error) {
            logger.error("Failed to create wallet:", error);
            throw new Error("Failed to create wallet");
        }
    }

    /**
     * Get user's wallets
     * @param userId - User ID
     * @returns Promise<Wallet[]> - User's wallets
     */
    public async getUserWallets(userId: string): Promise<Wallet[]> {
        try {
            const wallets = await db.wallet.findMany({
                where: { userId, isActive: true },
                orderBy: { createdAt: "asc" },
            });

            return wallets;
        } catch (error) {
            logger.error("Failed to get user wallets:", error);
            throw new Error("Failed to get user wallets");
        }
    }

    /**
     * Get user's transaction history
     * @param userId - User ID
     * @param limit - Number of transactions to fetch
     * @param offset - Offset for pagination
     * @returns Promise<Transaction[]> - User's transactions
     */
    public async getUserTransactions(
        userId: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<Transaction[]> {
        try {
            const transactions = await db.transaction.findMany({
                where: { userId },
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
                include: {
                    wallet: true,
                },
            });

            return transactions;
        } catch (error) {
            logger.error("Failed to get user transactions:", error);
            throw new Error("Failed to get user transactions");
        }
    }

    /**
     * Create transaction record
     * @param transactionData - Transaction data
     * @returns Promise<Transaction> - Created transaction
     */
    public async createTransaction(
        transactionData: Prisma.TransactionCreateInput
    ): Promise<Transaction> {
        try {
            logger.info("Creating transaction record", {
                type: transactionData.type,
                amount: transactionData.amount,
            });

            const transaction = await db.transaction.create({
                data: transactionData,
            });

            logger.info("Transaction record created", {
                transactionId: transaction.id,
            });
            return transaction;
        } catch (error) {
            logger.error("Failed to create transaction:", error);
            throw new Error("Failed to create transaction");
        }
    }

    /**
     * Update transaction status
     * @param transactionId - Transaction ID
     * @param status - New status
     * @param result - Transaction result (optional)
     * @param errorMessage - Error message (optional)
     * @returns Promise<Transaction> - Updated transaction
     */
    public async updateTransactionStatus(
        transactionId: string,
        status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED",
        result?: any,
        errorMessage?: string
    ): Promise<Transaction> {
        try {
            const updateData: Prisma.TransactionUpdateInput = {
                status,
                updatedAt: new Date(),
            };

            if (result) {
                updateData.result = result;
            }

            if (errorMessage) {
                updateData.errorMessage = errorMessage;
            }

            if (status === "CONFIRMED") {
                updateData.confirmedAt = new Date();
            }

            const transaction = await db.transaction.update({
                where: { id: transactionId },
                data: updateData,
            });

            logger.info("Transaction status updated", {
                transactionId,
                status,
                hasError: !!errorMessage,
            });

            return transaction;
        } catch (error) {
            logger.error("Failed to update transaction status:", error);
            throw new Error("Failed to update transaction status");
        }
    }

    /**
     * Get user statistics
     * @param userId - User ID
     * @returns Promise<any> - User statistics
     */
    public async getUserStats(userId: string): Promise<any> {
        try {
            const [
                totalTransactions,
                confirmedTransactions,
                failedTransactions,
                totalWallets,
            ] = await Promise.all([
                db.transaction.count({ where: { userId } }),
                db.transaction.count({
                    where: { userId, status: "CONFIRMED" },
                }),
                db.transaction.count({ where: { userId, status: "FAILED" } }),
                db.wallet.count({ where: { userId, isActive: true } }),
            ]);

            return {
                totalTransactions,
                confirmedTransactions,
                failedTransactions,
                totalWallets,
                successRate:
                    totalTransactions > 0
                        ? (confirmedTransactions / totalTransactions) * 100
                        : 0,
            };
        } catch (error) {
            logger.error("Failed to get user stats:", error);
            throw new Error("Failed to get user stats");
        }
    }

    /**
     * Delete user and all associated data
     * @param userId - User ID
     * @returns Promise<void>
     */
    public async deleteUser(userId: string): Promise<void> {
        try {
            logger.info("Deleting user", { userId });

            await db.$transaction(async (tx) => {
                // Delete transactions
                await tx.transaction.deleteMany({ where: { userId } });

                // Delete wallets
                await tx.wallet.deleteMany({ where: { userId } });

                // Delete trading pairs
                await tx.tradingPair.deleteMany({ where: { userId } });

                // Delete sessions
                await tx.session.deleteMany({ where: { userId } });

                // Delete user
                await tx.user.delete({ where: { id: userId } });
            });

            logger.info("User deleted successfully", { userId });
        } catch (error) {
            logger.error("Failed to delete user:", error);
            throw new Error("Failed to delete user");
        }
    }
}

// Export singleton instance
export const userService = new UserService();
export default UserService;
