import winston from "winston";
import path from "path";
import { config } from "@/config/environment";

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

// Define colors for each log level
const colors = {
    error: "red",
    warn: "yellow",
    info: "green",
    debug: "blue",
};

winston.addColors(colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} [${info.level}]: ${info.message}`
    )
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create transports array
const transports: winston.transport[] = [
    // Console transport
    new winston.transports.Console({
        format: consoleFormat,
    }),
];

// Add file transport if not in test environment
if (config.server.env !== "test") {
    // Ensure logs directory exists
    const logDir = path.dirname(config.logging.filePath);

    transports.push(
        // File transport for all logs
        new winston.transports.File({
            filename: config.logging.filePath,
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Separate file for error logs
        new winston.transports.File({
            filename: path.join(logDir, "error.log"),
            level: "error",
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    );
}

// Create logger instance
export const logger = winston.createLogger({
    level: config.logging.level,
    levels,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: "ao-telegram-bot" },
    transports,
    // Handle uncaught exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(
                path.dirname(config.logging.filePath),
                "exceptions.log"
            ),
        }),
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(
                path.dirname(config.logging.filePath),
                "rejections.log"
            ),
        }),
    ],
});

// Create a stream object for Morgan HTTP request logging
export const loggerStream = {
    write: (message: string) => {
        logger.info(message.trim());
    },
};

// Helper functions for structured logging
export const logError = (message: string, error?: any, meta?: any) => {
    logger.error(message, {
        error: error?.message || error,
        stack: error?.stack,
        ...meta,
    });
};

export const logInfo = (message: string, meta?: any) => {
    logger.info(message, meta);
};

export const logWarn = (message: string, meta?: any) => {
    logger.warn(message, meta);
};

export const logDebug = (message: string, meta?: any) => {
    logger.debug(message, meta);
};

// Performance logging helper
export const logPerformance = (
    operation: string,
    startTime: number,
    meta?: any
) => {
    const duration = Date.now() - startTime;
    logger.info(`Performance: ${operation}`, {
        duration: `${duration}ms`,
        ...meta,
    });
};

export default logger;
