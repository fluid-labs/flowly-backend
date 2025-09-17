export interface TransactionRequest {
    processId: string;
    recipient: string;
    quantity: string;
    tags?: Array<{ name: string; value: string }>;
}

export interface TransactionResponse {
    success: boolean;
    transactionId: string;
    messageId: string;
    estimatedConfirmationTime?: number;
}

export interface TransactionStatus {
    id: string;
    status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";
    confirmations?: number;
    blockHeight?: number;
    gasUsed?: string;
    fee?: string;
    errorMessage?: string;
    result?: any;
}

export interface TransactionHistory {
    transactions: TransactionStatus[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
        hasMore: boolean;
    };
}

export interface SwapRequest {
    fromTokenId: string;
    toTokenId: string;
    amount: string;
    slippageTolerance?: number;
    deadline?: number;
}

export interface SwapQuote {
    fromToken: {
        id: string;
        symbol: string;
        amount: string;
    };
    toToken: {
        id: string;
        symbol: string;
        amount: string;
    };
    exchangeRate: string;
    priceImpact: string;
    fee: string;
    route: string[];
}
