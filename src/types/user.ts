import { User, Wallet, Transaction } from "@prisma/client";

export interface UserProfile extends Omit<User, "encryptedPrivateKey"> {
    wallets: Wallet[];
    transactionCount?: number;
    lastTransaction?: Transaction;
}

export interface CreateUserRequest {
    telegramId: string;
    telegramUsername?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
    isBot?: boolean;
    isPremium?: boolean;
}

export interface UpdateUserRequest {
    telegramUsername?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
    notifications?: boolean;
    isActive?: boolean;
}

export interface UserStats {
    totalTransactions: number;
    confirmedTransactions: number;
    failedTransactions: number;
    totalWallets: number;
    successRate: number;
    totalVolume?: string;
    favoriteTokens?: string[];
}

export interface UserSession {
    userId: string;
    telegramChatId: string;
    sessionData?: any;
    currentStep?: string;
    isActive: boolean;
    expiresAt: Date;
}
