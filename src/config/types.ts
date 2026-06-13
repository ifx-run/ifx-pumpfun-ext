export type PriorityTier = "low" | "medium" | "high";

export type PriorityFeeTier = {
  microLamports: number;
  computeUnitLimit: number;
};

/** Quote-only platform fee recipient (SOL lamports / USDC SPL). Receive-only — no keypair needed. */
export type ServiceFeeConfig = {
  bps: number;
  /** Fee recipient wallet; USDC fees land in this pubkey's USDC ATA (pre-create off-chain). */
  pubkey: string;
};

/** SOL-quote gas/rent sponsor (separate from fee recipient; may use the same pubkey in practice). */
export type SponsorConfig = {
  enabled: boolean;
  pubkey: string;
  /** Path to solana-keygen JSON keypair; required when enabled for co-signing. */
  keypairPath?: string;
  minUserSolLamports: number;
  repayBufferPercent: number;
  estimatedAtaRentLamports: number;
  estimatedTxFeeLamports: number;
};

export type AppConfig = {
  server: { host: string; port: number };
  solana: { rpcUrl: string; commitment: "processed" | "confirmed" | "finalized" };
  ifx: { programId: string; publicFrames: string[] };
  pump: { usdcMint: string; nativeMint: string };
  priorityFee: {
    low: PriorityFeeTier;
    medium: PriorityFeeTier;
    high: PriorityFeeTier;
    defaultTier: PriorityTier;
  };
  sponsor: SponsorConfig;
  serviceFee: ServiceFeeConfig;
  quote: { debounceMs: number; defaultSlippageBps: number };
  rpcCacheTtlMs: number;
};
