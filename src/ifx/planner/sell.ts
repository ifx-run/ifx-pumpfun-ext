import type { FrameScratch, U64Binding } from "@ifx-run/sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import type { TokenBuildAccounts } from "../../pump/accounts.js";
import { sellV2Instruction } from "../../pump/instructions.js";
import type { QuoteLabel } from "../../types/api.js";
import {
  appendProceedsAfterSell,
  appendQuoteProceedsBaseline,
  type QuoteProceedsAccount,
} from "./service-fee.js";

export type SellBuildParams = {
  scratch: FrameScratch;
  user: PublicKey;
  accounts: TokenBuildAccounts;
  quoteLabel: QuoteLabel;
  userQuoteAta: PublicKey;
  baseAmountIn: bigint;
  minQuoteOut: bigint;
  serviceFeeBps: number;
  feeRecipient: PublicKey;
  /** When true, measure quote delta even if `serviceFeeBps` is 0 (sponsor repay assert). */
  measureProceeds?: boolean;
};

export type SellBuildResult = {
  quoteDelta?: U64Binding;
  fee?: U64Binding;
};

/**
 * Sell then platform fee = bps × **actual** quote proceeds (Ifx let + patched transfer).
 * Fee basis is on-chain delta, not quote-time estimate.
 */
export async function appendSellWithDynamicServiceFee(
  out: TransactionInstruction[],
  params: SellBuildParams
): Promise<SellBuildResult> {
  const {
    scratch,
    user,
    accounts,
    quoteLabel,
    userQuoteAta,
    baseAmountIn,
    minQuoteOut,
    serviceFeeBps,
    feeRecipient,
    measureProceeds = false,
  } = params;

  const proceedsAccount: QuoteProceedsAccount = {
    quoteLabel,
    user,
    userQuoteAta,
  };

  const needsProceedsLet = serviceFeeBps > 0 || measureProceeds;
  let quoteBefore: U64Binding | undefined;

  if (needsProceedsLet) {
    quoteBefore = appendQuoteProceedsBaseline(scratch, out, proceedsAccount);
  }

  out.push(
    await sellV2Instruction({
      global: accounts.global,
      bondingCurve: accounts.bondingCurve,
      mint: accounts.mint,
      user,
      baseTokenProgram: accounts.baseTokenProgram,
      quoteMint: accounts.quoteMint,
      quoteTokenProgram: accounts.quoteTokenProgram,
      baseAmountIn,
      minQuoteOut,
    })
  );

  if (!needsProceedsLet) {
    return {};
  }

  const { quoteDelta, fee } = appendProceedsAfterSell(scratch, out, {
    account: proceedsAccount,
    quoteBefore: quoteBefore!,
    serviceFeeBps,
    feeRecipient: serviceFeeBps > 0 ? feeRecipient : undefined,
    quoteMint: accounts.quoteMint,
    quoteTokenProgram: accounts.quoteTokenProgram,
  });

  return { quoteDelta, fee };
}
