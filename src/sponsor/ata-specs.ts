import { PublicKey } from "@solana/web3.js";

import type { TokenBuildAccounts } from "../pump/accounts.js";
import { isNativeQuoteMint } from "../pump/instructions.js";

export type AtaSpec = {
  mint: PublicKey;
  tokenProgram: PublicKey;
};

export function buyAtaSpecs(accounts: TokenBuildAccounts): AtaSpec[] {
  const specs: AtaSpec[] = [
    { mint: accounts.mint, tokenProgram: accounts.baseTokenProgram },
  ];
  // Legacy SOL pools debit native lamports; quote-side WSOL ATA is seed-only.
  if (!isNativeQuoteMint(accounts.quoteMint)) {
    specs.push({
      mint: accounts.quoteMint,
      tokenProgram: accounts.quoteTokenProgram,
    });
  }
  return specs;
}

/** Hop-2 ATAs for swap (B base; USDC quote adds quote ATA). */
export function swapHop2AtaSpecs(accountsB: TokenBuildAccounts): AtaSpec[] {
  const specs: AtaSpec[] = [
    { mint: accountsB.mint, tokenProgram: accountsB.baseTokenProgram },
  ];
  if (!isNativeQuoteMint(accountsB.quoteMint)) {
    specs.push({
      mint: accountsB.quoteMint,
      tokenProgram: accountsB.quoteTokenProgram,
    });
  }
  return specs;
}
