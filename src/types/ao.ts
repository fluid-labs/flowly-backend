export interface AOProcess {
    id: string;
    module: string;
    scheduler: string;
    owner: string;
    tags: Array<{ name: string; value: string }>;
    timestamp: number;
}

export interface AOMessage {
    id: string;
    process: string;
    owner: string;
    tags: Array<{ name: string; value: string }>;
    data?: string;
    anchor?: string;
    timestamp: number;
}

export interface AOResult {
    Messages: AOMessage[];
    Spawns: AOProcess[];
    Output: {
        data: any;
        prompt?: string;
    };
    Error?: string;
}

export interface TokenInfo {
    processId: string;
    name: string;
    ticker: string;
    denomination: number;
    logo?: string;
    description?: string;
    totalSupply?: string;
    owner?: string;
    module?: string;
}

export interface TokenTransfer {
    from: string;
    to: string;
    quantity: string;
    processId: string;
    messageId: string;
    timestamp: Date;
}

export interface AOConnectConfig {
    MU_URL: string;
    CU_URL: string;
    GATEWAY_URL: string;
}

export interface DryRunResult {
    Messages: any[];
    Spawns: any[];
    Output: any;
    Error?: string;
    GasUsed?: number;
}

export interface ProcessState {
    [key: string]: any;
}

export interface AssignmentResult {
    processId: string;
    messageId: string;
    success: boolean;
    error?: string;
}
