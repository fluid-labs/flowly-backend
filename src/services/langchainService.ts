import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from "@langchain/core/prompts";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { message, createDataItemSigner, connect } from "@permaweb/aoconnect";
import { config } from "../config/environment";
import { UserService } from "./userService";
import { EncryptionService } from "../utils/encryption";
import { logger } from "../utils/logger";
import { VentoClient } from "@vela-ventures/vento-sdk";

export interface ConversationMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

export interface TransferAssetParams {
    recipientAddress: string;
    amount: string;
    tokenProcessId?: string;
}

export class LangChainService {
    private llm: ChatOpenAI;
    private userService: UserService;
    private encryptionService: EncryptionService;
    private aoConnect: any;

    constructor() {
        this.llm = new ChatOpenAI({
            openAIApiKey: config.llm.openaiApiKey,
            modelName: config.llm.model,
            temperature: config.llm.temperature,
        });

        this.userService = new UserService();
        this.encryptionService = new EncryptionService();

        // Initialize AO Connect with configured endpoints
        this.aoConnect = connect({
            MU_URL: config.ao.muUrl,
            CU_URL: config.ao.cuUrl,
            GATEWAY_URL: config.ao.gatewayUrl,
        });
    }

    /**
     * Create the transfer asset tool for LangChain
     */
    private createTransferAssetTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "transfer-asset",
            description: `Transfer AO tokens to another wallet address. 
            Input should be a JSON object with:
            - recipientAddress: The wallet address to send tokens to (required)
            - amount: The amount of tokens to send (required, as string)
            - tokenProcessId: The AO token process ID (optional, defaults to AO native token)`,
            func: async (input: string) => {
                try {
                    const params: TransferAssetParams = JSON.parse(input);

                    if (!params.recipientAddress || !params.amount) {
                        return "Error: Both recipientAddress and amount are required";
                    }

                    // Validate amount is a positive number
                    const numAmount = parseFloat(params.amount);
                    if (isNaN(numAmount) || numAmount <= 0) {
                        return "Error: Amount must be a positive number";
                    }

                    // Get user wallet
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (
                        !user ||
                        !user.walletAddress ||
                        !user.encryptedPrivateKey
                    ) {
                        return "Error: User wallet not found. Please create a wallet first using /start";
                    }

                    // Decrypt private key
                    const privateKey = this.encryptionService.decrypt(
                        user.encryptedPrivateKey
                    );
                    const wallet = JSON.parse(privateKey);

                    // Create signer
                    const signer = createDataItemSigner(wallet);

                    // Default AO token process ID (configurable)
                    const processId =
                        params.tokenProcessId || config.ao.nativeTokenProcessId;

                    // Determine quantity in base units
                    const amtRaw = params.amount.trim();
                    let quantity = amtRaw;
                    const isAll = ["all", "max"].includes(amtRaw.toLowerCase());
                    if (isAll) {
                        // Fetch full balance in base units
                        const bal = await this.getRawBalance(
                            processId,
                            user.walletAddress
                        );
                        if (bal === "0") {
                            return "❌ Insufficient balance to transfer.";
                        }
                        quantity = bal;
                    } else {
                        // If decimal provided, convert to base units for native AO
                        const decimals =
                            processId === config.ao.nativeTokenProcessId ? 12 : 0;
                        if (decimals > 0 && /\./.test(amtRaw)) {
                            const big = new (require("big.js")) (amtRaw);
                            const denom = new (require("big.js")) (10).pow(decimals);
                            quantity = big.times(denom).round(0, 0).toString();
                        }
                    }

                    // Send transfer message to AO process
                    const sendRes = await this.aoConnect.message({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Transfer" },
                            {
                                name: "Recipient",
                                value: params.recipientAddress,
                            },
                            { name: "Quantity", value: quantity },
                        ],
                        signer,
                        data: "",
                    });
                    const messageId = typeof sendRes === "string" ? sendRes : sendRes?.id;

                    // Debug logs
                    console.log("[transfer-asset] process:", processId);
                    console.log("[transfer-asset] tags:", {
                        Action: "Transfer",
                        Recipient: params.recipientAddress,
                        Quantity: quantity,
                    });
                    console.log("[transfer-asset] messageId:", messageId);

                    logger.info(`Transfer initiated: ${messageId}`, {
                        telegramId,
                        recipient: params.recipientAddress,
                        amount: params.amount,
                        messageId,
                    });

                    // Wait a moment and check the result
                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    try {
                        const result = await this.aoConnect.result({
                            message: messageId,
                            process: processId,
                        });

                        if (result.Error) {
                            return `Transfer failed: ${result.Error}`;
                        }

                        console.log("[transfer-asset] result:", result);

                        return `✅ Transfer initiated!\n- Amount: ${params.amount} AO\n- Recipient: ${params.recipientAddress}\n- TxID: ${messageId}\n- Status: ${result.Output || "Submitted"}`;
                    } catch (resultError) {
                        logger.warn(
                            "Could not fetch transfer result immediately",
                            { error: resultError }
                        );
                        return `🔄 Transfer initiated successfully!\n- Amount: ${params.amount} AO\n- Recipient: ${params.recipientAddress}\n- TxID: ${messageId}\n- Status: Processing`;
                    }
                } catch (error) {
                    logger.error("Transfer asset tool error", {
                        error,
                        telegramId,
                    });
                    return `Error processing transfer: ${
                        error instanceof Error ? error.message : "Unknown error"
                    }`;
                }
            },
        });
    }

    /**
     * Create the get wallet address tool for LangChain
     */
    private createGetWalletAddressTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "get-wallet-address",
            description:
                "Return the user's AO wallet address as plain text. No input required.",
            func: async () => {
                try {
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }
                    return `\`${user.walletAddress}\``;
                } catch (error) {
                    logger.error("Get wallet address tool error", {
                        error,
                        telegramId,
                    });
                    return "❌ Error retrieving wallet address.";
                }
            },
        });
    }

    /**
     * Create the balance checking tool for LangChain
     */
    private createBalanceCheckTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "check-balance",
            description: `Check the user's wallet balance for AO tokens or specific token processes.
            Input should be a JSON object with:
            - tokenProcessId: The AO token process ID (optional, defaults to AO native token)`,
            func: async (input: string) => {
                try {
                    let params: { tokenProcessId?: string } = {};

                    // Try to parse input, but handle cases where it's empty or not JSON
                    try {
                        if (input && input.trim() !== "") {
                            params = JSON.parse(input);
                        }
                    } catch (parseError) {
                        // If input is not valid JSON, use default parameters
                        logger.warn(
                            "Balance check tool received non-JSON input",
                            { input }
                        );
                    }

                    // Get user wallet
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }

                    const processId =
                        params.tokenProcessId || config.ao.nativeTokenProcessId;

                    // Use dryrun to get balance
                    const result = await this.aoConnect.dryrun({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Balance" },
                            { name: "Target", value: user.walletAddress },
                        ],
                        data: "",
                    });

                    if (result.Messages && result.Messages.length > 0) {
                        const balanceMessage = result.Messages[0];
                        const rawBalance =
                            balanceMessage.Data ||
                            balanceMessage.Tags?.find(
                                (tag: any) => tag.name === "Balance"
                            )?.value ||
                            "0";

                        const decimals =
                            processId === config.ao.nativeTokenProcessId
                                ? (config.ao.nativeTokenDecimals ?? 12)
                                : 0;
                        const balance = this.formatAmountWithDecimals(
                            rawBalance,
                            decimals
                        );

                        return `💰 **Your Balance**
                        
🔸 **Amount:** ${balance} AO tokens
🔸 **Wallet:** \`${user.walletAddress}\`
🔸 **Token Process:** \`${processId.substring(0, 20)}...\`

💡 Your balance is up to date!`;
                    }

                    return `💰 **Your Balance**
                    
🔸 **Amount:** 0 AO tokens
🔸 **Wallet:** \`${user.walletAddress}\`

💡 No tokens found in this wallet.`;
                } catch (error) {
                    logger.error("Balance check tool error", {
                        error,
                        telegramId,
                    });
                    return `❌ Error checking balance: ${
                        error instanceof Error ? error.message : "Unknown error"
                    }`;
                }
            },
        });
    }

    /**
     * Create the balances listing tool for LangChain (AO Balances action)
     */
    private createListTokenBalancesTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "list-token-balances",
            description: `List all balances for a given AO token process using the Balances action.
            Input should be a JSON object with:
            - tokenProcessId: The AO token process ID (required)
            - limit: Optional number of entries to request (default 1000)
            - cursor: Optional cursor for pagination`,
            func: async (input: string) => {
                try {
                    const { tokenProcessId, limit, cursor } = JSON.parse(input || "{}");
                    if (!tokenProcessId) {
                        return "Error: tokenProcessId is required";
                    }

                    // Fetch user to highlight their own balance if present
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );

                    const dryrunResult = await this.aoConnect.dryrun({
                        process: tokenProcessId,
                        tags: [
                            { name: "Action", value: "Balances" },
                            ...(limit ? [{ name: "Limit", value: String(limit) }] : []),
                            ...(cursor ? [{ name: "Cursor", value: String(cursor) }] : []),
                        ],
                        data: "",
                    });

                    // Expect the first message's Data to contain the balances map
                    const msg = dryrunResult?.Messages?.[0];
                    let data: any = undefined;
                    if (msg?.Data) {
                        try {
                            data = typeof msg.Data === "string" ? JSON.parse(msg.Data) : msg.Data;
                        } catch {}
                    }

                    if (!data || typeof data !== "object") {
                        return "No balances found.";
                    }

                    // If user exists, surface their balance
                    const userBalance = user?.walletAddress
                        ? data[user.walletAddress] ?? 0
                        : undefined;

                    // Build a concise summary (top 10 by balance)
                    const entries = Object.entries(data) as Array<[string, number]>;
                    entries.sort((a, b) => (b[1] as number) - (a[1] as number));
                    const top = entries.slice(0, 10);

                    const lines = top.map(([addr, bal]) =>
                        `${addr === user?.walletAddress ? "🟢 " : ""}${addr.substring(0, 10)}...: ${bal}`
                    );

                    let response = "📊 Balances (top 10)\n" + lines.join("\n");
                    if (user && user.walletAddress) {
                        response += `\n\nYou (${user.walletAddress.substring(0, 10)}...): ${userBalance ?? 0}`;
                    }
                    return response;
                } catch (error) {
                    logger.error("List token balances tool error", {
                        error,
                        telegramId,
                    });
                    return "❌ Error listing balances.";
                }
            },
        });
    }

    /**
     * Create the user's balances tool across tracked tokens
     */
    private createUserBalancesTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "list-my-balances",
            description:
                "List the user's balances across configured/tracked token processes. No input required.",
            func: async () => {
                try {
                    return await this.summarizeUserBalances(telegramId);
                } catch (error) {
                    logger.error("List my balances tool error", { error, telegramId });
                    return "❌ Error retrieving balances.";
                }
            },
        });
    }

    /** Helper to shorten process id */
    private pidShort(pid: string): string {
        return `${pid.substring(0, 6)}...${pid.substring(pid.length - 4)}`;
    }

    /** Build a summary of user's balances across tracked tokens */
    private async summarizeUserBalances(telegramId: number): Promise<string> {
        const user = await this.userService.getUserByTelegramId(
            telegramId.toString()
        );
        if (!user || !user.walletAddress) {
            return "❌ Wallet not found. Please create a wallet first using /start";
        }

        const tracked = (config.ao.trackedTokens && config.ao.trackedTokens.length > 0)
            ? config.ao.trackedTokens
            : [config.ao.nativeTokenProcessId, config.ao.arioTokenProcessId].filter(Boolean);

        const balances: Array<{ ticker?: string; processId: string; amount: string }>= [];

        for (const pid of tracked) {
            try {
                const result = await this.aoConnect.dryrun({
                    process: pid,
                    tags: [
                        { name: "Action", value: "Balance" },
                        { name: "Target", value: user.walletAddress },
                    ],
                    data: "",
                });

                const msg = result?.Messages?.[0];
                const amount =
                    msg?.Data ||
                    msg?.Tags?.find((t: any) => t.name === "Balance")?.value ||
                    "0";
                const ticker = msg?.Tags?.find((t: any) => t.name === "Ticker")?.value;
                balances.push({ ticker, processId: pid, amount: String(amount) });
            } catch (e) {
                logger.warn("Failed to fetch balance for token", { pid, error: e });
            }
        }

        // Filter out zero balances
        const nonZero = balances.filter((b) => {
            try {
                const n = new (require("big.js")) (b.amount || 0);
                return n.gt(0);
            } catch { return String(b.amount) !== "0"; }
        });

        if (!nonZero.length) return "No balances found.";

        const lines = nonZero.map((b) => {
            const sym =
                b.processId === config.ao.nativeTokenProcessId
                    ? "AO"
                    : b.ticker || this.pidShort(b.processId);
            const decimals = this.getKnownTokenDecimals(b.processId);
            const pretty = this.formatAmountWithDecimals(b.amount, decimals);
            return `${sym}: ${pretty}`;
        });
        return "💰 Your balances\n" + lines.join("\n");
    }

    private getKnownTokenDecimals(processId: string): number {
        if (processId === config.ao.nativeTokenProcessId)
            return config.ao.nativeTokenDecimals ?? 12;
        if (processId === config.ao.arioTokenProcessId)
            return config.ao.arioTokenDecimals ?? 6;
        return 0;
    }

    private async listBalancesForProcess(telegramId: number, tokenProcessId: string): Promise<string> {
        try {
            const user = await this.userService.getUserByTelegramId(telegramId.toString());
            const dryrunResult = await this.aoConnect.dryrun({
                process: tokenProcessId,
                tags: [
                    { name: "Action", value: "Balances" },
                    { name: "Limit", value: String(1000) },
                ],
                data: "",
            });
            const msg = dryrunResult?.Messages?.[0];
            let data: any = undefined;
            if (msg?.Data) {
                try { data = typeof msg.Data === "string" ? JSON.parse(msg.Data) : msg.Data; } catch {}
            }
            if (!data || typeof data !== "object") return "No balances found.";
            const entries = Object.entries(data) as Array<[string, number]>;
            entries.sort((a, b) => (b[1] as number) - (a[1] as number));
            const top = entries.slice(0, 10);
            const lines = top.map(([addr, bal]) => `${addr === user?.walletAddress ? "🟢 " : ""}${addr.substring(0, 10)}...: ${bal}`);
            let response = "📊 Balances (top 10)\n" + lines.join("\n");
            if (user?.walletAddress) {
                const mine = data[user.walletAddress] ?? 0;
                response += `\n\nYou (${user.walletAddress.substring(0, 10)}...): ${mine}`;
            }
            return response;
        } catch (error) {
            logger.error("listBalancesForProcess error", { error, telegramId, tokenProcessId });
            return "❌ Error fetching balances for token.";
        }
    }

    private parseSpecificBalanceRequest(text: string): string | null {
        // e.g., what's my ARIO balance, what is my ao balance
        const re = /(what'?s|what\s+is)\s+my\s+([a-z0-9_-]{2,})\s+balance/i;
        const m = text.match(re);
        if (!m) return null;
        const alias = m[2].toUpperCase();
        if (alias === "AO" || alias === "ARIO") return alias;
        return alias;
    }

    private resolveTokenIdByAlias(alias: string): string | null {
        const map: Record<string, string> = {
            AO: config.ao.nativeTokenProcessId,
            ARIO: config.ao.arioTokenProcessId,
        };
        return map[alias.toUpperCase()] || null;
    }

    private getDecimalsByAliasOrId(token: string): number {
        if (token.toUpperCase() === "AO" || token === config.ao.nativeTokenProcessId) {
            return config.ao.nativeTokenDecimals ?? 12;
        }
        if (token.toUpperCase() === "ARIO" || token === config.ao.arioTokenProcessId) {
            return config.ao.arioTokenDecimals ?? 6;
        }
        return 0;
    }

    private async getFormattedUserBalanceForToken(
        telegramId: number,
        tokenAliasOrId: string
    ): Promise<string> {
        try {
            const user = await this.userService.getUserByTelegramId(
                telegramId.toString()
            );
            if (!user?.walletAddress) {
                return "❌ Wallet not found. Please create a wallet first using /start";
            }

            const tokenId =
                this.resolveTokenIdByAlias(tokenAliasOrId) || tokenAliasOrId;
            const result = await this.aoConnect.dryrun({
                process: tokenId,
                tags: [
                    { name: "Action", value: "Balance" },
                    { name: "Target", value: user.walletAddress },
                ],
                data: "",
            });
            const msg = result?.Messages?.[0];
            const raw =
                msg?.Data ||
                msg?.Tags?.find((t: any) => t.name === "Balance")?.value ||
                "0";
            const decimals = this.getDecimalsByAliasOrId(tokenId);
            const pretty = this.formatAmountWithDecimals(raw, decimals);
            const sym = tokenAliasOrId.toUpperCase() === tokenId ? this.pidShort(tokenId) : tokenAliasOrId.toUpperCase();
            return `💰 ${sym} Balance\n${pretty} ${sym}`;
        } catch (error) {
            logger.error("getFormattedUserBalanceForToken error", {
                error,
                telegramId,
                tokenAliasOrId,
            });
            return "❌ Error fetching token balance.";
        }
    }

    /** Parse transfer request sentences */
    private parseTransferRequest(text: string):
        | { amountRaw: string; recipient: string; isAll: boolean }
        | null {
        // Patterns:
        // send 0.11 ao to <addr>
        // send all my ao to <addr>
        // transfer 5 ao to <addr>
        // Capture recipient with case preserved by using a case-insensitive verb but a case-sensitive capture group
        const allRe = /\b(send|transfer)\s+(all|max)(?:\s+my)?\s+ao\s+to\s+([A-Za-z0-9_-]{20,})/i;
        const amtRe = /\b(send|transfer)\s+([0-9]+(?:\.[0-9]+)?)\s*ao\s+to\s+([A-Za-z0-9_-]{20,})/i;
        let m = text.match(allRe);
        if (m) {
            return { amountRaw: "all", isAll: true, recipient: m[3] };
        }
        m = text.match(amtRe);
        if (m) {
            return { amountRaw: m[2], isAll: false, recipient: m[3] };
        }
        return null;
    }

    /** Format token amount by decimals */
    private formatAmountWithDecimals(amount: string | number, decimals: number): string {
        try {
            const big = new (require("big.js")) (amount || 0);
            if (decimals > 0) {
                const denom = new (require("big.js")) (10).pow(decimals);
                const val = big.div(denom);
                // show up to 6 fractional digits, trim trailing zeros
                return val.toFixed(6).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
            }
            return big.toString();
        } catch {
            return String(amount);
        }
    }

    /** Get raw balance (base units) for a process/address */
    private async getRawBalance(processId: string, address: string): Promise<string> {
        const res = await this.aoConnect.dryrun({
            process: processId,
            tags: [
                { name: "Action", value: "Balance" },
                { name: "Target", value: address },
            ],
            data: "",
        });
        const msg = res?.Messages?.[0];
        const raw =
            msg?.Data ||
            msg?.Tags?.find((t: any) => t.name === "Balance")?.value ||
            "0";
        return String(raw);
    }

    /**
     * Create the wallet info tool for LangChain
     */
    private createWalletInfoTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "wallet-info",
            description: `Get detailed information about the user's wallet including address and creation date.`,
            func: async (input: string) => {
                try {
                    // Get user wallet
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }

                    return `🔐 **Your AO Wallet Information**

📍 **Address:** \`${user.walletAddress}\`
📅 **Created:** ${user.createdAt.toLocaleDateString()}
🌐 **Network:** AO Testnet
👤 **User:** ${user.firstName || "Unknown"} (ID: ${user.telegramId})

💡 Your wallet is secure and ready for transactions!`;
                } catch (error) {
                    logger.error("Wallet info tool error", {
                        error,
                        telegramId,
                    });
                    return `❌ Error getting wallet info: ${
                        error instanceof Error ? error.message : "Unknown error"
                    }`;
                }
            },
        });
    }

    /**
     * Create the agent with tools
     */
    private async createAgent(telegramId: number) {
        const tools = [
            this.createGetWalletAddressTool(telegramId),
            this.createBalanceCheckTool(telegramId),
            this.createListTokenBalancesTool(telegramId),
            this.createUserBalancesTool(telegramId),
            this.createTransferAssetTool(telegramId),
            this.createWalletInfoTool(telegramId),
            this.createSwapTokensTool(telegramId),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                `You are an AI assistant for an AO (Arweave) token trading bot. You help users manage their AO tokens through natural language commands.

Your capabilities:
- Get the user's wallet address using the get-wallet-address tool
- Check a wallet balance using the check-balance tool  
- List all balances in a token using the list-token-balances tool
- Transfer AO tokens to other wallet addresses using the transfer-asset tool
- Get wallet information using the wallet-info tool
- Provide information about AO tokens and transactions
- Help users understand their wallet operations

Available Tools:
1. **get-wallet-address**: Return the user's wallet address
   - Use when users ask for their address
   - Format: no input

2. **check-balance**: Check a wallet balance (Balance action)
   - Use when users ask about their balance
   - Format: optional tokenProcessId
   
3. **list-token-balances**: List all balances for a token (Balances action)
   - Use when users ask for all balances/holders of a token
   - Format: tokenProcessId, optional limit/cursor

4. **list-my-balances**: List user's balances across tracked tokens
   - Use when users ask "what's my balance" or "what tokens do I hold"
   - Format: no input required

5. **transfer-asset**: Send tokens (Transfer action)
   - Use when users want to send/transfer tokens
   - Format: recipientAddress, amount, optional tokenProcessId

Guidelines:
- Always use the appropriate tool for user requests
- For balance questions, use check-balance tool
- For wallet questions, use wallet-info tool  
- For transfers, use transfer-asset tool
- Be helpful, clear, and secure
- Always verify transaction details with users before executing transfers

Current user's Telegram ID: ${telegramId}`,
            ],
            new MessagesPlaceholder("chat_history"),
            ["human", "{input}"],
            new MessagesPlaceholder("agent_scratchpad"),
        ]);

        const agent = await createOpenAIFunctionsAgent({
            llm: this.llm,
            tools,
            prompt,
        });

        return new AgentExecutor({
            agent,
            tools,
            verbose: false,
            maxIterations: 3,
        });
    }

    /**
     * Process a user message and return AI response
     */
    async processMessage(
        telegramId: number,
        userMessage: string,
        conversationHistory: ConversationMessage[] = []
    ): Promise<string> {
        try {
            // Lightweight intent shortcut for common request: wallet address
            const lower = userMessage.toLowerCase();
            const normLower = lower.replace(/[’`]/g, "'");
            const normQuotes = userMessage.replace(/[’`]/g, "'");
            const asksForAddress =
                (normLower.includes("wallet") && normLower.includes("address")) ||
                normLower.includes("my address") ||
                normLower.includes("what is my address") ||
                normLower.includes("whats my address") ||
                normLower.includes("what's my address");
            const asksForMyBalance =
                normLower.includes("my balance") ||
                normLower.includes("what's my balance") ||
                normLower.includes("whats my balance") ||
                (normLower.includes("balance") && normLower.includes("my"));
            const asksForTransfer =
                normLower.startsWith("send ") ||
                normLower.startsWith("transfer ") ||
                normLower.includes(" send ") ||
                normLower.includes(" transfer ");
            const asksForSwap =
                normLower.startsWith("swap ") ||
                normLower.includes(" swap ");
            const listBalancesForTokenMatch = normQuotes.match(/\b(list\s+balances\s+for|holders\s+for)\s+([A-Za-z0-9_-]{20,})/i);
            const specificTokenBalanceAlias = this.parseSpecificBalanceRequest(normQuotes);
            if (asksForAddress) {
                const user = await this.userService.getUserByTelegramId(
                    telegramId.toString()
                );
                if (user?.walletAddress) {
                    return `📍 Your wallet address is:\n\`${user.walletAddress}\``;
                }
            }
            if (specificTokenBalanceAlias) {
                return await this.getFormattedUserBalanceForToken(
                    telegramId,
                    specificTokenBalanceAlias
                );
            }
            if (asksForMyBalance) {
                return await this.summarizeUserBalances(telegramId);
            }
            if (listBalancesForTokenMatch) {
                const tokenProcessId = listBalancesForTokenMatch[2];
                return await this.listBalancesForProcess(telegramId, tokenProcessId);
            }
            if (asksForTransfer) {
                // Parse from quote-normalized but case-preserving string
                const parsed = this.parseTransferRequest(normQuotes);
                if (!parsed) {
                    return "Please specify an amount and recipient, e.g. 'send 0.1 AO to <address>'.";
                }
                const { amountRaw, recipient, isAll } = parsed;

                console.log("[direct-transfer] parsed:", parsed);

                // Execute transfer directly
                try {
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress || !user.encryptedPrivateKey) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }

                    // Decrypt key and build signer
                    const privateKey = this.encryptionService.decrypt(
                        user.encryptedPrivateKey
                    );
                    const wallet = JSON.parse(privateKey);
                    const signer = createDataItemSigner(wallet);

                    const processId = config.ao.nativeTokenProcessId;

                    // Determine quantity
                    let quantity = amountRaw;
                    if (isAll) {
                        const bal = await this.getRawBalance(processId, user.walletAddress);
                        if (bal === "0") return "❌ Insufficient balance.";
                        quantity = bal;
                    } else {
                        const decimals = processId === config.ao.nativeTokenProcessId ? 12 : 0;
                        if (decimals > 0 && /\./.test(amountRaw)) {
                            const big = new (require("big.js")) (amountRaw);
                            const denom = new (require("big.js")) (10).pow(decimals);
                            quantity = big.times(denom).round(0, 0).toString();
                        }
                    }

                    console.log("[direct-transfer] process:", processId);
                    console.log("[direct-transfer] tags:", {
                        Action: "Transfer",
                        Recipient: recipient,
                        Quantity: quantity,
                    });

                    const sendRes = await this.aoConnect.message({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Transfer" },
                            { name: "Recipient", value: recipient },
                            { name: "Quantity", value: quantity },
                        ],
                        signer,
                        data: "",
                    });
                    const messageId = typeof sendRes === "string" ? sendRes : sendRes?.id;

                    console.log("[direct-transfer] messageId:", messageId);

                    // Try to fetch result quickly
                    await new Promise((r) => setTimeout(r, 1500));
                    try {
                        const result = await this.aoConnect.result({
                            message: messageId,
                            process: processId,
                        });
                        console.log("[direct-transfer] result:", result);
                    } catch (e) {
                        console.log("[direct-transfer] result fetch error:", e);
                    }

                    return `✅ Transfer initiated!\n- Amount: ${isAll ? "ALL" : amountRaw} AO\n- Recipient: ${recipient}\n- TxID: ${messageId}`;
                } catch (e: any) {
                    console.error("[direct-transfer] error:", e);
                    return `❌ Transfer error: ${e?.message || "Unknown error"}`;
                }
            }

            if (asksForSwap) {
                const parsed = this.parseSwapRequest(normQuotes);
                if (!parsed) {
                    return "Please specify swap like 'swap 0.1 AO to ARIO'";
                }
                const { amountRaw, fromSymbol, toSymbol } = parsed;
                console.log("[direct-swap] parsed:", parsed);
                try {
                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress || !user.encryptedPrivateKey) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }
                    const privateKey = this.encryptionService.decrypt(
                        user.encryptedPrivateKey
                    );
                    const wallet = JSON.parse(privateKey);
                    const signer = createDataItemSigner(wallet);

                    const client = new VentoClient({ signer });

                    const tokenIdMap: Record<string, string> = {
                        AO: config.ao.nativeTokenProcessId,
                        ARIO: config.ao.arioTokenProcessId,
                    };
                    const fromTokenId = tokenIdMap[fromSymbol.toUpperCase()] || fromSymbol;
                    const toTokenId = tokenIdMap[toSymbol.toUpperCase()] || toSymbol;

                    // Convert display amount to base units (assume AO 12 decimals; others 0 unless SDK expects otherwise)
                    const decimals = fromTokenId === config.ao.nativeTokenProcessId ? 12 : 0;
                    const big = new (require("big.js")) (amountRaw);
                    const denom = new (require("big.js")) (10).pow(decimals);
                    const amountBase = big.times(denom).round(0, 0).toString();

                    console.log("[direct-swap] quoting:", {
                        fromTokenId,
                        toTokenId,
                        amountBase,
                        userAddress: user.walletAddress,
                    });

                    const quote = await client.getSwapQuote({
                        fromTokenId,
                        toTokenId,
                        amount: amountBase,
                        userAddress: user.walletAddress,
                    });

                    if (!quote?.bestRoute) {
                        return "❌ No swap route found for requested pair/amount.";
                    }

                    const minAmount = VentoClient.calculateMinAmount(
                        quote.bestRoute.estimatedOutput,
                        1
                    );

                    const result = await client.executeSwap(
                        quote.bestRoute,
                        quote.fromTokenId,
                        quote.toTokenId,
                        quote.inputAmount,
                        minAmount,
                        user.walletAddress
                    );

                    console.log("[direct-swap] result:", result);

                    return `🔄 Swap submitted!\n- From: ${amountRaw} ${fromSymbol.toUpperCase()}\n- To: ${toSymbol.toUpperCase()}\n- Message: ${result.messageId || "submitted"}`;
                } catch (e: any) {
                    console.error("[direct-swap] error:", e);
                    return `❌ Swap error: ${e?.message || "Unknown error"}`;
                }
            }

            logger.info("Processing LangChain message", {
                telegramId,
                userMessage,
                historyLength: conversationHistory.length,
            });

            const agent = await this.createAgent(telegramId);

            logger.info("Agent created successfully", { telegramId });

            // Convert conversation history to LangChain format
            const chatHistory = conversationHistory.map((msg) =>
                msg.role === "user"
                    ? new HumanMessage(msg.content)
                    : new AIMessage(msg.content)
            );

            logger.info("Invoking agent", {
                telegramId,
                chatHistoryLength: chatHistory.length,
            });

            const result = await agent.invoke({
                input: userMessage,
                chat_history: chatHistory,
            });

            logger.info("Agent invocation completed", {
                telegramId,
                hasOutput: !!result.output,
            });

            logger.info("LangChain response generated", {
                telegramId,
                userMessage: userMessage.substring(0, 100),
                responseLength: (result as any)?.output?.length || 0,
            });

            if ((result as any)?.output && typeof (result as any).output === "string")
                return (result as any).output;
            return "I apologize, but I couldn't process your request. Please try again.";
        } catch (error) {
            // Log the full error to console for debugging
            console.error("Full LangChain error:", error);

            logger.error("LangChain processing error", {
                error:
                    error instanceof Error
                        ? {
                              message: error.message,
                              stack: error.stack,
                              name: error.name,
                          }
                        : error,
                telegramId,
                userMessage,
            });

            // Provide more specific error messages based on error type
            if (error instanceof Error) {
                if (error.message.includes("API key")) {
                    return "❌ AI service configuration error. Please contact support.";
                } else if (error.message.includes("rate limit")) {
                    return "⏳ AI service is busy. Please wait a moment and try again.";
                } else if (
                    error.message.includes("network") ||
                    error.message.includes("timeout")
                ) {
                    return "🌐 Network error. Please check your connection and try again.";
                }
            }

            return "❌ I encountered an error processing your request. Please try again or contact support.";
        }
    }

    /**
     * Get user's wallet balance (for future implementation)
     */
    async getWalletBalance(
        telegramId: number,
        tokenProcessId?: string
    ): Promise<string> {
        try {
            const user = await this.userService.getUserByTelegramId(
                telegramId.toString()
            );
            if (!user || !user.walletAddress) {
                return "Wallet not found. Please create a wallet first using /start";
            }

            const processId =
                tokenProcessId || "Sa0iBLPNyJQrwpTTG-tWLQU-1QeUAJA73DdxGGiKoJc";

            // Use dryrun to get balance
            const result = await this.aoConnect.dryrun({
                process: processId,
                tags: [
                    { name: "Action", value: "Balance" },
                    { name: "Target", value: user.walletAddress },
                ],
                data: "",
            });

            if (result.Messages && result.Messages.length > 0) {
                const balanceMessage = result.Messages[0];
                return (
                    balanceMessage.Data ||
                    balanceMessage.Tags?.find(
                        (tag: any) => tag.name === "Balance"
                    )?.value ||
                    "0"
                );
            }

            return "0";
        } catch (error) {
            logger.error("Error getting wallet balance", { error, telegramId });
            return "Error retrieving balance";
        }
    }

    private createSwapTokensTool(telegramId: number): DynamicTool {
        return new DynamicTool({
            name: "swap-tokens",
            description:
                "Swap tokens using Vento. Input: { fromSymbol|fromTokenId, toSymbol|toTokenId, amount }",
            func: async (input: string) => {
                try {
                    const args = JSON.parse(input || "{}");
                    const amountRaw: string = String(args.amount);
                    const from = (args.fromSymbol || args.fromTokenId || "AO").toString();
                    const to = (args.toSymbol || args.toTokenId || "ARIO").toString();

                    const user = await this.userService.getUserByTelegramId(
                        telegramId.toString()
                    );
                    if (!user || !user.walletAddress || !user.encryptedPrivateKey) {
                        return "❌ Wallet not found. Please create a wallet first using /start";
                    }

                    const privateKey = this.encryptionService.decrypt(
                        user.encryptedPrivateKey
                    );
                    const wallet = JSON.parse(privateKey);
                    const signer = createDataItemSigner(wallet);

                    const client = new VentoClient({ signer });

                    const tokenIdMap: Record<string, string> = {
                        AO: config.ao.nativeTokenProcessId,
                        ARIO: config.ao.arioTokenProcessId,
                    };
                    const fromTokenId = tokenIdMap[from.toUpperCase()] || from;
                    const toTokenId = tokenIdMap[to.toUpperCase()] || to;

                    const decimals = fromTokenId === config.ao.nativeTokenProcessId ? 12 : 0;
                    const big = new (require("big.js")) (amountRaw);
                    const denom = new (require("big.js")) (10).pow(decimals);
                    const amountBase = big.times(denom).round(0, 0).toString();

                    const quote = await client.getSwapQuote({
                        fromTokenId,
                        toTokenId,
                        amount: amountBase,
                        userAddress: user.walletAddress,
                    });
                    if (!quote?.bestRoute) {
                        return "❌ No swap route found for requested pair/amount.";
                    }
                    const minAmount = VentoClient.calculateMinAmount(
                        quote.bestRoute.estimatedOutput,
                        1
                    );
                    const result = await client.executeSwap(
                        quote.bestRoute,
                        quote.fromTokenId,
                        quote.toTokenId,
                        quote.inputAmount,
                        minAmount,
                        user.walletAddress
                    );
                    return `✅ Swap initiated!\n- From: ${amountRaw} ${from.toUpperCase()}\n- To: ${to.toUpperCase()}\n- Message: ${result.messageId || "submitted"}`;
                } catch (error) {
                    logger.error("swap-tokens tool error", { error, telegramId });
                    return `❌ Swap tool error: ${
                        error instanceof Error ? error.message : "Unknown error"
                    }`;
                }
            },
        });
    }

    private parseSwapRequest(text: string):
        | { amountRaw: string; fromSymbol: string; toSymbol: string }
        | null {
        // swap 0.1 ao to ario
        const re = /\bswap\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9_-]{2,})\s+to\s+([a-z0-9_-]{2,})/i;
        const m = text.match(re);
        if (!m) return null;
        return { amountRaw: m[1], fromSymbol: m[2], toSymbol: m[3] };
    }
}
