import { Router } from "express";
import { webhookController } from "@/controllers/webhookController";
import { rateLimitMiddleware } from "@/middleware/rateLimit";

const router = Router();

// Telegram webhook endpoint
router.post(
    "/telegram",
    rateLimitMiddleware,
    webhookController.handleTelegramWebhook
);

// Webhook management endpoints
router.post("/telegram/set", webhookController.setWebhook);
router.get("/telegram/info", webhookController.getWebhookInfo);
router.delete("/telegram", webhookController.deleteWebhook);

// Health check for webhook
router.get("/health", webhookController.healthCheck);

export default router;
