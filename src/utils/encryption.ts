import crypto from "crypto";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";

export class EncryptionService {
    private readonly algorithm = "aes-256-cbc";
    private readonly key: Buffer;
    private readonly ivLength: number;

    constructor() {
        this.key = Buffer.from(config.encryption.key, "utf8");
        this.ivLength = config.encryption.ivLength;

        if (this.key.length !== 32) {
            throw new Error(
                "Encryption key must be exactly 32 characters long"
            );
        }
    }

    /**
     * Encrypt a string using AES-256-CBC
     * @param text - The text to encrypt
     * @returns Encrypted string in format: iv:encryptedData
     */
    public encrypt(text: string): string {
        try {
            // Generate a random initialization vector
            const iv = crypto.randomBytes(this.ivLength);

            // Create cipher
            const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

            // Encrypt the text
            let encrypted = cipher.update(text, "utf8", "hex");
            encrypted += cipher.final("hex");

            // Combine IV and encrypted data
            const result = `${iv.toString("hex")}:${encrypted}`;

            logger.debug("Text encrypted successfully");
            return result;
        } catch (error) {
            logger.error("Encryption failed:", error);
            throw new Error("Failed to encrypt data");
        }
    }

    /**
     * Decrypt a string using AES-256-CBC
     * @param encryptedData - The encrypted string in format: iv:encryptedData
     * @returns Decrypted string
     */
    public decrypt(encryptedData: string): string {
        try {
            // Split IV and encrypted data
            const parts = encryptedData.split(":");
            if (parts.length !== 2) {
                throw new Error("Invalid encrypted data format");
            }

            const iv = Buffer.from(parts[0], "hex");
            const encrypted = parts[1];

            // Create decipher
            const decipher = crypto.createDecipheriv(
                this.algorithm,
                this.key,
                iv
            );

            // Decrypt the data
            let decrypted = decipher.update(encrypted, "hex", "utf8");
            decrypted += decipher.final("utf8");

            logger.debug("Text decrypted successfully");
            return decrypted;
        } catch (error) {
            logger.error("Decryption failed:", error);
            throw new Error("Failed to decrypt data");
        }
    }

    /**
     * Generate a secure random string
     * @param length - Length of the random string
     * @returns Random hex string
     */
    public generateRandomString(length: number = 32): string {
        return crypto.randomBytes(length).toString("hex");
    }

    /**
     * Hash a password using bcrypt-like approach with crypto
     * @param password - Password to hash
     * @param salt - Optional salt (will generate if not provided)
     * @returns Hashed password with salt
     */
    public hashPassword(password: string, salt?: string): string {
        try {
            const actualSalt = salt || crypto.randomBytes(16).toString("hex");
            const hash = crypto.pbkdf2Sync(
                password,
                actualSalt,
                10000,
                64,
                "sha512"
            );
            return `${actualSalt}:${hash.toString("hex")}`;
        } catch (error) {
            logger.error("Password hashing failed:", error);
            throw new Error("Failed to hash password");
        }
    }

    /**
     * Verify a password against its hash
     * @param password - Password to verify
     * @param hashedPassword - Hashed password with salt
     * @returns True if password matches
     */
    public verifyPassword(password: string, hashedPassword: string): boolean {
        try {
            const parts = hashedPassword.split(":");
            if (parts.length !== 2) {
                return false;
            }

            const salt = parts[0];
            const hash = parts[1];
            const verifyHash = crypto.pbkdf2Sync(
                password,
                salt,
                10000,
                64,
                "sha512"
            );

            return hash === verifyHash.toString("hex");
        } catch (error) {
            logger.error("Password verification failed:", error);
            return false;
        }
    }

    /**
     * Generate a cryptographically secure random key
     * @param length - Length in bytes (default: 32 for AES-256)
     * @returns Random key as hex string
     */
    public generateKey(length: number = 32): string {
        return crypto.randomBytes(length).toString("hex");
    }

    /**
     * Create HMAC signature
     * @param data - Data to sign
     * @param secret - Secret key for signing
     * @returns HMAC signature
     */
    public createHMAC(data: string, secret: string): string {
        return crypto.createHmac("sha256", secret).update(data).digest("hex");
    }

    /**
     * Verify HMAC signature
     * @param data - Original data
     * @param signature - HMAC signature to verify
     * @param secret - Secret key used for signing
     * @returns True if signature is valid
     */
    public verifyHMAC(
        data: string,
        signature: string,
        secret: string
    ): boolean {
        const expectedSignature = this.createHMAC(data, secret);
        return crypto.timingSafeEqual(
            Buffer.from(signature, "hex"),
            Buffer.from(expectedSignature, "hex")
        );
    }
}

// Export singleton instance
export const encryptionService = new EncryptionService();
export default EncryptionService;
