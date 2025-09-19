import {
    connect,
    createDataItemSigner,
    message,
    spawn,
    result,
    results,
} from "@permaweb/aoconnect";
import Arweave from "arweave";
import { config } from "@/config/environment";
import { logger } from "@/utils/logger";
import { encryptionService } from "@/utils/encryption";

export interface AOWallet {
    privateKey: string;
    address: string;
    keyfile: any;
}

export interface AOMessage {
    process: string;
    tags?: Array<{ name: string; value: string }>;
    data?: string;
    anchor?: string;
}

export interface AOSpawnParams {
    module: string;
    scheduler?: string;
    tags?: Array<{ name: string; value: string }>;
    data?: any;
}

export interface TokenBalance {
    balance: string;
    ticker?: string;
    processId: string;
}

export interface TransferParams {
    processId: string;
    recipient: string;
    quantity: string;
    tags?: Array<{ name: string; value: string }>;
}

export class AOWalletService {
    private arweave: Arweave;
    private aoConnect: any;

    constructor() {
        // Initialize Arweave client
        this.arweave = Arweave.init({
            host: "arweave.net",
            port: 443,
            protocol: "https",
        });

        // Initialize AO Connect with custom configuration
        this.aoConnect = (connect as any)({
            MODE: "legacy",
            MU_URL: config.ao.muUrl,
            CU_URL: config.ao.cuUrl,
            GATEWAY_URL: config.ao.gatewayUrl,
        });

        logger.info("AOWalletService initialized", {
            muUrl: config.ao.muUrl,
            cuUrl: config.ao.cuUrl,
            gatewayUrl: config.ao.gatewayUrl,
        });
    }

    /**
     * Generate a new Arweave wallet
     * @returns Promise<AOWallet> - New wallet with private key and address
     */
    public async generateWallet(): Promise<AOWallet> {
        try {
            logger.info("Generating new Arweave wallet");

            // Generate new wallet keyfile
            const keyfile = await this.arweave.wallets.generate();

            // Get wallet address
            const address = await this.arweave.wallets.jwkToAddress(keyfile);

            // Convert keyfile to string for storage
            const privateKey = JSON.stringify(keyfile);

            logger.info("Wallet generated successfully", { address });

            return {
                privateKey,
                address,
                keyfile,
            };
        } catch (error) {
            logger.error("Failed to generate wallet:", error);
            throw new Error("Failed to generate wallet");
        }
    }

    /**
     * Load wallet from encrypted private key
     * @param encryptedPrivateKey - Encrypted private key string
     * @returns Promise<AOWallet> - Loaded wallet
     */
    public async loadWallet(encryptedPrivateKey: string): Promise<AOWallet> {
        try {
            // Decrypt private key
            const privateKey = encryptionService.decrypt(encryptedPrivateKey);

            // Parse keyfile
            const keyfile = JSON.parse(privateKey);

            // Get wallet address
            const address = await this.arweave.wallets.jwkToAddress(keyfile);

            return {
                privateKey,
                address,
                keyfile,
            };
        } catch (error) {
            logger.error("Failed to load wallet:", error);
            throw new Error("Failed to load wallet");
        }
    }

    /**
     * Get wallet balance (AR tokens)
     * @param address - Wallet address
     * @returns Promise<string> - Balance in AR
     */
    public async getWalletBalance(address: string): Promise<string> {
        try {
            const winstonBalance = await this.arweave.wallets.getBalance(
                address
            );
            const arBalance = this.arweave.ar.winstonToAr(winstonBalance);

            logger.debug("Retrieved wallet balance", {
                address,
                balance: arBalance,
            });
            return arBalance;
        } catch (error) {
            logger.error("Failed to get wallet balance:", error);
            throw new Error("Failed to get wallet balance");
        }
    }

