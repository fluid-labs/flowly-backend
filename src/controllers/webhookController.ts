import { Request, Response } from "express";
import { telegramBotService } from "@/services/telegramBotService";
import { logger } from "@/utils/logger";
import { encryptionService } from "@/utils/encryption";
import { config } from "@/config/environment";

export class WebhookController {
    /**
     * Handle Telegram webhook
     */
    public async handleTelegramWebhook(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const update = req.body;

            // Verify webhook signature if secret is configured
            if (config.webhook?.secret) {
                const signature = req.headers[
                    "x-telegram-bot-api-secret-token"
                ] as string;
                if (signature !== config.webhook.secret) {
                    logger.warn("Invalid webhook signature");
                    res.status(401).json({ error: "Unauthorized" });
                    return;
                }
            }

            logger.debug("Received Telegram webhook", {
                updateId: update.update_id,
                type: Object.keys(update).filter(
                    (key) => key !== "update_id"
                )[0],
            });

            // Handle the update
            await telegramBotService.handleWebhook(update);

            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error("Webhook handling error:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    /**
     * Set webhook URL
     */
    public async setWebhook(req: Request, res: Response): Promise<void> {
        try {
            const { url, secret } = req.body;

            if (!url) {
                res.status(400).json({ error: "Webhook URL is required" });
                return;
            }

            const bot = telegramBotService.getBot();

            const webhookOptions: any = { url };
            if (secret) {
                webhookOptions.secret_token = secret;
            }

            await bot.telegram.setWebhook(webhookOptions.url, webhookOptions);

            logger.info("Webhook set successfully", { url });
            res.json({ success: true, url });
        } catch (error) {
            logger.error("Failed to set webhook:", error);
            res.status(500).json({ error: "Failed to set webhook" });
        }
    }

    /**
     * Get webhook info
     */
    public async getWebhookInfo(req: Request, res: Response): Promise<void> {
        try {
            const bot = telegramBotService.getBot();
            const webhookInfo = await bot.telegram.getWebhookInfo();

            res.json(webhookInfo);
        } catch (error) {
            logger.error("Failed to get webhook info:", error);
            res.status(500).json({ error: "Failed to get webhook info" });
        }
    }

    /**
     * Delete webhook
     */
    public async deleteWebhook(req: Request, res: Response): Promise<void> {
        try {
            const bot = telegramBotService.getBot();
            await bot.telegram.deleteWebhook();

            logger.info("Webhook deleted successfully");
            res.json({ success: true });
        } catch (error) {
            logger.error("Failed to delete webhook:", error);
            res.status(500).json({ error: "Failed to delete webhook" });
        }
    }

    /**
     * Health check endpoint
     */
    public async healthCheck(req: Request, res: Response): Promise<void> {
        try {
            const bot = telegramBotService.getBot();
            const me = await bot.telegram.getMe();

            res.json({
                status: "healthy",
                bot: {
                    id: me.id,
                    username: me.username,
                    first_name: me.first_name,
                },
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            logger.error("Health check failed:", error);
            res.status(500).json({
                status: "unhealthy",
                error: "Bot connection failed",
                timestamp: new Date().toISOString(),
            });
        }
    }
}

export const webhookController = new WebhookController();
