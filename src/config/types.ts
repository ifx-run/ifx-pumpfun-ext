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
  /** Repay margin: patched repay = (on-chain ataCost + tx fee) × (100 + bps) / 100. */
  repayBufferPercent: number;
};

export type SolanaTxVersion = 0 | 1;

export type AppConfig = {
  server: { host: string; port: number };
  solana: {
    rpcUrl: string;
    commitment: "processed" | "confirmed" | "finalized";
    /**
     * 0 = v0 + ALTs (1232 B, ComputeBudget ixs). Default — wallets already sign this.
     * 1 = SIMD-0385 v1 (4096 B, no ALTs, resource limits in message config).
     */
    transactionVersion: SolanaTxVersion;
    /** Used only when transactionVersion is 0. Ignored for v1 compiles. */
    addressLookupTables: string[];
  };
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

export function usesTxV1(config: Pick<AppConfig, "solana">): boolean {
  return config.solana.transactionVersion === 1;
}