    /**
     * Send a message to an AO process
     * @param wallet - Wallet to send from
     * @param messageParams - Message parameters
     * @returns Promise<string> - Message ID
     */
    public async sendMessage(
        wallet: AOWallet,
        messageParams: AOMessage
    ): Promise<string> {
        try {
            logger.info("Sending AO message", {
                process: messageParams.process,
                tags: messageParams.tags?.length || 0,
            });

            // Create data item signer
            const signer = createDataItemSigner(wallet.keyfile);

            // Send message using aoconnect
            const messageResult = await this.aoConnect.message({
                process: messageParams.process,
                tags: messageParams.tags || [],
                signer,
                data: messageParams.data || "",
                anchor: messageParams.anchor,
            });

            logger.info("AO message sent successfully", {
                messageId: messageResult,
            });
            return messageResult;
        } catch (error) {
            logger.error("Failed to send AO message:", error);
            throw new Error("Failed to send AO message");
        }
    }

    /**
     * Spawn a new AO process
     * @param wallet - Wallet to spawn from
     * @param spawnParams - Spawn parameters
     * @returns Promise<string> - Process ID
     */
    public async spawnProcess(
        wallet: AOWallet,
        spawnParams: AOSpawnParams
    ): Promise<string> {
        try {
            logger.info("Spawning new AO process", {
                module: spawnParams.module,
            });

            // Create data item signer
            const signer = createDataItemSigner(wallet.keyfile);

            // Default tags for process spawning
            const defaultTags = [
                { name: "Authority", value: config.ao.authorityAddress },
            ];

            // Combine default tags with custom tags
            const allTags = [...defaultTags, ...(spawnParams.tags || [])];

            // Spawn process using aoconnect
            const processId = await this.aoConnect.spawn({
                module: spawnParams.module,
                scheduler: spawnParams.scheduler || config.ao.schedulerAddress,
                signer,
                tags: allTags,
                data: spawnParams.data,
            });

            logger.info("AO process spawned successfully", { processId });
            return processId;
        } catch (error) {
            logger.error("Failed to spawn AO process:", error);
            throw new Error("Failed to spawn AO process");
        }
    }

    /**
     * Get result from a message
     * @param messageId - Message ID
     * @param processId - Process ID
     * @returns Promise<any> - Message result
     */
    public async getMessageResult(
        messageId: string,
        processId: string
    ): Promise<any> {
        try {
            logger.debug("Getting message result", { messageId, processId });

            const messageResult = await this.aoConnect.result({
                message: messageId,
                process: processId,
            });

            logger.debug("Retrieved message result", {
                messageId,
                result: messageResult,
            });
            return messageResult;
        } catch (error) {
            logger.error("Failed to get message result:", error);
            throw new Error("Failed to get message result");
        }
    }

    /**
     * Get results from a process
     * @param processId - Process ID
     * @param limit - Number of results to fetch
     * @param cursor - Cursor for pagination
     * @returns Promise<any> - Process results
     */
    public async getProcessResults(
        processId: string,
        limit: number = 25,
        cursor?: string
    ): Promise<any> {
        try {
            logger.debug("Getting process results", {
                processId,
                limit,
                cursor,
            });

            const processResults = await this.aoConnect.results({
                process: processId,
                sort: "ASC",
                limit,
                from: cursor,
            });

            logger.debug("Retrieved process results", {
                processId,
                count: processResults.edges?.length || 0,
            });
            return processResults;
        } catch (error) {
            logger.error("Failed to get process results:", error);
            throw new Error("Failed to get process results");
        }
    }

