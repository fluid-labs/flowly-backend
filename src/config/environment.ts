import dotenv from "dotenv";
import Joi from "joi";

// Load environment variables
dotenv.config();

// Environment validation schema
const envSchema = Joi.object({
    // Server Configuration
    PORT: Joi.number().default(3000),
    NODE_ENV: Joi.string()
        .valid("development", "production", "test")
        .default("development"),

    // Telegram Bot Configuration
    TELEGRAM_BOT_TOKEN: Joi.string().required(),
    TELEGRAM_WEBHOOK_URL: Joi.string().uri().allow("").optional(),

    // Database Configuration
    DATABASE_URL: Joi.string().required(),

    // Encryption Configuration
    ENCRYPTION_KEY: Joi.string().length(32).required(),
    ENCRYPTION_IV_LENGTH: Joi.number().default(16),

    // AO Network Configuration
    AO_MU_URL: Joi.string().uri().default("https://mu.ao-testnet.xyz"),
    AO_CU_URL: Joi.string().uri().default("https://cu.ao-testnet.xyz"),
    AO_GATEWAY_URL: Joi.string().uri().default("https://arweave.net"),
    AO_SCHEDULER_ADDRESS: Joi.string().default(
        "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA"
    ),
    AO_AUTHORITY_ADDRESS: Joi.string().default(
        "fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY"
    ),

    // Security Configuration
    JWT_SECRET: Joi.string().min(32).required(),
    BCRYPT_ROUNDS: Joi.number().default(12),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),

    // Logging
    LOG_LEVEL: Joi.string()
        .valid("error", "warn", "info", "debug")
        .default("info"),
    LOG_FILE_PATH: Joi.string().default("./logs/app.log"),

    // Redis Configuration (Optional)
    REDIS_URL: Joi.string().allow("").optional(),

    // Webhook Security
    WEBHOOK_SECRET: Joi.string().allow("").optional(),

    // LangChain/OpenAI Configuration
    OPENAI_API_KEY: Joi.string().required(),
    LLM_MODEL: Joi.string().default("gpt-4o-mini"),
    LLM_TEMPERATURE: Joi.number().min(0).max(2).default(0.1),
}).unknown();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
    throw new Error(`Config validation error: ${error.message}`);
}

export interface Config {
    server: {
        port: number;
        env: string;
    };
    telegram: {
        botToken: string;
        webhookUrl?: string;
    };
    database: {
        url: string;
    };
    encryption: {
        key: string;
        ivLength: number;
    };
    ao: {
        muUrl: string;
        cuUrl: string;
        gatewayUrl: string;
        schedulerAddress: string;
        authorityAddress: string;
    };
    security: {
        jwtSecret: string;
        bcryptRounds: number;
    };
    rateLimit: {
        windowMs: number;
        maxRequests: number;
    };
    logging: {
        level: string;
        filePath: string;
    };
    redis?: {
        url: string;
    };
    webhook?: {
        secret: string;
    };
    llm: {
        openaiApiKey: string;
        model: string;
        temperature: number;
    };
}

export const config: Config = {
    server: {
        port: envVars.PORT,
        env: envVars.NODE_ENV,
    },
    telegram: {
        botToken: envVars.TELEGRAM_BOT_TOKEN,
        webhookUrl:
            envVars.TELEGRAM_WEBHOOK_URL &&
            envVars.TELEGRAM_WEBHOOK_URL.trim() !== ""
                ? envVars.TELEGRAM_WEBHOOK_URL
                : undefined,
    },
    database: {
        url: envVars.DATABASE_URL,
    },
    encryption: {
        key: envVars.ENCRYPTION_KEY,
        ivLength: envVars.ENCRYPTION_IV_LENGTH,
    },
    ao: {
        muUrl: envVars.AO_MU_URL,
        cuUrl: envVars.AO_CU_URL,
        gatewayUrl: envVars.AO_GATEWAY_URL,
        schedulerAddress: envVars.AO_SCHEDULER_ADDRESS,
        authorityAddress: envVars.AO_AUTHORITY_ADDRESS,
    },
    security: {
        jwtSecret: envVars.JWT_SECRET,
        bcryptRounds: envVars.BCRYPT_ROUNDS,
    },
    rateLimit: {
        windowMs: envVars.RATE_LIMIT_WINDOW_MS,
        maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
    },
    logging: {
        level: envVars.LOG_LEVEL,
        filePath: envVars.LOG_FILE_PATH,
    },
    llm: {
        openaiApiKey: envVars.OPENAI_API_KEY,
        model: envVars.LLM_MODEL,
        temperature: envVars.LLM_TEMPERATURE,
    },
};

// Add optional configurations
if (envVars.REDIS_URL && envVars.REDIS_URL.trim() !== "") {
    config.redis = { url: envVars.REDIS_URL };
}

if (envVars.WEBHOOK_SECRET && envVars.WEBHOOK_SECRET.trim() !== "") {
    config.webhook = { secret: envVars.WEBHOOK_SECRET };
}

export default config;
