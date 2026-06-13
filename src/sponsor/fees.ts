import type { AppConfig, PriorityTier } from "../config/types.js";

/** Lamports charged per Ed25519 signature (base fee, pre-priority). */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/**
 * Estimated total tx fee: base signatures + priority fee ceiling
 * (compute_unit_limit × micro_lamports / 1_000_000).
 */
export function computeTxFeeLamports(
  config: AppConfig,
  tier: PriorityTier,
  signatureCount: number
): bigint {
  const { microLamports, computeUnitLimit } = config.priorityFee[tier];
  const base = BigInt(signatureCount) * LAMPORTS_PER_SIGNATURE;
  const priority = BigInt(
    Math.ceil((computeUnitLimit * microLamports) / 1_000_000)
  );
  return base + priority;
}

/** Sponsor co-signs as fee payer → user + sponsor. */
export function sponsorTxSignatureCount(): number {
  return 2;
}
