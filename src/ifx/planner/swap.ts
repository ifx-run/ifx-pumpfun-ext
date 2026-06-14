import {
  expr,
  rawCpi,
  rawCpiPatch,
  structuredCpi,
  structuredCpiPatch,
  type FrameScratch,
} from "@ifx-run/sdk";
import { createTransferInstruction } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import type { QuoteLabel } from "../../types/api.js";
import type { TokenBuildAccounts } from "../../pump/accounts.js";
import {
  buyExactQuoteInV2Instruction,
  idempotentAtaCreate,
  sellV2Instruction,
  userBaseAta,
  userQuoteAta,
} from "../../pump/instructions.js";
import { quoteAta } from "../../pump/sdk.js";
import { BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET } from "../../pump/patch-offsets.js";
import { minOutRaw } from "../../util/amount.js";
import type { SponsorPlan } from "../../sponsor/plan.js";
import { swapHop2AtaSpecs } from "../../sponsor/ata-specs.js";
import { asIfxLetAccount } from "../let-account.js";
import {
  appendSponsorAtaBootstrap,
  appendSponsorRepayTransfer,
  appendSponsorSettleAssert,
  type U64Binding,
} from "./sponsor.js";

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
  repayBufferPercent: number;
  sponsor?: SponsorPlan;
};

function patchedSolTransfer(
  scratch: FrameScratch,
  from: PublicKey,
  to: PublicKey,
  amount: ReturnType<FrameScratch["letConstU64"]>
): TransactionInstruction {
  return scratch.ixCpi(
    structuredCpi(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 0 }),
      structuredCpiPatch.systemTransfer(amount)
    ).build()
  );
}

function patchedTokenTransfer(
  scratch: FrameScratch,
  template: TransactionInstruction,
  amount: ReturnType<FrameScratch["letConstU64"]>
): TransactionInstruction {
  return scratch.ixCpi(
    structuredCpi(template, structuredCpiPatch.tokenTransfer(amount)).build()
  );
}

/** A → quote → B: sell hop1, fee, patched buy hop2. */
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
    repayBufferPercent,
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

  const hop2AtaSpecs = swapHop2AtaSpecs(accountsB);

  let ataBootstrap: ReturnType<typeof appendSponsorAtaBootstrap> = null;
  if (sponsor?.active) {
    ataBootstrap = appendSponsorAtaBootstrap(
      scratch,
      out,
      sponsor.pubkey,
      user,
      hop2AtaSpecs
    );
  } else {
    for (const spec of hop2AtaSpecs) {
      out.push(
        idempotentAtaCreate(user, user, spec.mint, spec.tokenProgram)
      );
    }
  }

  const baselineBatch = scratch.letBuilder();
  const quoteBefore =
    quoteLabel === "SOL"
      ? baselineBatch.lamports(asIfxLetAccount(user))
      : baselineBatch.splTokenAmount(asIfxLetAccount(quoteAtaPk));
  out.push(baselineBatch.buildIx());

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

  const afterSell = scratch.letBuilder();
  const quoteAfter =
    quoteLabel === "SOL"
      ? afterSell.lamports(asIfxLetAccount(user))
      : afterSell.splTokenAmount(asIfxLetAccount(quoteAtaPk));
  const quoteDelta = afterSell.letEval(expr.sub(quoteAfter, quoteBefore));
  const fee = afterSell.letEval(
    expr.bpsMulFloor(quoteDelta, expr.u64(serviceFeeBps))
  );

  let netQuote = afterSell.letEval(expr.sub(quoteDelta, fee));
  let sponsorRepay: U64Binding | undefined;

  if (sponsor?.active && quoteLabel === "SOL") {
    const settle = ataBootstrap
      ? afterSell.letEval(
          expr.add(ataBootstrap.ataCost, expr.u64(sponsor.txFeeLamports))
        )
      : afterSell.letEval(expr.u64(sponsor.txFeeLamports));
    sponsorRepay = afterSell.letEval(
      expr.div(
        expr.mul(settle, expr.u64(100 + repayBufferPercent)),
        expr.u64(100)
      )
    );
    netQuote = afterSell.letEval(
      expr.sub(expr.sub(quoteDelta, fee), sponsorRepay)
    );
  }

  out.push(afterSell.buildIx());

  if (sponsorRepay) {
    appendSponsorSettleAssert(scratch, out, quoteDelta, sponsorRepay);
  }

  if (quoteLabel === "SOL") {
    out.push(patchedSolTransfer(scratch, user, feeRecipient, fee));
    if (sponsorRepay && sponsor) {
      appendSponsorRepayTransfer(
        scratch,
        out,
        user,
        sponsor.pubkey,
        sponsorRepay
      );
    }
    // Legacy SOL hop-2 debits native lamports; no WSOL wrap.
  } else {
    const operatorQuoteAta = quoteAta(
      feeRecipient,
      quoteMint,
      quoteTokenProgram
    );
    out.push(
      patchedTokenTransfer(
        scratch,
        createTransferInstruction(
          quoteAtaPk,
          operatorQuoteAta,
          user,
          0,
          [],
          quoteTokenProgram
        ),
        fee
      )
    );
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
            netQuote
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
