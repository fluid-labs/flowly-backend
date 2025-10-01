import { Telegraf, Context, Markup } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";
import { userService } from "@/services/userService";
import { aoWalletService } from "@/services/aoWalletService";
import { encryptionService } from "@/utils/encryption";
import { LangChainService, ConversationMessage } from "./langchainService";

export interface BotContext extends Context {
    user?: any;
    session?: any;
    conversationMode?: boolean;
}

export interface CommandHandler {
    command: string;
    description: string;
    handler: (ctx: BotContext) => Promise<void>;
}

export class TelegramBotService {
    private bot: Telegraf<BotContext>;
    private commands: Map<string, CommandHandler> = new Map();
    private langChainService: LangChainService;
    private conversationHistory: Map<number, ConversationMessage[]> = new Map();

    constructor() {
        this.bot = new Telegraf<BotContext>(config.telegram.botToken);
        this.langChainService = new LangChainService();
        this.setupMiddleware();
        this.setupCommands();
        this.setupCallbackHandlers();
        this.setupMessageHandlers();
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
            } catch (error: any) {
                logger.error("Middleware error:", error);

                // Don't try to reply if user blocked the bot
                if (error.code !== 403) {
                    try {
                        await this.safeSendMessage(
                            ctx,
                            "An error occurred. Please try again later."
                        );
                    } catch (replyError) {
                        logger.error(
                            "Failed to send middleware error message:",
                            replyError
                        );
                    }
                }
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

        // Conversation command
        this.addCommand({
            command: "chat",
            description: "View AI conversation information",
            handler: this.handleStartConversation.bind(this),
        });

        // Stop conversation command
        this.addCommand({
            command: "stopchat",
            description: "Clear conversation history",
            handler: this.handleStopConversation.bind(this),
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
                message = `Welcome to Flowly, ${
                    user.firstName || "there"
                }!\n\n`;
                message += `Your secure wallet has been created!\n`;
                message += `Address: \`${user.walletAddress}\`\n\n`;
                message += `You can now:\n`;
                message += `• Check your balance\n`;
                message += `• Send and receive tokens\n`;
                message += `• View transaction history\n`;
                message += `• Trade on AO network\n\n`;
                message += `**Just send me any message to start trading!**\n`;
                message += `Example: "What's my balance?" or "Send 5 AO to abc123..."\n\n`;
            } else {
                message = `Welcome back, ${user.firstName || "there"}!\n\n`;
                message += `Your wallet: \`${user.walletAddress}\`\n\n`;
                message += `**Just send me any message to start trading!**\n`;
                message += `What would you like to do today?`;
            }

            await this.safeSendMessage(ctx, message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in start command:", error);
            await this.safeSendMessage(
                ctx,
                "Failed to initialize. Please try again."
            );
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

            let message = `**Your AO Wallet**\n\n`;
            message += `**Address:** \`${user.walletAddress}\`\n`;
            message += `**AR Balance:** ${arBalance} AR\n\n`;
            message += `**Network:** AO Testnet\n`;
            message += `**Created:** ${user.createdAt.toLocaleDateString()}\n`;

            await this.safeSendMessage(ctx, message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in wallet command:", error);
            await this.safeSendMessage(
                ctx,
                "Failed to fetch wallet information. Please try again."
            );
        }
    }

    /**
     * Handle /balance command
     */
    private async handleBalance(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            const loadingMessage = await this.safeSendMessage(
                ctx,
                "Checking balance..."
            );
            if (!loadingMessage) return; // User blocked bot

            // Get AR balance
            const arBalance = await aoWalletService.getWalletBalance(
                user.walletAddress
            );

            let message = `**Balance Information**\n\n`;
            message += `**AR:** ${arBalance} AR\n`;
            message += `**Address:** \`${user.walletAddress}\`\n\n`;
            message += `*To check token balances, use:*\n`;
            message += `/token_balance <token_process_id>`;

            await this.safeEditMessageText(ctx, message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in balance command:", error);
            await this.safeSendMessage(
                ctx,
                "Failed to fetch balance. Please try again."
            );
        }
    }

    /**
     * Handle /send command
     */
    private async handleSend(ctx: BotContext): Promise<void> {
        try {
            let message = `**Send Tokens**\n\n`;
            message += `To send tokens, use the following format:\n`;
            message += `\`/transfer <token_process_id> <recipient_address> <amount>\`\n\n`;
            message += `**Example:**\n`;
            message += `\`/transfer abc123... def456... 100\`\n\n`;
            message += `**Tips:**\n`;
            message += `• Make sure you have sufficient balance\n`;
            message += `• Double-check the recipient address\n`;
            message += `• Transaction fees apply`;

            await ctx.reply(message, { parse_mode: "Markdown" });
        } catch (error) {
            logger.error("Error in send command:", error);
            await ctx.reply("Failed to show send instructions.");
        }
    }

    /**
     * Handle /history command
     */
    private async handleHistory(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            const loadingMessage = await this.safeSendMessage(
                ctx,
                "Loading transaction history..."
            );
            if (!loadingMessage) return; // User blocked bot

            const transactions = await userService.getUserTransactions(
                user.id,
                10
            );

            if (transactions.length === 0) {
                await this.safeEditMessageText(
                    ctx,
                    "**Transaction History**\n\nNo transactions found."
                );
                return;
            }

            let message = `**Recent Transactions**\n\n`;

            transactions.forEach((tx, index) => {
                const status = this.getStatusText(tx.status);
                const date = tx.createdAt.toLocaleDateString();
                const amount = parseFloat(tx.amount).toFixed(6);

                message += `${index + 1}. ${status} **${tx.type}**\n`;
                message += `   ${amount} ${tx.tokenSymbol || "tokens"}\n`;
                message += `   ${date}\n`;
                message += `   \`${tx.txId.substring(0, 20)}...\`\n\n`;
            });

            await this.safeEditMessageText(ctx, message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in history command:", error);
            await this.safeSendMessage(
                ctx,
                "Failed to fetch transaction history."
            );
        }
    }

    /**
     * Handle /help command
     */
    private async handleHelp(ctx: BotContext): Promise<void> {
        try {
            let message = `**AO Trading Bot Help**\n\n`;
            message += `**Available Commands:**\n\n`;

            this.commands.forEach((cmd) => {
                message += `/${cmd.command} - ${cmd.description}\n`;
            });

            message += `\n**AI Conversation:**\n`;
            message += `Send any message to interact with AI for DeFi transactions\n`;
            message += `/chat - View conversation mode info\n`;
            message += `/stopchat - Clear conversation history\n\n`;

            message += `**Advanced Commands:**\n`;
            message += `/transfer <token_id> <recipient> <amount> - Send tokens\n`;
            message += `/token_balance <token_id> - Check token balance\n`;
            message += `/token_info <token_id> - Get token information\n\n`;

            message += `**Need Help?**\n`;
            message += `Contact support: @your_support_username`;

            await ctx.reply(message, { parse_mode: "Markdown" });
        } catch (error) {
            logger.error("Error in help command:", error);
            await ctx.reply("Failed to show help information.");
        }
    }

    /**
     * Handle /settings command
     */
    private async handleSettings(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            let message = `**Settings**\n\n`;
            message += `**Notifications:** ${
                user.notifications ? "Enabled" : "Disabled"
            }\n`;
            message += `**Language:** ${user.languageCode || "en"}\n`;
            message += `**Account Type:** ${
                user.isPremium ? "Premium" : "Free"
            }\n\n`;

            await ctx.reply(message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in settings command:", error);
            await ctx.reply("Failed to show settings.");
        }
    }

    /**
     * Handle /chat command - Show conversation info
     */
    private async handleStartConversation(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            let message = `**AI Conversation Mode**\n\n`;
            message += `**Always Active** - Just send me any message!\n\n`;
            message += `I can help you with:\n\n`;
            message += `**Token Transfers** - "Send 10 AO to abc123..."\n`;
            message += `**Balance Checks** - "What's my balance?"\n`;
            message += `**Account Info** - "Show my wallet details"\n`;
            message += `**General Help** - Ask me anything about AO tokens\n\n`;
            message += `**Example:** "Send 5 AO tokens to def456..."\n\n`;
            message += `Type /stopchat to clear conversation history.`;

            await ctx.reply(message, {
                parse_mode: "Markdown",
            });

            logger.info("Conversation info shown", { telegramId });
        } catch (error) {
            logger.error("Error showing conversation info:", error);
            await ctx.reply("Failed to show conversation information.");
        }
    }

    /**
     * Handle /stopchat command - Clear conversation history
     */
    private async handleStopConversation(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            // Clear conversation history
            this.conversationHistory.delete(telegramId);

            await ctx.reply(
                "**Conversation history cleared.**\n\nYou can continue chatting with me - just send any message!",
                { parse_mode: "Markdown" }
            );

            logger.info("Conversation history cleared", { telegramId });
        } catch (error) {
            logger.error("Error clearing conversation history:", error);
            await ctx.reply("Failed to clear conversation history.");
        }
    }

