/** Maximum serialized transaction size accepted by Solana validators (bytes). */
export const MAX_TRANSACTION_SIZE = 1232;

export const TX_TOO_LARGE_HINT =
  "Transaction exceeds Solana's 1232-byte limit — configure solana.address_lookup_tables (see docs/alt-addresses.zh-CN.md), or disable sponsored gas / smart-close if the build still does not fit.";

export function fitsTransactionSize(serialized: Buffer | Uint8Array): boolean {
  return serialized.length <= MAX_TRANSACTION_SIZE;
}

/** v0 compile/serialize throws this when the message buffer would overflow. */
export function isTxCompileSizeError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("encoding overruns") ||
    msg.includes("transaction too large") ||
    msg.includes("exceeds maximum")
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