    /**
     * Get token balance for a specific token process
     * @param wallet - Wallet to check balance for
     * @param tokenProcessId - Token process ID
     * @returns Promise<TokenBalance> - Token balance information
     */
    public async getTokenBalance(
        wallet: AOWallet,
        tokenProcessId: string
    ): Promise<TokenBalance> {
        try {
            logger.debug("Getting token balance", {
                address: wallet.address,
                tokenProcessId,
            });

            // Send balance query message
            const messageId = await this.sendMessage(wallet, {
                process: tokenProcessId,
                tags: [
                    { name: "Action", value: "Balance" },
                    { name: "Target", value: wallet.address },
                ],
            });

            // Get result
            const result = await this.getMessageResult(
                messageId,
                tokenProcessId
            );

            // Extract balance from result
            const balance = result.Messages?.[0]?.Tags?.Balance || "0";
            const ticker = result.Messages?.[0]?.Tags?.Ticker;

            logger.debug("Retrieved token balance", {
                address: wallet.address,
                tokenProcessId,
                balance,
                ticker,
            });

            return {
                balance,
                ticker,
                processId: tokenProcessId,
            };
        } catch (error) {
            logger.error("Failed to get token balance:", error);
            throw new Error("Failed to get token balance");
        }
    }

    /**
     * Transfer tokens to another address
     * @param wallet - Wallet to send from
     * @param transferParams - Transfer parameters
     * @returns Promise<string> - Transfer message ID
     */
    public async transferTokens(
        wallet: AOWallet,
        transferParams: TransferParams
    ): Promise<string> {
        try {
            logger.info("Transferring tokens", {
                from: wallet.address,
                to: transferParams.recipient,
                quantity: transferParams.quantity,
                processId: transferParams.processId,
            });

            // Default transfer tags
            const transferTags = [
                { name: "Action", value: "Transfer" },
                { name: "Recipient", value: transferParams.recipient },
                { name: "Quantity", value: transferParams.quantity },
            ];

            // Add custom tags if provided
            if (transferParams.tags) {
                transferTags.push(...transferParams.tags);
            }

            // Send transfer message
            const messageId = await this.sendMessage(wallet, {
                process: transferParams.processId,
                tags: transferTags,
            });

            logger.info("Token transfer initiated", { messageId });
            return messageId;
        } catch (error) {
            logger.error("Failed to transfer tokens:", error);
            throw new Error("Failed to transfer tokens");
        }
    }

    /**
     * Get token information
     * @param tokenProcessId - Token process ID
     * @returns Promise<any> - Token information
     */
    public async getTokenInfo(tokenProcessId: string): Promise<any> {
        try {
            logger.debug("Getting token info", { tokenProcessId });

            // Create a temporary wallet for querying (we just need to send a message)
            const tempWallet = await this.generateWallet();

            // Send info query message
            const messageId = await this.sendMessage(tempWallet, {
                process: tokenProcessId,
                tags: [{ name: "Action", value: "Info" }],
            });

            // Get result
            const result = await this.getMessageResult(
                messageId,
                tokenProcessId
            );

            logger.debug("Retrieved token info", { tokenProcessId, result });
            return result;
        } catch (error) {
            logger.error("Failed to get token info:", error);
            throw new Error("Failed to get token info");
        }
    }

    /**
     * Dry run a message (simulate without executing)
     * @param wallet - Wallet to simulate from
     * @param messageParams - Message parameters
     * @returns Promise<any> - Dry run result
     */
    public async dryRun(
        wallet: AOWallet,
        messageParams: AOMessage
    ): Promise<any> {
        try {
            logger.debug("Performing dry run", {
                process: messageParams.process,
            });

            // Create data item signer
            const signer = createDataItemSigner(wallet.keyfile);

            // Perform dry run using aoconnect
            const dryRunResult = await this.aoConnect.dryrun({
                process: messageParams.process,
                tags: messageParams.tags || [],
                signer,
                data: messageParams.data || "",
                anchor: messageParams.anchor,
            });

            logger.debug("Dry run completed", { result: dryRunResult });
            return dryRunResult;
        } catch (error) {
            logger.error("Failed to perform dry run:", error);
            throw new Error("Failed to perform dry run");
        }
    }
}

// Export singleton instance
export const aoWalletService = new AOWalletService();
export default AOWalletService;
