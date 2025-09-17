import { Telegraf, Context, Markup } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";
import { userService } from "@/services/userService";
import { aoWalletService } from "@/services/aoWalletService";
import { encryptionService } from "@/utils/encryption";

export interface BotContext extends Context {
    user?: any;
    session?: any;
}

export interface CommandHandler {
    command: string;
    description: string;
    handler: (ctx: BotContext) => Promise<void>;
}

export class TelegramBotService {
    private bot: Telegraf<BotContext>;
    private commands: Map<string, CommandHandler> = new Map();

    constructor() {
        this.bot = new Telegraf<BotContext>(config.telegram.botToken);
        this.setupMiddleware();
        this.setupCommands();
        this.setupCallbackHandlers();
        this.setupErrorHandling();
    }

    /**
     * Setup middleware for user authentication and session management
     */
    private setupMiddleware(): void {
        // User authentication middleware
        this.bot.use(async (ctx, next) => {
            try {
                if (ctx.from) {
                    // Get or create user
                    let user = await userService.getUserByTelegramId(
                        ctx.from.id.toString()
                    );

                    if (!user) {
                        // Create new user if doesn't exist
                        user = await userService.createUser({
                            telegramId: ctx.from.id.toString(),
                            telegramUsername: ctx.from.username,
                            firstName: ctx.from.first_name,
                            lastName: ctx.from.last_name,
                            languageCode: ctx.from.language_code,
                            isBot: ctx.from.is_bot,
                            isPremium: ctx.from.is_premium,
                        });

                        logger.info("New user created via bot", {
                            userId: user.id,
                            telegramId: ctx.from.id,
                        });
                    } else {
                        // Update last active
                        await userService.updateLastActive(user.id);
                    }

                    ctx.user = user;
                }

                await next();
            } catch (error) {
                logger.error("Middleware error:", error);
                await ctx.reply(
                    "❌ An error occurred. Please try again later."
                );
            }
        });

        // Logging middleware
        this.bot.use(async (ctx, next) => {
            const start = Date.now();
            await next();
            const duration = Date.now() - start;

            logger.info("Bot request processed", {
                userId: ctx.user?.id,
                telegramId: ctx.from?.id,
                updateType: ctx.updateType,
                duration: `${duration}ms`,
            });
        });
    }

    /**
     * Setup bot commands
     */
    private setupCommands(): void {
        // Start command
        this.addCommand({
            command: "start",
            description: "Start using the AO Trading Bot",
            handler: this.handleStart.bind(this),
        });

        // Wallet command
        this.addCommand({
            command: "wallet",
            description: "View wallet information",
            handler: this.handleWallet.bind(this),
        });

        // Balance command
        this.addCommand({
            command: "balance",
            description: "Check wallet balance",
            handler: this.handleBalance.bind(this),
        });

        // Send command
        this.addCommand({
            command: "send",
            description: "Send tokens to another address",
            handler: this.handleSend.bind(this),
        });

        // History command
        this.addCommand({
            command: "history",
            description: "View transaction history",
            handler: this.handleHistory.bind(this),
        });

        // Help command
        this.addCommand({
            command: "help",
            description: "Show available commands",
            handler: this.handleHelp.bind(this),
        });

        // Settings command
        this.addCommand({
            command: "settings",
            description: "Bot settings and preferences",
            handler: this.handleSettings.bind(this),
        });

        // Stats command
        this.addCommand({
            command: "stats",
            description: "View account statistics",
            handler: this.handleStats.bind(this),
        });
    }

    /**
     * Add a command handler
     */
    private addCommand(commandHandler: CommandHandler): void {
        this.commands.set(commandHandler.command, commandHandler);
        this.bot.command(commandHandler.command, commandHandler.handler);
    }

