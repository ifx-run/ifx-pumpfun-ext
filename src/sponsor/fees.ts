import type { AppConfig, PriorityTier } from "../config/types.js";

/** Lamports charged per Ed25519 signature (base fee, pre-priority). */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/** v1 `priorityFeeLamports` (total) equivalent of v0 micro-lamports-per-CU. */
export function priorityFeeLamportsForTier(
  config: AppConfig,
  tier: PriorityTier
): bigint {
  const { microLamports, computeUnitLimit } = config.priorityFee[tier];
  return BigInt(Math.ceil((computeUnitLimit * microLamports) / 1_000_000));
}

/**
 * Estimated total tx fee: base signatures + priority fee ceiling
 * (compute_unit_limit × micro_lamports / 1_000_000).
 */
export function computeTxFeeLamports(
  config: AppConfig,
  tier: PriorityTier,
  signatureCount: number
): bigint {
  const base = BigInt(signatureCount) * LAMPORTS_PER_SIGNATURE;
  return base + priorityFeeLamportsForTier(config, tier);
}

/** Sponsor co-signs as fee payer → user + sponsor. */
export function sponsorTxSignatureCount(): number {
  return 2;
}
