import { PublicKey } from "@solana/web3.js";

import type { AppConfig } from "../config/types.js";
import type { PumpContext } from "./context.js";
import { sameQuote } from "./context.js";
import type { ResolveResponse } from "../types/api.js";
import { fetchWalletBalances } from "../wallet/balances.js";

export async function resolveTokens(
  pump: PumpContext,
  config: AppConfig,
  mintA: string,
  mintB?: string,
  userPubkey?: string
): Promise<ResolveResponse> {
  const pkA = new PublicKey(mintA);
  const tokenA = await pump.loadTokenMeta(pkA);

  const base = {
    tokenA,
    swapEligible: false as const,
    swapIneligibleReason: null as string | null,
  };

  if (!mintB) {
    if (userPubkey) {
      const wallet = await fetchWalletBalances(
        pump.connection,
        config,
        new PublicKey(userPubkey),
        tokenA
      );
      return { ...base, wallet };
    }
    return base;
  }

  const tokenB = await pump.loadTokenMeta(new PublicKey(mintB));
  const swapEligible = sameQuote(tokenA, tokenB);
  const result: ResolveResponse = {
    tokenA,
    tokenB,
    swapEligible,
    swapIneligibleReason: swapEligible
      ? null
      : `quote mismatch: ${tokenA.quoteLabel} vs ${tokenB.quoteLabel}`,
  };

  if (userPubkey) {
    result.wallet = await fetchWalletBalances(
      pump.connection,
      config,
      new PublicKey(userPubkey),
      tokenA
    );
  }

  return result;
}
