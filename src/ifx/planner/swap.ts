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
import {
  appendProceedsCoverRepayAssert,
  appendSponsorAtaBootstrap,
  appendSponsorRepayAmount,
  appendSponsorRepayTransfer,
} from "./sponsor.js";

export type SwapSponsorRepay = {
  pubkey: PublicKey;
  txFeeLamports: bigint;
  repayBufferPercent: number;
};

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
  /** When set, hop2 spends netQuote − repay so leftover SOL can repay the sponsor. */
  sponsor?: SwapSponsorRepay;
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
    sponsor,
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

  const hop2Specs = swapHop2AtaSpecs(accountsB);
  let ataCost: U64Binding | undefined;
  if (sponsor) {
    const boot = appendSponsorAtaBootstrap(
      scratch,
      out,
      sponsor.pubkey,
      user,
      hop2Specs
    );
    ataCost = boot?.ataCost;
  } else {
    for (const spec of hop2Specs) {
      out.push(idempotentAtaCreate(user, user, spec.mint, spec.tokenProgram));
    }
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

  const { quoteDelta, fee, netQuote } = appendProceedsAfterSell(scratch, out, {
    account: proceedsAccount,
    quoteBefore,
    serviceFeeBps,
    feeRecipient,
    quoteMint,
    quoteTokenProgram,
  });

  let hop2Spendable = netQuote ?? quoteDelta;
  let repay: U64Binding | undefined;
  if (sponsor) {
    if (quoteLabel !== "SOL") {
      throw new Error("sponsored swap requires SOL quote");
    }
    repay = appendSponsorRepayAmount(scratch, out, {
      txFeeLamports: sponsor.txFeeLamports,
      repayBufferPercent: sponsor.repayBufferPercent,
      ataCost,
    });
    appendProceedsCoverRepayAssert(scratch, out, quoteDelta, repay, fee);
    const hop2Batch = scratch.letBuilder();
    hop2Spendable = hop2Batch.letEval(expr.sub(hop2Spendable, repay));
    out.push(hop2Batch.buildIx());
  }

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
            hop2Spendable
          ),
        ],
      }).build()
    )
  );

  if (sponsor && repay) {
    appendSponsorRepayTransfer(scratch, out, user, sponsor.pubkey, repay);
  }
}

export function sellMinQuoteForSwap(
  estimatedQuoteOut: bigint,
  slippageBps: number
): bigint {
  return minOutRaw(estimatedQuoteOut, slippageBps);
}