    /**
     * Handle /stats command
     */
    private async handleStats(ctx: BotContext): Promise<void> {
        try {
            const user = ctx.user;

            const loadingMessage = await this.safeSendMessage(
                ctx,
                "Loading statistics..."
            );
            if (!loadingMessage) return; // User blocked bot

            const stats = await userService.getUserStats(user.id);

            let message = `**Account Statistics**\n\n`;
            message += `**Total Transactions:** ${stats.totalTransactions}\n`;
            message += `**Confirmed:** ${stats.confirmedTransactions}\n`;
            message += `**Failed:** ${stats.failedTransactions}\n`;
            message += `**Wallets:** ${stats.totalWallets}\n`;
            message += `**Success Rate:** ${stats.successRate.toFixed(1)}%\n\n`;
            message += `**Member Since:** ${user.createdAt.toLocaleDateString()}`;

            await this.safeEditMessageText(ctx, message, {
                parse_mode: "Markdown",
            });
        } catch (error) {
            logger.error("Error in stats command:", error);
            await this.safeSendMessage(ctx, "Failed to fetch statistics.");
        }
    }

    /**
     * Setup message handlers for all non-command messages
     */
    private setupMessageHandlers(): void {
        // Handle all text messages as conversation messages (except commands)
        this.bot.on("text", async (ctx) => {
            try {
                const telegramId = ctx.from?.id;
                if (!telegramId) return;

                // Skip if it's a command
                if ((ctx.message as any).text?.startsWith("/")) return;

                // Process all non-command messages through LangChain
                await this.handleConversationMessage(ctx);
            } catch (error) {
                logger.error("Error handling text message:", error);
                await ctx.reply(
                    "Error processing your message. Please try again."
                );
            }
        });
    }

