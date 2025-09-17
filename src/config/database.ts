import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/logger";

class DatabaseService {
    private static instance: DatabaseService;
    private prisma: PrismaClient;

    private constructor() {
        this.prisma = new PrismaClient({
            log:
                process.env.NODE_ENV === "development"
                    ? ["query", "info", "warn", "error"]
                    : ["error"],
        });
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public getClient(): PrismaClient {
        return this.prisma;
    }

    public async connect(): Promise<void> {
        try {
            await this.prisma.$connect();
            logger.info("Database connected successfully");
        } catch (error) {
            logger.error("Failed to connect to database:", error);
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await this.prisma.$disconnect();
            logger.info("Database disconnected successfully");
        } catch (error) {
            logger.error("Failed to disconnect from database:", error);
            throw error;
        }
    }

    public async healthCheck(): Promise<boolean> {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return true;
        } catch (error) {
            logger.error("Database health check failed:", error);
            return false;
        }
    }
}

export const db = DatabaseService.getInstance().getClient();
export const dbService = DatabaseService.getInstance();
export default DatabaseService;
