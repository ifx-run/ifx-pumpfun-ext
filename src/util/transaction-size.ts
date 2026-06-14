/** Maximum serialized transaction size accepted by Solana validators (bytes). */
export const MAX_TRANSACTION_SIZE = 1232;

export function fitsTransactionSize(serialized: Buffer | Uint8Array): boolean {
  return serialized.length <= MAX_TRANSACTION_SIZE;
}

export function assertTransactionSize(
  serialized: Buffer | Uint8Array,
  context?: string
): void {
  const size = serialized.length;
  if (size > MAX_TRANSACTION_SIZE) {
    const prefix = context ? `${context}: ` : "";
    throw new Error(
      `${prefix}transaction size ${size} bytes exceeds Solana limit of ${MAX_TRANSACTION_SIZE} bytes`
    );
  }
}
