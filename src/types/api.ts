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
  priorityTier?: string;
};

/** Estimated blockhash validity for UI countdown (slot time is approximate). */
export type BlockhashExpiry = {
  lastValidBlockHeight: number;
  currentBlockHeight: number;
  remainingSlots: number;
  expiresAtMs: number;
};

export type BuildSkippedReason =
  | "no_wallet"
  | "exceeds_balance"
  | "build_error";

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
  /** Present when quote runs with blockhash fetch (prepare flow). */
  blockhash?: BlockhashExpiry;
  /** Unsigned v0 transaction — built in the same request as quote when wallet connected. */
  build?: BuildTxResponse | null;
  buildSkippedReason?: BuildSkippedReason | null;
  buildError?: string;
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
  addressLookupTableCount: number;
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
  /** Always 0 — legacy transactions are not returned. */
  transactionVersion: 0;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  frameUsed?: string;
  feePayer?: string;
  signers?: string[];
  partiallySignedBy?: string[];
  /** ALT pubkeys compiled into this transaction. */
  addressLookupTables?: string[];
  /** True when conditional ATA close ixs were included and fit under the size limit. */
  smartCloseApplied?: boolean;
  transactionSizeBytes?: number;
  /** Developer-facing decoded instruction breakdown. */
  inspection?: TxInspection;
};

export type TxInstructionInspection = {
  index: number;
  programId: string;
  programLabel: string;
  hint?: string;
  accounts: {
    index: number;
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
    /** True when this account index comes from an address lookup table. */
    altLoaded: boolean;
    resolution: "static" | "alt-writable" | "alt-readonly";
    /** In ALT table but still static in message (signers / compiler placement). */
    inAltTableUnused?: boolean;
  }[];
  dataHex: string;
  dataBase64: string;
  dataLength: number;
};

export type TxInspection = {
  version: 0;
  numInstructions: number;
  staticAccountKeys: number;
  loadedWritableAccounts: number;
  loadedReadonlyAccounts: number;
  totalAccountKeys: number;
  addressLookupTables: string[];
  frameUsed?: string;
  feePayer?: string;
  smartCloseApplied?: boolean;
  transactionSizeBytes?: number;
  instructions: TxInstructionInspection[];
};
