import type { Connection } from "@solana/web3.js";

import type { BlockhashExpiry } from "../types/api.js";

/** Mainnet slot time varies; 400ms is a reasonable UI countdown estimate. */
export const SLOT_MS_ESTIMATE = 400;

export type BlockhashContext = BlockhashExpiry & {
  blockhash: string;
};

export function blockhashContextToExpiry(ctx: BlockhashContext): BlockhashExpiry {
  return {
    lastValidBlockHeight: ctx.lastValidBlockHeight,
    currentBlockHeight: ctx.currentBlockHeight,
    remainingSlots: ctx.remainingSlots,
    expiresAtMs: ctx.expiresAtMs,
  };
}

export async function fetchBlockhashContext(
  connection: Connection
): Promise<BlockhashContext> {
  const [{ blockhash, lastValidBlockHeight }, currentBlockHeight] =
    await Promise.all([
      connection.getLatestBlockhash("confirmed"),
      connection.getBlockHeight("confirmed"),
    ]);
  const remainingSlots = Math.max(0, lastValidBlockHeight - currentBlockHeight);
  return {
    blockhash,
    lastValidBlockHeight,
    currentBlockHeight,
    remainingSlots,
    expiresAtMs: Date.now() + remainingSlots * SLOT_MS_ESTIMATE,
  };
}
