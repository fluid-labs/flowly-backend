import { Context } from "telegraf";

export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

export interface BotCommand {
    command: string;
    description: string;
    handler: (ctx: BotContext) => Promise<void>;
    adminOnly?: boolean;
    rateLimited?: boolean;
}

export interface BotContext extends Context {
    user?: any;
    session?: any;
}

export interface InlineKeyboardButton {
    text: string;
    callback_data?: string;
    url?: string;
    switch_inline_query?: string;
}

export interface BotMessage {
    text: string;
    parse_mode?: "Markdown" | "HTML";
    reply_markup?: {
        inline_keyboard?: InlineKeyboardButton[][];
        keyboard?: string[][];
        resize_keyboard?: boolean;
        one_time_keyboard?: boolean;
    };
}

export interface WebhookInfo {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    allowed_updates?: string[];
}

export interface BotStats {
    totalUsers: number;
    activeUsers: number;
    totalMessages: number;
    commandsProcessed: number;
    errorsCount: number;
    uptime: number;
}
