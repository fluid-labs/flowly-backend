import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { logger } from "@/utils/logger";

/**
 * Validation middleware factory
 * @param schema - Joi validation schema
 * @param property - Request property to validate ('body', 'query', 'params')
 */
export const validateRequest = (
    schema: Joi.ObjectSchema,
    property: "body" | "query" | "params" = "body"
) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const { error, value } = schema.validate(req[property], {
                abortEarly: false, // Return all validation errors
                stripUnknown: true, // Remove unknown properties
                convert: true, // Convert types when possible
            });

            if (error) {
                const validationErrors = error.details.map((detail) => ({
                    field: detail.path.join("."),
                    message: detail.message,
                    value: detail.context?.value,
                }));

                logger.warn("Validation failed", {
                    path: req.path,
                    method: req.method,
                    property,
                    errors: validationErrors,
                });

                res.status(400).json({
                    error: "Validation Error",
                    message: "Request validation failed",
                    details: validationErrors,
                });
                return;
            }

            // Replace the request property with the validated and sanitized value
            req[property] = value;
            next();
        } catch (validationError) {
            logger.error("Validation middleware error:", validationError);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Validation processing failed",
            });
        }
    };
};

/**
 * Validate body middleware
 */
export const validateBody = (schema: Joi.ObjectSchema) => {
    return validateRequest(schema, "body");
};

/**
 * Validate query parameters middleware
 */
export const validateQuery = (schema: Joi.ObjectSchema) => {
    return validateRequest(schema, "query");
};

/**
 * Validate URL parameters middleware
 */
export const validateParams = (schema: Joi.ObjectSchema) => {
    return validateRequest(schema, "params");
};

// Common validation schemas
export const commonSchemas = {
    // Telegram ID validation
    telegramId: Joi.string().pattern(/^\d+$/).required().messages({
        "string.pattern.base": "Telegram ID must be a numeric string",
        "any.required": "Telegram ID is required",
    }),

    // Arweave address validation
    arweaveAddress: Joi.string()
        .length(43)
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .messages({
            "string.length": "Arweave address must be exactly 43 characters",
            "string.pattern.base":
                "Arweave address contains invalid characters",
        }),

    // Process ID validation (same as Arweave address)
    processId: Joi.string()
        .length(43)
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .messages({
            "string.length": "Process ID must be exactly 43 characters",
            "string.pattern.base": "Process ID contains invalid characters",
        }),

    // Token quantity validation
    quantity: Joi.string()
        .pattern(/^\d+(\.\d+)?$/)
        .messages({
            "string.pattern.base": "Quantity must be a valid number string",
        }),

    // Pagination validation
    pagination: Joi.object({
        limit: Joi.number().integer().min(1).max(100).default(50),
        offset: Joi.number().integer().min(0).default(0),
    }),

    // Tag validation for AO messages
    tag: Joi.object({
        name: Joi.string().min(1).max(100).required(),
        value: Joi.string().max(1000).required(),
    }),

    // Wallet type validation
    walletType: Joi.string()
        .valid("MAIN", "TRADING", "SAVINGS", "STAKING")
        .default("TRADING"),
};

// Specific validation schemas for endpoints
export const validationSchemas = {
    // User parameter validation
    userParams: Joi.object({
        telegramId: commonSchemas.telegramId,
    }),

    // Token parameter validation
    tokenParams: Joi.object({
        telegramId: commonSchemas.telegramId,
        tokenProcessId: commonSchemas.processId,
    }),

    // Send tokens validation
    sendTokens: Joi.object({
        processId: commonSchemas.processId.required(),
        recipient: commonSchemas.arweaveAddress.required(),
        quantity: commonSchemas.quantity.required(),
        tags: Joi.array().items(commonSchemas.tag).optional(),
    }),

    // Create wallet validation
    createWallet: Joi.object({
        name: Joi.string().min(1).max(100).optional(),
        description: Joi.string().max(500).optional(),
        walletType: commonSchemas.walletType,
    }),

    // Transaction query validation
    transactionQuery: Joi.object({
        limit: Joi.number().integer().min(1).max(100).default(50),
        offset: Joi.number().integer().min(0).default(0),
        status: Joi.string()
            .valid("PENDING", "CONFIRMED", "FAILED", "CANCELLED")
            .optional(),
        type: Joi.string()
            .valid(
                "SEND",
                "RECEIVE",
                "SWAP",
                "STAKE",
                "UNSTAKE",
                "MINT",
                "BURN",
                "APPROVE"
            )
            .optional(),
    }),

    // Webhook setup validation
    webhookSetup: Joi.object({
        url: Joi.string().uri().required(),
        secret: Joi.string().min(1).max(256).optional(),
    }),
};

/**
 * Sanitize input to prevent XSS and injection attacks
 */
export const sanitizeInput = (input: any): any => {
    if (typeof input === "string") {
        // Remove potentially dangerous characters
        return input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<[^>]*>/g, "")
            .trim();
    }

    if (Array.isArray(input)) {
        return input.map(sanitizeInput);
    }

    if (typeof input === "object" && input !== null) {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(input)) {
            sanitized[key] = sanitizeInput(value);
        }
        return sanitized;
    }

    return input;
};

/**
 * Sanitization middleware
 */
export const sanitizeMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    try {
        if (req.body) {
            req.body = sanitizeInput(req.body);
        }

        if (req.query) {
            req.query = sanitizeInput(req.query);
        }

        if (req.params) {
            req.params = sanitizeInput(req.params);
        }

        next();
    } catch (error) {
        logger.error("Sanitization middleware error:", error);
        res.status(500).json({
            error: "Internal Server Error",
            message: "Input sanitization failed",
        });
    }
};

export default validateRequest;
