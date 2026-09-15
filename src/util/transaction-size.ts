import { MAX_V1_TRANSACTION_SIZE } from "../solana/tx-v1.js";
import type { SolanaTxVersion } from "../config/types.js";

/** Maximum serialized v0/legacy packet size accepted by Solana validators (bytes). */
export const MAX_V0_TRANSACTION_SIZE = 1232;

export function maxTransactionSize(version: SolanaTxVersion): number {
  return version === 1 ? MAX_V1_TRANSACTION_SIZE : MAX_V0_TRANSACTION_SIZE;
}

export function txTooLargeHint(version: SolanaTxVersion): string {
  return version === 1
    ? "Transaction exceeds Solana's 4096-byte v1 limit — drop optional instructions or split the route."
    : "Transaction exceeds Solana's 1232-byte packet limit — drop optional instructions or add an ALT.";
}

export function fitsTransactionSize(
  serialized: Buffer | Uint8Array,
  version: SolanaTxVersion
): boolean {
  return serialized.length <= maxTransactionSize(version);
}

/** Compile/serialize throws this when the message buffer would overflow. */
export function isTxCompileSizeError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("encoding overruns") ||
    msg.includes("transaction too large") ||
    msg.includes("exceeds maximum") ||
    msg.includes("is too large") ||
    msg.includes("size limit")
  );
}

export function assertTransactionSize(
  serialized: Buffer | Uint8Array,
  version: SolanaTxVersion,
  context?: string
): void {
  const size = serialized.length;
  const limit = maxTransactionSize(version);
  if (size > limit) {
    const prefix = context ? `${context}: ` : "";
    throw new Error(
      `${prefix}transaction size ${size} bytes exceeds Solana limit of ${limit} bytes. ${txTooLargeHint(version)}`
    );
  }
}
