import { Router } from "express";
import { apiController } from "@/controllers/apiController";
import { rateLimitMiddleware } from "@/middleware/rateLimit";
import { validateRequest } from "@/middleware/validation";
import Joi from "joi";

const router = Router();

// Validation schemas
const sendTokensSchema = Joi.object({
    processId: Joi.string().required(),
    recipient: Joi.string().required(),
    quantity: Joi.string().required(),
    tags: Joi.array()
        .items(
            Joi.object({
                name: Joi.string().required(),
                value: Joi.string().required(),
            })
        )
        .optional(),
});

const createWalletSchema = Joi.object({
    name: Joi.string().optional(),
    description: Joi.string().optional(),
    walletType: Joi.string()
        .valid("MAIN", "TRADING", "SAVINGS", "STAKING")
        .optional(),
});

// User endpoints
router.get("/users/:telegramId", rateLimitMiddleware, apiController.getUser);
router.get(
    "/users/:telegramId/balance",
    rateLimitMiddleware,
    apiController.getUserBalance
);
router.get(
    "/users/:telegramId/transactions",
    rateLimitMiddleware,
    apiController.getUserTransactions
);
router.get(
    "/users/:telegramId/stats",
    rateLimitMiddleware,
    apiController.getUserStats
);
router.get(
    "/users/:telegramId/wallets",
    rateLimitMiddleware,
    apiController.getUserWallets
);

// Wallet endpoints
router.post(
    "/users/:telegramId/wallets",
    rateLimitMiddleware,
    validateRequest(createWalletSchema),
    apiController.createWallet
);

// Transaction endpoints
router.post(
    "/users/:telegramId/send",
    rateLimitMiddleware,
    validateRequest(sendTokensSchema),
    apiController.sendTokens
);

// Token endpoints
router.get(
    "/users/:telegramId/tokens/:tokenProcessId/balance",
    rateLimitMiddleware,
    apiController.getTokenBalance
);
router.get(
    "/tokens/:tokenProcessId/info",
    rateLimitMiddleware,
    apiController.getTokenInfo
);

// System endpoints
router.get("/health", apiController.healthCheck);
router.get("/stats", rateLimitMiddleware, apiController.getSystemStats);

export default router;
