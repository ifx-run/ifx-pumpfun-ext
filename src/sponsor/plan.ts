import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import type { QuoteLabel } from "../types/api.js";
import type { AtaSpec } from "./ata-specs.js";
import {
  computeTxFeeLamports,
  sponsorTxSignatureCount,
} from "./fees.js";
import { sumMissingAtaRent } from "./rent.js";

export type SponsorPlan = {
  active: boolean;
  pubkey: PublicKey;
  /** Missing ATA rent + tx fee (before repay buffer). */
  settleLamports: bigint;
  /** On-chain patched repay = settle × (100 + buffer) / 100. */
  repayLamports: bigint;
  txFeeLamports: bigint;
  missingAtaRentLamports: bigint;
};

const INACTIVE_PUBKEY = new PublicKey(
  "11111111111111111111111111111111"
);

export function applyRepayBuffer(settle: bigint, bufferPercent: number): bigint {
  return (settle * BigInt(100 + bufferPercent)) / 100n;
}

export function inactiveSponsorPlan(config: AppConfig): SponsorPlan {
  const pubkey = config.sponsor.pubkey
    ? new PublicKey(config.sponsor.pubkey)
    : INACTIVE_PUBKEY;
  return {
    active: false,
    pubkey,
    settleLamports: 0n,
    repayLamports: 0n,
    txFeeLamports: 0n,
    missingAtaRentLamports: 0n,
  };
}

/** SOL quote + enabled → sponsor co-signs; settle derived from rent RPC + priority fee math. */
export async function resolveSponsorPlan(
  connection: Connection,
  config: AppConfig,
  opts: {
    quoteLabel: QuoteLabel;
    priorityTier: PriorityTier;
    user: PublicKey;
    bootstrapSpecs: AtaSpec[];
  }
): Promise<SponsorPlan> {
  const base = inactiveSponsorPlan(config);
  if (!config.sponsor.enabled || opts.quoteLabel !== "SOL") {
    return base;
  }
  if (!config.sponsor.pubkey || !config.sponsor.keypairPath) {
    return base;
  }

  const missingAtaRentLamports = await sumMissingAtaRent(
    connection,
    opts.user,
    opts.bootstrapSpecs
  );
  const txFeeLamports = computeTxFeeLamports(
    config,
    opts.priorityTier,
    sponsorTxSignatureCount()
  );
  const settleLamports = missingAtaRentLamports + txFeeLamports;
  const repayLamports = applyRepayBuffer(
    settleLamports,
    config.sponsor.repayBufferPercent
  );

  return {
    active: true,
    pubkey: new PublicKey(config.sponsor.pubkey),
    settleLamports,
    repayLamports,
    txFeeLamports,
    missingAtaRentLamports,
  };
}

export async function sponsorQuoteHint(
  connection: Connection,
  config: AppConfig,
  opts: {
    quoteLabel: QuoteLabel;
    priorityTier: PriorityTier;
    user?: PublicKey;
    bootstrapSpecs: AtaSpec[];
  }
): Promise<{ required: boolean; estimatedLamports: string } | undefined> {
  if (!config.sponsor.enabled || opts.quoteLabel !== "SOL") return undefined;

  const user = opts.user ?? PublicKey.unique();
  const missingAtaRentLamports = await sumMissingAtaRent(
    connection,
    user,
    opts.bootstrapSpecs
  );
  const txFeeLamports = computeTxFeeLamports(
    config,
    opts.priorityTier,
    sponsorTxSignatureCount()
  );
  const settle = missingAtaRentLamports + txFeeLamports;
  const estimated = applyRepayBuffer(settle, config.sponsor.repayBufferPercent);

  return {
    required: true,
    estimatedLamports: estimated.toString(),
  };
}

/** Sell/swap: min quote proceeds must cover sponsor repay (from trade output, not wallet balance). */
export function assertSponsorRepayCoverage(
  minQuoteProceeds: bigint,
  serviceFeeRaw: bigint,
  repayLamports: bigint
): void {
  const available = minQuoteProceeds - serviceFeeRaw;
  if (available < repayLamports) {
    throw new Error(
      `quote output insufficient for sponsor repay (need ${repayLamports} lamports after fee, min available ${available})`
    );
  }
}
