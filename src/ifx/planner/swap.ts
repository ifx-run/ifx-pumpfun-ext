import {
  expr,
  rawCpi,
  rawCpiPatch,
  structuredCpi,
  structuredCpiPatch,
  type FrameScratch,
} from "@ifx-run/sdk";
import {
  createSyncNativeInstruction,
  createTransferInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
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
  isNativeQuoteMint,
  sellV2Instruction,
  userBaseAta,
  userQuoteAta,
} from "../../pump/instructions.js";
import { quoteAta } from "../../pump/sdk.js";
import { BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET } from "../../pump/patch-offsets.js";
import { minOutRaw } from "../../util/amount.js";
import type { AppConfig } from "../../config/types.js";
import type { SponsorPlan } from "../../sponsor/plan.js";
import { appendConditionalCloseAta } from "./close-ata.js";
import {
  appendSponsorAtaBootstrap,
  appendSponsorRepay,
  type AtaSpec,
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
  config: AppConfig;
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

/** A → quote → B: sell hop1, on-chain fee, patched buy hop2, optional close A ATA. */
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
    config,
    sponsor,
  } = params;

  if (!accountsA.quoteMint.equals(accountsB.quoteMint)) {
    throw new Error("swap requires matching quote mint on both tokens");
  }

  const quoteMint = accountsA.quoteMint;
  const quoteTokenProgram = accountsA.quoteTokenProgram;
  const quoteAtaPk = userQuoteAta(user, quoteMint, quoteTokenProgram);
  const baseAAta = userBaseAta(
    accountsA.mint,
    user,
    accountsA.baseTokenProgram
  );
  const baseBAta = userBaseAta(
    accountsB.mint,
    user,
    accountsB.baseTokenProgram
  );

  const hop2AtaSpecs: AtaSpec[] = [
    { mint: accountsB.mint, tokenProgram: accountsB.baseTokenProgram },
  ];
  if (!isNativeQuoteMint(quoteMint)) {
    hop2AtaSpecs.push({ mint: quoteMint, tokenProgram: quoteTokenProgram });
  } else {
    hop2AtaSpecs.push({ mint: NATIVE_MINT, tokenProgram: quoteTokenProgram });
  }

  if (sponsor?.active) {
    appendSponsorAtaBootstrap(scratch, out, sponsor.pubkey, user, hop2AtaSpecs);
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
      ? baselineBatch.lamports(user)
      : baselineBatch.splTokenAmount(quoteAtaPk);
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
      ? afterSell.lamports(user)
      : afterSell.splTokenAmount(quoteAtaPk);
  const quoteDelta = afterSell.letEval(expr.sub(quoteAfter, quoteBefore));
  const fee = afterSell.letEval(
    expr.bpsMulFloor(quoteDelta, expr.u64(serviceFeeBps))
  );
  const netQuote = afterSell.letEval(expr.sub(quoteDelta, fee));
  out.push(afterSell.buildIx());

  if (quoteLabel === "SOL") {
    out.push(patchedSolTransfer(scratch, user, feeRecipient, fee));
    out.push(patchedSolTransfer(scratch, user, quoteAtaPk, netQuote));
    out.push(createSyncNativeInstruction(quoteAtaPk));
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

  appendConditionalCloseAta(
    scratch,
    out,
    baseAAta,
    user,
    user,
    accountsA.baseTokenProgram
  );

  if (sponsor?.active && quoteLabel === "SOL") {
    appendSponsorRepay(scratch, out, user, sponsor.pubkey, config);
  }
}

export function sellMinQuoteForSwap(
  estimatedQuoteOut: bigint,
  slippageBps: number
): bigint {
  return minOutRaw(estimatedQuoteOut, slippageBps);
}