    /**
     * Handle conversation messages
     */
    private async handleConversationMessage(ctx: BotContext): Promise<void> {
        const telegramId = ctx.from?.id;
        const userMessage = (ctx.message as any)?.text;

        if (!telegramId || !userMessage) return;

        // Send "Thinking..." message immediately
        const thinkingMessage = await this.safeSendMessage(ctx, "Thinking...");
        if (!thinkingMessage) return; // User blocked bot

        try {
            // Show typing indicator
            await ctx.sendChatAction("typing");

            // Get or initialize conversation history
            const history = this.conversationHistory.get(telegramId) || [];

            // Add user message to history
            const userMsg: ConversationMessage = {
                role: "user",
                content: userMessage,
                timestamp: new Date(),
            };
            history.push(userMsg);

            // Process with LangChain
            const aiResponse = await this.langChainService.processMessage(
                telegramId,
                userMessage,
                history.slice(-10) // Keep last 10 messages for context
            );

            // Add AI response to history
            const aiMsg: ConversationMessage = {
                role: "assistant",
                content: aiResponse,
                timestamp: new Date(),
            };
            history.push(aiMsg);

            // Update conversation history (keep last 20 messages)
            this.conversationHistory.set(telegramId, history.slice(-20));

            // Replace "Thinking..." message with the final response
            const edited = await this.safeEditMessage(
                ctx,
                thinkingMessage,
                aiResponse,
                {
                    parse_mode: "Markdown",
                }
            );
            if (!edited) {
                // If editing failed, send a new message as fallback
                await this.safeSendMessage(ctx, aiResponse, {
                    parse_mode: "Markdown",
                });
            }

            logger.info("Conversation message processed", {
                telegramId,
                userMessageLength: userMessage.length,
                aiResponseLength: aiResponse.length,
            });
        } catch (error) {
            logger.error("Error in conversation message:", error);
            // Try to edit the thinking message with error, or send new message if edit fails
            const errorMessage =
                "I encountered an error processing your message. Please try again.";
            const errorEdited = await this.safeEditMessage(
                ctx,
                thinkingMessage,
                errorMessage
            );
            if (!errorEdited) {
                await this.safeSendMessage(ctx, errorMessage);
            }
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

        // Conversation mode callbacks
        this.bot.action("start_chat", this.handleStartConversation.bind(this));
        this.bot.action("stop_chat", this.handleStopConversation.bind(this));

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
                ? "Notifications enabled!"
                : "Notifications disabled!";

            await ctx.answerCbQuery(message);
            await this.handleSettings(ctx);
        } catch (error) {
            logger.error("Error toggling notifications:", error);
            await ctx.answerCbQuery("Failed to update settings");
        }
    }

