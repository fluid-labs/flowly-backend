import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";

/**
 * CORS configuration
 */
export const corsOptions = {
    origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
    ) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // In development, allow all origins
        if (config.server.env === "development") {
            return callback(null, true);
        }

        // In production, you should specify allowed origins
        const allowedOrigins = [
            "https://your-frontend-domain.com",
            "https://api.telegram.org",
        ];

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn("CORS blocked request from origin:", origin);
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Origin",
        "X-Requested-With",
        "Content-Type",
        "Accept",
        "Authorization",
        "X-Telegram-Bot-Api-Secret-Token",
    ],
};

/**
 * Helmet security configuration
 */
export const helmetOptions = {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
                "'self'",
                "https://arweave.net",
                "https://*.ao-testnet.xyz",
            ],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false, // Disable for API compatibility
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
};

/**
 * Request logging middleware
 */
export const requestLoggingMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const start = Date.now();

    // Log request
    logger.info("Incoming request", {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        contentType: req.get("Content-Type"),
    });

    // Override res.end to log response
    const originalEnd = res.end.bind(res);
    res.end = function (chunk?: any, encoding?: any, cb?: any) {
        const duration = Date.now() - start;

        logger.info("Request completed", {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            contentLength: res.get("Content-Length"),
        });

        return originalEnd(chunk, encoding, cb);
    };

    next();
};

/**
 * Error handling middleware
 */
export const errorHandlingMiddleware = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    logger.error("Unhandled error:", {
        error: error.message,
        stack: error.stack,
        method: req.method,
        url: req.url,
        ip: req.ip,
    });

    // Don't leak error details in production
    const isDevelopment = config.server.env === "development";

    res.status(500).json({
        error: "Internal Server Error",
        message: isDevelopment ? error.message : "Something went wrong",
        ...(isDevelopment && { stack: error.stack }),
    });
};

/**
 * 404 handler middleware
 */
export const notFoundMiddleware = (req: Request, res: Response): void => {
    logger.warn("Route not found", {
        method: req.method,
        url: req.url,
        ip: req.ip,
    });

    res.status(404).json({
        error: "Not Found",
        message: "The requested resource was not found",
        path: req.url,
    });
};

/**
 * Request size limiting middleware
 */
export const requestSizeLimitMiddleware = (limit: string = "10mb") => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const contentLength = req.get("Content-Length");

        if (contentLength) {
            const sizeInBytes = parseInt(contentLength, 10);
            const limitInBytes = parseSize(limit);

            if (sizeInBytes > limitInBytes) {
                logger.warn("Request size limit exceeded", {
                    contentLength: sizeInBytes,
                    limit: limitInBytes,
                    ip: req.ip,
                    url: req.url,
                });

                res.status(413).json({
                    error: "Payload Too Large",
                    message: `Request size exceeds limit of ${limit}`,
                });
                return;
            }
        }

        next();
    };
};

/**
 * Parse size string to bytes
 */
function parseSize(size: string): number {
    const units: { [key: string]: number } = {
        b: 1,
        kb: 1024,
        mb: 1024 * 1024,
        gb: 1024 * 1024 * 1024,
    };

    const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);

    if (!match) {
        throw new Error(`Invalid size format: ${size}`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2] || "b";

    return Math.floor(value * units[unit]);
}

/**
 * IP whitelist middleware (for admin endpoints)
 */
export const ipWhitelistMiddleware = (allowedIPs: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const clientIP = req.ip || req.connection.remoteAddress;

        if (!clientIP || !allowedIPs.includes(clientIP)) {
            logger.warn("IP not whitelisted", {
                ip: clientIP,
                url: req.url,
                allowedIPs,
            });

            res.status(403).json({
                error: "Forbidden",
                message: "Access denied",
            });
            return;
        }

        next();
    };
};

/**
 * Request timeout middleware
 */
export const timeoutMiddleware = (timeout: number = 30000) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const timer = setTimeout(() => {
            if (!res.headersSent) {
                logger.warn("Request timeout", {
                    method: req.method,
                    url: req.url,
                    timeout,
                });

                res.status(408).json({
                    error: "Request Timeout",
                    message: "Request took too long to process",
                });
            }
        }, timeout);

        // Clear timeout when response is sent
        res.on("finish", () => {
            clearTimeout(timer);
        });

        next();
    };
};

export { helmet, cors };

export default {
    corsOptions,
    helmetOptions,
    requestLoggingMiddleware,
    errorHandlingMiddleware,
    notFoundMiddleware,
    requestSizeLimitMiddleware,
    ipWhitelistMiddleware,
    timeoutMiddleware,
};