    /**
     * Handle /start command
     */
    private async handleStart(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;
            const isNewUser =
                ctx.message?.date &&
                Date.now() - ctx.message.date * 1000 < 5000;

            let message = "";

            if (isNewUser) {
                message = `🎉 Welcome to AO Trading Bot, ${
                    user.firstName || "there"
                }!\n\n`;
                message += `✅ Your secure wallet has been created!\n`;
                message += `🔐 Address: \`${user.walletAddress}\`\n\n`;
                message += `🚀 You can now:\n`;
                message += `• Check your balance\n`;
                message += `• Send and receive tokens\n`;
                message += `• View transaction history\n`;
                message += `• Trade on AO network\n\n`;
                message += `Type /help to see all available commands.`;
            } else {
                message = `👋 Welcome back, ${user.firstName || "there"}!\n\n`;
                message += `🔐 Your wallet: \`${user.walletAddress}\`\n\n`;
                message += `What would you like to do today?`;
            }

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("💰 Check Balance", "balance"),
                    Markup.button.callback("📊 View Stats", "stats"),
                ],
                [
                    Markup.button.callback("💸 Send Tokens", "send"),
                    Markup.button.callback("📜 History", "history"),
                ],
                [
                    Markup.button.callback("⚙️ Settings", "settings"),
                    Markup.button.callback("❓ Help", "help"),
                ],
            ]);

            await ctx.reply(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in start command:", error);
            await ctx.reply("❌ Failed to initialize. Please try again.");
        }
    }

    /**
     * Handle /wallet command
     */
    private async handleWallet(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            // Get AR balance
            const arBalance = await aoWalletService.getWalletBalance(
                user.walletAddress
            );

            let message = `🔐 **Your AO Wallet**\n\n`;
            message += `📍 **Address:** \`${user.walletAddress}\`\n`;
            message += `💰 **AR Balance:** ${arBalance} AR\n\n`;
            message += `🔗 **Network:** AO Testnet\n`;
            message += `📅 **Created:** ${user.createdAt.toLocaleDateString()}\n`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(
                        "🔄 Refresh Balance",
                        "refresh_balance"
                    ),
                    Markup.button.callback("📋 Copy Address", "copy_address"),
                ],
                [
                    Markup.button.callback("💸 Send Tokens", "send"),
                    Markup.button.callback("📜 History", "history"),
                ],
            ]);

            await ctx.reply(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in wallet command:", error);
            await ctx.reply(
                "❌ Failed to fetch wallet information. Please try again."
            );
        }
    }

    /**
     * Handle /balance command
     */
    private async handleBalance(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            await ctx.reply("🔄 Checking balance...");

            // Get AR balance
            const arBalance = await aoWalletService.getWalletBalance(
                user.walletAddress
            );

            let message = `💰 **Balance Information**\n\n`;
            message += `🔸 **AR:** ${arBalance} AR\n`;
            message += `🔸 **Address:** \`${user.walletAddress}\`\n\n`;
            message += `💡 *To check token balances, use:*\n`;
            message += `/token_balance <token_process_id>`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("🔄 Refresh", "refresh_balance"),
                    Markup.button.callback("💸 Send", "send"),
                ],
            ]);

            await ctx.editMessageText(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in balance command:", error);
            await ctx.reply("❌ Failed to fetch balance. Please try again.");
        }
    }

    /**
     * Handle /send command
     */
    private async handleSend(ctx: BotContext): Promise<void> {
        try {
            let message = `💸 **Send Tokens**\n\n`;
            message += `To send tokens, use the following format:\n`;
            message += `\`/transfer <token_process_id> <recipient_address> <amount>\`\n\n`;
            message += `**Example:**\n`;
            message += `\`/transfer abc123... def456... 100\`\n\n`;
            message += `💡 **Tips:**\n`;
            message += `• Make sure you have sufficient balance\n`;
            message += `• Double-check the recipient address\n`;
            message += `• Transaction fees apply`;

            await ctx.reply(message, { parse_mode: "Markdown" });
        } catch (error) {
            logger.error("Error in send command:", error);
            await ctx.reply("❌ Failed to show send instructions.");
        }
    }

    /**
     * Handle /history command
     */
    private async handleHistory(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            await ctx.reply("📜 Loading transaction history...");

            const transactions = await userService.getUserTransactions(
                user.id,
                10
            );

            if (transactions.length === 0) {
                await ctx.editMessageText(
                    "📜 **Transaction History**\n\nNo transactions found."
                );
                return;
            }

            let message = `📜 **Recent Transactions**\n\n`;

            transactions.forEach((tx, index) => {
                const status = this.getStatusEmoji(tx.status);
                const date = tx.createdAt.toLocaleDateString();
                const amount = parseFloat(tx.amount).toFixed(6);

                message += `${index + 1}. ${status} **${tx.type}**\n`;
                message += `   💰 ${amount} ${tx.tokenSymbol || "tokens"}\n`;
                message += `   📅 ${date}\n`;
                message += `   🔗 \`${tx.txId.substring(0, 20)}...\`\n\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🔄 Refresh", "refresh_history")],
            ]);

            await ctx.editMessageText(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in history command:", error);
            await ctx.reply("❌ Failed to fetch transaction history.");
        }
    }

    /**
     * Handle /help command
     */
    private async handleHelp(ctx: BotContext): Promise<void> {
        try {
            let message = `❓ **AO Trading Bot Help**\n\n`;
            message += `**Available Commands:**\n\n`;

            this.commands.forEach((cmd) => {
                message += `/${cmd.command} - ${cmd.description}\n`;
            });

            message += `\n**Advanced Commands:**\n`;
            message += `/transfer <token_id> <recipient> <amount> - Send tokens\n`;
            message += `/token_balance <token_id> - Check token balance\n`;
            message += `/token_info <token_id> - Get token information\n\n`;

            message += `**Need Help?**\n`;
            message += `Contact support: @your_support_username`;

            await ctx.reply(message, { parse_mode: "Markdown" });
        } catch (error) {
            logger.error("Error in help command:", error);
            await ctx.reply("❌ Failed to show help information.");
        }
    }

    /**
     * Handle /settings command
     */
    private async handleSettings(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            let message = `⚙️ **Settings**\n\n`;
            message += `🔔 **Notifications:** ${
                user.notifications ? "✅ Enabled" : "❌ Disabled"
            }\n`;
            message += `🌐 **Language:** ${user.languageCode || "en"}\n`;
            message += `📱 **Account Type:** ${
                user.isPremium ? "⭐ Premium" : "🆓 Free"
            }\n\n`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(
                        user.notifications
                            ? "🔕 Disable Notifications"
                            : "🔔 Enable Notifications",
                        "toggle_notifications"
                    ),
                ],
                [Markup.button.callback("🗑️ Delete Account", "delete_account")],
            ]);

            await ctx.reply(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in settings command:", error);
            await ctx.reply("❌ Failed to show settings.");
        }
    }

    /**
     * Handle /stats command
     */
    private async handleStats(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            await ctx.reply("📊 Loading statistics...");

            const stats = await userService.getUserStats(user.id);

            let message = `📊 **Account Statistics**\n\n`;
            message += `📈 **Total Transactions:** ${stats.totalTransactions}\n`;
            message += `✅ **Confirmed:** ${stats.confirmedTransactions}\n`;
            message += `❌ **Failed:** ${stats.failedTransactions}\n`;
            message += `💼 **Wallets:** ${stats.totalWallets}\n`;
            message += `🎯 **Success Rate:** ${stats.successRate.toFixed(
                1
            )}%\n\n`;
            message += `📅 **Member Since:** ${user.createdAt.toLocaleDateString()}`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🔄 Refresh", "refresh_stats")],
            ]);

            await ctx.editMessageText(message, {
                parse_mode: "Markdown",
                ...keyboard,
            });
        } catch (error) {
            logger.error("Error in stats command:", error);
            await ctx.reply("❌ Failed to fetch statistics.");
        }
    }

    /**
     * Setup callback query handlers
     */
    private setupCallbackHandlers(): void {
        this.bot.action("balance", this.handleBalance.bind(this));
        this.bot.action("stats", this.handleStats.bind(this));
        this.bot.action("send", this.handleSend.bind(this));
        this.bot.action("history", this.handleHistory.bind(this));
        this.bot.action("settings", this.handleSettings.bind(this));
        this.bot.action("help", this.handleHelp.bind(this));

        this.bot.action("refresh_balance", this.handleBalance.bind(this));
        this.bot.action("refresh_history", this.handleHistory.bind(this));
        this.bot.action("refresh_stats", this.handleStats.bind(this));

        this.bot.action(
            "toggle_notifications",
            this.handleToggleNotifications.bind(this)
        );
        this.bot.action("delete_account", this.handleDeleteAccount.bind(this));
    }

    /**
     * Handle toggle notifications
     */
    private async handleToggleNotifications(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;
            const newNotificationState = !user.notifications;

            await userService.updateUser(user.id, {
                notifications: newNotificationState,
            });

            const message = newNotificationState
                ? "🔔 Notifications enabled!"
                : "🔕 Notifications disabled!";

            await ctx.answerCbQuery(message);
            await this.handleSettings(ctx);
        } catch (error) {
            logger.error("Error toggling notifications:", error);
            await ctx.answerCbQuery("❌ Failed to update settings");
        }
    }

    /**
     * Handle delete account
     */
    private async handleDeleteAccount(ctx: BotContext): Promise<void> {
        try {
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("⚠️ Yes, Delete", "confirm_delete"),
                    Markup.button.callback("❌ Cancel", "cancel_delete"),
                ],
            ]);

            await ctx.editMessageText(
                "⚠️ **Delete Account**\n\nAre you sure you want to delete your account? This action cannot be undone and you will lose access to your wallet.",
                {
                    parse_mode: "Markdown",
                    ...keyboard,
                }
            );
        } catch (error) {
            logger.error("Error in delete account:", error);
            await ctx.answerCbQuery("❌ Error occurred");
        }
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        this.bot.catch((err, ctx) => {
            logger.error("Bot error:", err);
            ctx.reply(
                "❌ An unexpected error occurred. Please try again later."
            );
        });

        // Handle unhandled promise rejections
        process.on("unhandledRejection", (reason, promise) => {
            logger.error("Unhandled Rejection at:", promise, "reason:", reason);
        });

        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            logger.error("Uncaught Exception:", error);
            process.exit(1);
        });
    }

    /**
     * Get status emoji for transaction status
     */
    private getStatusEmoji(status: string): string {
        switch (status) {
            case "CONFIRMED":
                return "✅";
            case "PENDING":
                return "⏳";
            case "FAILED":
                return "❌";
            case "CANCELLED":
                return "🚫";
            default:
                return "❓";
        }
    }

    /**
     * Start the bot
     */
    public async start(): Promise<void> {
        try {
            logger.info("Starting Telegram bot...");

            // Test bot token first (non-blocking)
            this.bot.telegram
                .getMe()
                .then((botInfo) => {
                    logger.info("Bot token validated", {
                        username: botInfo.username,
                        id: botInfo.id,
                    });
                })
                .catch((error) => {
                    logger.error("Invalid bot token:", error);
                });

            if (
                config.telegram.webhookUrl &&
                config.telegram.webhookUrl.trim() !== ""
            ) {
                // Use webhook in production
                await this.bot.telegram.setWebhook(config.telegram.webhookUrl);
                logger.info("Webhook set successfully", {
                    url: config.telegram.webhookUrl,
                });
            } else {
                // Use polling in development (non-blocking)
                this.bot
                    .launch()
                    .then(() => {
                        logger.info("Bot started with polling");
                    })
                    .catch((error) => {
                        logger.error("Failed to start bot polling:", error);
                    });
                logger.info("Bot launch initiated");
            }

            // Set bot commands for UI
            try {
                await this.bot.telegram.setMyCommands([
                    { command: "start", description: "Start using the bot" },
                    {
                        command: "wallet",
                        description: "View wallet information",
                    },
                    { command: "balance", description: "Check wallet balance" },
                    { command: "send", description: "Send tokens" },
                    { command: "history", description: "Transaction history" },
                    { command: "stats", description: "Account statistics" },
                    { command: "settings", description: "Bot settings" },
                    { command: "help", description: "Show help" },
                ]);
                logger.info("Bot commands set successfully");
            } catch (error) {
                logger.warn("Failed to set bot commands:", error);
            }

            logger.info("Telegram bot started successfully");
        } catch (error) {
            logger.error("Failed to start Telegram bot:", error);
            throw error;
        }
    }

    /**
     * Stop the bot
     */
    public async stop(): Promise<void> {
        try {
            logger.info("Stopping Telegram bot...");
            this.bot.stop();
            logger.info("Telegram bot stopped");
        } catch (error) {
            logger.error("Error stopping bot:", error);
        }
    }

    /**
     * Get bot instance for webhook handling
     */
    public getBot(): Telegraf<BotContext> {
        return this.bot;
    }

    /**
     * Handle webhook updates
     */
    public async handleWebhook(update: Update): Promise<void> {
        try {
            await this.bot.handleUpdate(update);
        } catch (error) {
            logger.error("Webhook handling error:", error);
        }
    }
}

// Export singleton instance
export const telegramBotService = new TelegramBotService();
export default TelegramBotService;
