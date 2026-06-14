import {
  expr,
  rawCpi,
  rawCpiPatch,
  type FrameScratch,
  type U64Binding,
} from "@ifx-run/sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import type { QuoteLabel } from "../../types/api.js";
import type { TokenBuildAccounts } from "../../pump/accounts.js";
import {
  buyExactQuoteInV2Instruction,
  idempotentAtaCreate,
  sellV2Instruction,
  userBaseAta,
  userQuoteAta,
} from "../../pump/instructions.js";
import { BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET } from "../../pump/patch-offsets.js";
import { minOutRaw } from "../../util/amount.js";
import { swapHop2AtaSpecs } from "../../sponsor/ata-specs.js";
import {
  appendProceedsAfterSell,
  appendQuoteProceedsBaseline,
  type QuoteProceedsAccount,
} from "./service-fee.js";

export type SwapBuildParams = {
  scratch: FrameScratch;
  user: PublicKey;
  accountsA: TokenBuildAccounts;
  accountsB: TokenBuildAccounts;
  quoteLabel: QuoteLabel;
  baseAmountIn: bigint;
  sellMinQuoteOut: bigint;
  hop2MinBaseOut: bigint;
  feeRecipient: PublicKey;
  serviceFeeBps: number;
};

/** A → quote → B: sell hop1, on-chain fee split, patched buy hop2. */
export async function appendSwapInstructions(
  out: TransactionInstruction[],
  params: SwapBuildParams
): Promise<void> {
  const {
    scratch,
    user,
    accountsA,
    accountsB,
    quoteLabel,
    baseAmountIn,
    sellMinQuoteOut,
    hop2MinBaseOut,
    feeRecipient,
    serviceFeeBps,
  } = params;

  if (!accountsA.quoteMint.equals(accountsB.quoteMint)) {
    throw new Error("swap requires matching quote mint on both tokens");
  }

  const quoteMint = accountsA.quoteMint;
  const quoteTokenProgram = accountsA.quoteTokenProgram;
  const quoteAtaPk = userQuoteAta(user, quoteMint, quoteTokenProgram);
  const baseBAta = userBaseAta(
    accountsB.mint,
    user,
    accountsB.baseTokenProgram
  );

  for (const spec of swapHop2AtaSpecs(accountsB)) {
    out.push(idempotentAtaCreate(user, user, spec.mint, spec.tokenProgram));
  }

  const proceedsAccount: QuoteProceedsAccount = {
    quoteLabel,
    user,
    userQuoteAta: quoteAtaPk,
  };

  const quoteBefore = appendQuoteProceedsBaseline(scratch, out, proceedsAccount);

  out.push(
    await sellV2Instruction({
      global: accountsA.global,
      bondingCurve: accountsA.bondingCurve,
      mint: accountsA.mint,
      user,
      baseTokenProgram: accountsA.baseTokenProgram,
      quoteMint,
      quoteTokenProgram,
      baseAmountIn,
      minQuoteOut: sellMinQuoteOut,
    })
  );

  const { netQuote } = appendProceedsAfterSell(scratch, out, {
    account: proceedsAccount,
    quoteBefore,
    serviceFeeBps,
    feeRecipient,
    quoteMint,
    quoteTokenProgram,
  });

  const hop2Template = await buyExactQuoteInV2Instruction({
    global: accountsB.global,
    bondingCurve: accountsB.bondingCurve,
    mint: accountsB.mint,
    user,
    baseTokenProgram: accountsB.baseTokenProgram,
    quoteMint,
    quoteTokenProgram,
    spendableQuoteIn: 0n,
    minTokensOut: hop2MinBaseOut,
    associatedBaseUser: baseBAta,
  });

  out.push(
    scratch.ixCpi(
      rawCpi(hop2Template, {
        patches: [
          rawCpiPatch(
            BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET,
            netQuote!
          ),
        ],
      }).build()
    )
  );
}

export function sellMinQuoteForSwap(
  estimatedQuoteOut: bigint,
  slippageBps: number
): bigint {
  return minOutRaw(estimatedQuoteOut, slippageBps);
}
