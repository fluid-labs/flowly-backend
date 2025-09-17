export interface WalletInfo {
    address: string;
    balance: string;
    currency: string;
    processId?: string;
    name?: string;
    walletType: "MAIN" | "TRADING" | "SAVINGS" | "STAKING";
}

export interface TokenBalance {
    processId: string;
    balance: string;
    ticker?: string;
    name?: string;
    denomination?: number;
    logo?: string;
}

export interface WalletBalance {
    arBalance: string;
    tokens: TokenBalance[];
    totalValueUSD?: string;
}

export interface CreateWalletRequest {
    name?: string;
    description?: string;
    walletType?: "MAIN" | "TRADING" | "SAVINGS" | "STAKING";
}

export interface WalletTransaction {
    id: string;
    type: "SEND" | "RECEIVE" | "SWAP" | "STAKE" | "UNSTAKE";
    amount: string;
    tokenSymbol?: string;
    fromAddress: string;
    toAddress: string;
    status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";
    timestamp: Date;
    txId: string;
}
