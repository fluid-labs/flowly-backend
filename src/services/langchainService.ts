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

                    // Default AO token process ID (you may want to make this configurable)
                    const processId =
                        params.tokenProcessId ||
                        "Sa0iBLPNyJQrwpTTG-tWLQU-1QeUAJA73DdxGGiKoJc";

                    // Send transfer message to AO process
                    const messageResult = await this.aoConnect.message({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Transfer" },
                            {
                                name: "Recipient",
                                value: params.recipientAddress,
                            },
                            { name: "Quantity", value: params.amount },
                        ],
                        signer,
                        data: "",
                    });

                    logger.info(`Transfer initiated: ${messageResult.id}`, {
                        telegramId,
                        recipient: params.recipientAddress,
                        amount: params.amount,
                        messageId: messageResult.id,
                    });

                    // Wait a moment and check the result
                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    try {
                        const result = await this.aoConnect.result({
                            message: messageResult.id,
                            process: processId,
                        });

                        if (result.Error) {
                            return `Transfer failed: ${result.Error}`;
                        }

                        return `✅ Transfer successful! 
                        - Amount: ${params.amount} AO tokens
                        - Recipient: ${params.recipientAddress}
                        - Transaction ID: ${messageResult.id}
                        - Status: ${result.Output || "Completed"}`;
                    } catch (resultError) {
                        logger.warn(
                            "Could not fetch transfer result immediately",
                            { error: resultError }
                        );
                        return `🔄 Transfer initiated successfully!
                        - Amount: ${params.amount} AO tokens  
                        - Recipient: ${params.recipientAddress}
                        - Transaction ID: ${messageResult.id}
                        - Status: Processing (check back in a few moments)`;
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
                        params.tokenProcessId ||
                        "Sa0iBLPNyJQrwpTTG-tWLQU-1QeUAJA73DdxGGiKoJc";

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
                        const balance =
                            balanceMessage.Data ||
                            balanceMessage.Tags?.find(
                                (tag: any) => tag.name === "Balance"
                            )?.value ||
                            "0";

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
            this.createTransferAssetTool(telegramId),
            this.createBalanceCheckTool(telegramId),
            this.createWalletInfoTool(telegramId),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                `You are an AI assistant for an AO (Arweave) token trading bot. You help users manage their AO tokens through natural language commands.

Your capabilities:
- Transfer AO tokens to other wallet addresses using the transfer-asset tool
- Check wallet balances using the check-balance tool  
- Get wallet information using the wallet-info tool
- Provide information about AO tokens and transactions
- Help users understand their wallet operations

Available Tools:
1. **transfer-asset**: For sending tokens to other addresses
   - Use when users want to send/transfer tokens
   - Format: JSON with recipientAddress and amount fields
   
2. **check-balance**: For checking wallet balance
   - Use when users ask about balance, funds, or how much they have
   - Format: Empty JSON object or with optional tokenProcessId
   
3. **wallet-info**: For getting wallet details
   - Use when users ask about their wallet, address, or account info
   - Format: Empty JSON object (no parameters needed)

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
                responseLength: result.output?.length || 0,
            });

            return (
                result.output ||
                "I apologize, but I couldn't process your request. Please try again."
            );
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
}
