import { Request, Response, NextFunction } from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";

// Create rate limiter instance
const rateLimiter = new RateLimiterMemory({
    points: config.rateLimit.maxRequests, // Number of requests
    duration: Math.floor(config.rateLimit.windowMs / 1000), // Per duration in seconds
});

// Webhook-specific rate limiter (more restrictive)
const webhookRateLimiter = new RateLimiterMemory({
    points: 30, // 30 requests
    duration: 60, // per minute
});

// API rate limiter (less restrictive for authenticated users)
const apiRateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per minute
});

/**
 * General rate limiting middleware
 */
export const rateLimitMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        await rateLimiter.consume(req.ip || "unknown");
        next();
    } catch (rejRes: any) {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;

        logger.warn("Rate limit exceeded", {
            ip: req.ip,
            path: req.path,
            method: req.method,
            retryAfter: secs,
        });

        res.set("Retry-After", String(secs));
        res.status(429).json({
            error: "Too Many Requests",
            message: "Rate limit exceeded. Please try again later.",
            retryAfter: secs,
        });
    }
};

/**
 * Webhook-specific rate limiting middleware
 */
export const webhookRateLimitMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        await webhookRateLimiter.consume(req.ip || "unknown");
        next();
    } catch (rejRes: any) {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;

        logger.warn("Webhook rate limit exceeded", {
            ip: req.ip,
            path: req.path,
            retryAfter: secs,
        });

        res.set("Retry-After", String(secs));
        res.status(429).json({
            error: "Too Many Requests",
            retryAfter: secs,
        });
    }
};

/**
 * API-specific rate limiting middleware
 */
export const apiRateLimitMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        await apiRateLimiter.consume(req.ip || "unknown");
        next();
    } catch (rejRes: any) {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;

        logger.warn("API rate limit exceeded", {
            ip: req.ip,
            path: req.path,
            method: req.method,
            retryAfter: secs,
        });

        res.set("Retry-After", String(secs));
        res.status(429).json({
            error: "Too Many Requests",
            message: "API rate limit exceeded. Please try again later.",
            retryAfter: secs,
        });
    }
};

/**
 * Create custom rate limiter
 */
export const createRateLimiter = (points: number, duration: number) => {
    const limiter = new RateLimiterMemory({
        points,
        duration,
    });

    return async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            await limiter.consume(req.ip || "unknown");
            next();
        } catch (rejRes: any) {
            const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;

            logger.warn("Custom rate limit exceeded", {
                ip: req.ip,
                path: req.path,
                points,
                duration,
                retryAfter: secs,
            });

            res.set("Retry-After", String(secs));
            res.status(429).json({
                error: "Too Many Requests",
                retryAfter: secs,
            });
        }
    };
};

export default rateLimitMiddleware;
