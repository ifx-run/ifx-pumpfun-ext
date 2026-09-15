import { MAX_V1_TRANSACTION_SIZE } from "../solana/tx-v1.js";

/** Maximum serialized v1 transaction size accepted by Solana validators (bytes). */
export const MAX_TRANSACTION_SIZE = MAX_V1_TRANSACTION_SIZE;

export const TX_TOO_LARGE_HINT =
  "Transaction exceeds Solana's 4096-byte v1 limit — drop optional instructions or split the route.";

export function fitsTransactionSize(serialized: Buffer | Uint8Array): boolean {
  return serialized.length <= MAX_TRANSACTION_SIZE;
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
  context?: string
): void {
  const size = serialized.length;
  if (size > MAX_TRANSACTION_SIZE) {
    const prefix = context ? `${context}: ` : "";
    throw new Error(
      `${prefix}transaction size ${size} bytes exceeds Solana limit of ${MAX_TRANSACTION_SIZE} bytes. ${TX_TOO_LARGE_HINT}`
    );
  }
}
