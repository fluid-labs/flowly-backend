import "module-alias/register";
import { App } from "./app";
import { logger } from "@/utils/logger";

/**
 * Main entry point for the AO Telegram Trading Bot
 */
async function main(): Promise<void> {
    try {
        // Create and start the application
        const app = new App();
        await app.start();
    } catch (error) {
        logger.error("Failed to start application:", error);
        process.exit(1);
    }
}

// Start the application
main().catch((error) => {
    logger.error("Unhandled error in main:", error);
    process.exit(1);
});

export default main;