    /**
     * Handle delete account
     */
    private async handleDeleteAccount(ctx: BotContext): Promise<void> {
        try {
            await ctx.editMessageText(
                "**Delete Account**\n\nAre you sure you want to delete your account? This action cannot be undone and you will lose access to your wallet.",
                {
                    parse_mode: "Markdown",
                }
            );
        } catch (error) {
            logger.error("Error in delete account:", error);
            await ctx.answerCbQuery("Error occurred");
        }
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        this.bot.catch((err: any, ctx) => {
            // Handle specific Telegram API errors
            if (err.code === 403) {
                // User blocked the bot - log but don't crash
                logger.warn("User blocked the bot", {
                    telegramId: ctx.from?.id,
                    error: err.description,
                });
                return;
            }

            if (
                err.code === 400 &&
                err.description?.includes("chat not found")
            ) {
                // Chat not found - user deleted chat
                logger.warn("Chat not found", {
                    telegramId: ctx.from?.id,
                    error: err.description,
                });
                return;
            }

            if (err.code === 429) {
                // Rate limited - log and continue
                logger.warn("Rate limited by Telegram", {
                    telegramId: ctx.from?.id,
                    error: err.description,
                });
                return;
            }

            logger.error("Bot error:", err);

            // Only try to reply if the error isn't related to blocked user
            if (err.code !== 403) {
                try {
                    ctx.reply(
                        "An unexpected error occurred. Please try again later."
                    );
                } catch (replyError) {
                    logger.error("Failed to send error message:", replyError);
                }
            }
        });

        // Handle unhandled promise rejections
        process.on("unhandledRejection", (reason: any, promise) => {
            // Check if it's a Telegram API error for blocked user
            if (
                reason?.code === 403 &&
                reason?.description?.includes("bot was blocked")
            ) {
                logger.warn("Unhandled rejection: User blocked bot", {
                    error: reason.description,
                });
                return;
            }

            if (
                reason?.code === 400 &&
                reason?.description?.includes("chat not found")
            ) {
                logger.warn("Unhandled rejection: Chat not found", {
                    error: reason.description,
                });
                return;
            }

            logger.error("Unhandled Rejection at:", promise, "reason:", reason);
        });

        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            logger.error("Uncaught Exception:", error);
            process.exit(1);
        });
    }

    /**
     * Get status text for transaction status
     */
    private getStatusText(status: string): string {
        switch (status) {
            case "CONFIRMED":
                return "CONFIRMED";
            case "PENDING":
                return "PENDING";
            case "FAILED":
                return "FAILED";
            case "CANCELLED":
                return "CANCELLED";
            default:
                return "UNKNOWN";
        }
    }

    /**
     * Safely send a message, handling blocked users
     */
    private async safeSendMessage(
        ctx: BotContext,
        message: string,
        options?: any
    ): Promise<any | null> {
        try {
            const sentMessage = await ctx.reply(message, options);
            return sentMessage;
        } catch (error: any) {
            if (error.code === 403) {
                logger.warn("Cannot send message - user blocked bot", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return null;
            }

            if (
                error.code === 400 &&
                error.description?.includes("chat not found")
            ) {
                logger.warn("Cannot send message - chat not found", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return null;
            }

            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Safely edit a specific message, handling blocked users and other common errors
     */
    private async safeEditMessage(
        ctx: BotContext,
        messageToEdit: any,
        newText: string,
        options?: any
    ): Promise<boolean> {
        try {
            await ctx.telegram.editMessageText(
                ctx.chat?.id,
                messageToEdit.message_id,
                undefined,
                newText,
                options
            );
            return true;
        } catch (error: any) {
            if (error.code === 403) {
                logger.warn("Cannot edit message - user blocked bot", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            if (
                error.code === 400 &&
                error.description?.includes("chat not found")
            ) {
                logger.warn("Cannot edit message - chat not found", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            if (
                error.code === 400 &&
                (error.description?.includes("message is not modified") ||
                    error.description?.includes("message to edit not found") ||
                    error.description?.includes("message can't be edited"))
            ) {
                logger.warn("Cannot edit message - message edit failed", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            // Log the error for debugging
            logger.error("Error editing message", {
                telegramId: ctx.from?.id,
                error: error.description,
                code: error.code,
            });

            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Safely edit a message using context (for backward compatibility)
     */
    private async safeEditMessageText(
        ctx: BotContext,
        message: string,
        options?: any
    ): Promise<boolean> {
        try {
            await ctx.editMessageText(message, options);
            return true;
        } catch (error: any) {
            if (error.code === 403) {
                logger.warn("Cannot edit message - user blocked bot", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            if (
                error.code === 400 &&
                error.description?.includes("chat not found")
            ) {
                logger.warn("Cannot edit message - chat not found", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            if (
                error.code === 400 &&
                (error.description?.includes("message is not modified") ||
                    error.description?.includes("message to edit not found") ||
                    error.description?.includes("message can't be edited"))
            ) {
                logger.warn("Cannot edit message - message edit failed", {
                    telegramId: ctx.from?.id,
                    error: error.description,
                });
                return false;
            }

            // Re-throw other errors
            throw error;
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
                    { command: "chat", description: "Start AI conversation" },
                    {
                        command: "stopchat",
                        description: "Stop AI conversation",
                    },
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
