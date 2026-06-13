import { PublicKey } from "@solana/web3.js";

import type { PumpContext } from "./context.js";
import { sameQuote } from "./context.js";
import type { ResolveResponse } from "../types/api.js";

export async function resolveTokens(
  pump: PumpContext,
  mintA: string,
  mintB?: string
): Promise<ResolveResponse> {
  const pkA = new PublicKey(mintA);
  const tokenA = await pump.loadTokenMeta(pkA);

  if (!mintB) {
    return {
      tokenA,
      swapEligible: false,
      swapIneligibleReason: null,
    };
  }

  const tokenB = await pump.loadTokenMeta(new PublicKey(mintB));
  const swapEligible = sameQuote(tokenA, tokenB);
  return {
    tokenA,
    tokenB,
    swapEligible,
    swapIneligibleReason: swapEligible
      ? null
      : `quote mismatch: ${tokenA.quoteLabel} vs ${tokenB.quoteLabel}`,
  };
}
