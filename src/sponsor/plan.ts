import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { AppConfig } from "../config/types.js";
import type { QuoteLabel, TradeMode, TradeSide } from "../types/api.js";

export type SponsorPlan = {
  active: boolean;
  pubkey: PublicKey;
  /** Repay amount (with buffer) for sell/swap SOL paths. */
  repayLamports: bigint;
  /** Estimated sponsor advance when active (rent + tx fee). */
  estimatedAdvanceLamports: bigint;
};

export function computeRepayLamports(config: AppConfig): bigint {
  const base = BigInt(
    config.sponsor.estimatedAtaRentLamports + config.sponsor.estimatedTxFeeLamports
  );
  return (base * BigInt(100 + config.sponsor.repayBufferPercent)) / 100n;
}

export function estimateAdvanceLamports(
  config: AppConfig,
  ataCount: number
): bigint {
  return BigInt(
    config.sponsor.estimatedAtaRentLamports * ataCount +
      config.sponsor.estimatedTxFeeLamports
  );
}

const INACTIVE_PUBKEY = new PublicKey(
  "11111111111111111111111111111111"
);

export function inactiveSponsorPlan(config: AppConfig): SponsorPlan {
  const pubkey = config.sponsor.pubkey
    ? new PublicKey(config.sponsor.pubkey)
    : INACTIVE_PUBKEY;
  return {
    active: false,
    pubkey,
    repayLamports: computeRepayLamports(config),
    estimatedAdvanceLamports: 0n,
  };
}

/** SOL quote + enabled + user below min balance → sponsor co-signs and advances rent/fees. */
export async function resolveSponsorPlan(
  connection: Connection,
  config: AppConfig,
  quoteLabel: QuoteLabel,
  user: PublicKey,
  ataCountForAdvance: number
): Promise<SponsorPlan> {
  const base = inactiveSponsorPlan(config);
  if (!config.sponsor.enabled || quoteLabel !== "SOL") {
    return base;
  }
  if (!config.sponsor.pubkey || !config.sponsor.keypairPath) {
    return base;
  }

  const bal = await connection.getBalance(user);
  if (bal >= config.sponsor.minUserSolLamports) {
    return base;
  }

  return {
    active: true,
    pubkey: new PublicKey(config.sponsor.pubkey),
    repayLamports: computeRepayLamports(config),
    estimatedAdvanceLamports: estimateAdvanceLamports(config, ataCountForAdvance),
  };
}

/** Quote-time hint without full sponsor plan resolution. */
export function sponsorQuoteHint(
  config: AppConfig,
  quoteLabel: QuoteLabel,
  opts?: {
    mode: TradeMode;
    side: TradeSide;
    userLamports?: bigint;
  }
): { required: boolean; estimatedLamports: string } | undefined {
  if (!config.sponsor.enabled || quoteLabel !== "SOL") return undefined;

  const mode = opts?.mode ?? "trade";
  const side = opts?.side ?? "buy";
  const estimated =
    mode === "swap" || side === "buy"
      ? estimateAdvanceLamports(config, 2)
      : computeRepayLamports(config);

  let required = true;
  if (opts?.userLamports !== undefined) {
    required = opts.userLamports < BigInt(config.sponsor.minUserSolLamports);
  }

  return {
    required,
    estimatedLamports: estimated.toString(),
  };
}
