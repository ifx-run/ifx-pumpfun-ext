export type QuoteLabel = "SOL" | "USDC";

export type TradeSide = "buy" | "sell";
export type TradeMode = "trade" | "swap";

export type TokenMeta = {
  mint: string;
  quoteMint: string;
  quoteLabel: QuoteLabel;
  decimals: number;
  tokenProgram: string;
  bondingCurve: string;
  complete: boolean;
  creator: string;
};

export type ResolveResponse = {
  tokenA: TokenMeta;
  tokenB?: TokenMeta;
  swapEligible: boolean;
  swapIneligibleReason: string | null;
  wallet?: {
    solRaw: string;
    solUi: string;
    usdcRaw: string;
    usdcUi: string;
    baseA?: {
      raw: string;
      ui: string;
      decimals: number;
    };
  };
};

export type QuoteRequest = {
  mode: TradeMode;
  side?: TradeSide;
  mintA: string;
  mintB?: string;
  inputAmount: string;
  slippageBps: number;
  userPubkey?: string;
};

export type QuoteResponse = {
  inputRaw: string;
  inputLabel: string;
  expectedOutputRaw: string;
  expectedOutputUi: string;
  minOutputRaw: string;
  serviceFeeRaw: string;
  serviceFeeLabel: QuoteLabel;
  netQuoteRaw: string;
  route: string[];
  ixKind: "buy_exact_quote_in_v2" | "sell_v2" | "swap_a_b";
  sponsor?: {
    required: boolean;
    estimatedLamports: string;
  };
  wallet?: {
    solRaw: string;
    solUi: string;
    usdcRaw: string;
    usdcUi: string;
    baseA?: {
      raw: string;
      ui: string;
      decimals: number;
    };
  };
  inputLimit?: {
    asset: "SOL" | "USDC" | "base";
    maxInputRaw: string;
    maxInputUi: string;
    exceedsBalance: boolean;
    hint: string | null;
  };
};

export type PublicConfigResponse = {
  debounceMs: number;
  defaultSlippageBps: number;
  serviceFeeBps: number;
  serviceFeeRecipientPubkey: string;
  sponsorEnabled: boolean;
  sponsorPubkey: string;
  publicFrameCount: number;
  priorityTiers: string[];
  defaultPriorityTier: string;
  rpcUrl: string;
};

/** Frozen quote fields for build — avoids re-parsing decimals on build. */
export type QuoteSnapshot = Pick<
  QuoteResponse,
  | "inputRaw"
  | "inputLabel"
  | "minOutputRaw"
  | "serviceFeeRaw"
  | "serviceFeeLabel"
  | "netQuoteRaw"
  | "ixKind"
>;

export type BuildTxRequest = QuoteRequest & {
  userPubkey: string;
  priorityTier?: string;
  quoteSnapshot?: QuoteSnapshot;
};

export type BuildTxResponse = {
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  frameUsed?: string;
  feePayer?: string;
  signers?: string[];
  partiallySignedBy?: string[];
};
