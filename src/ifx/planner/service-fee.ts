import {
  expr,
  structuredCpi,
  structuredCpiPatch,
  type FrameScratch,
  type LetIxBuilder,
  type U64Binding,
} from "@ifx-run/sdk";
import {
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import type { QuoteLabel } from "../../types/api.js";
import { quoteAta } from "../../pump/sdk.js";

export type QuoteProceedsAccount = {
  quoteLabel: QuoteLabel;
  user: PublicKey;
  userQuoteAta: PublicKey;
};

export type StaticServiceFeeIxParams = {
  quoteLabel: QuoteLabel;
  feeRaw: bigint;
  user: PublicKey;
  userQuoteAta: PublicKey;
  recipient: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram?: PublicKey;
};

/** Platform service fee — static amount at build time (buy path: fee before hop). */
export function serviceFeeTransferIx(
  params: StaticServiceFeeIxParams
): TransactionInstruction {
  const { quoteLabel, feeRaw, user, userQuoteAta, recipient, quoteMint } =
    params;
  if (feeRaw <= 0n) {
    throw new Error("service fee amount must be positive");
  }

  if (quoteLabel === "SOL") {
    return SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: recipient,
      lamports: Number(feeRaw),
    });
  }

  const quoteTokenProgram = params.quoteTokenProgram ?? TOKEN_PROGRAM_ID;
  const destAta = quoteAta(recipient, quoteMint, quoteTokenProgram);
  return createTransferInstruction(
    userQuoteAta,
    destAta,
    user,
    feeRaw,
    [],
    quoteTokenProgram
  );
}

function letQuoteProceeds(
  batch: LetIxBuilder,
  account: QuoteProceedsAccount
): U64Binding {
  return account.quoteLabel === "SOL"
    ? batch.lamports(account.user)
    : batch.splTokenAmount(account.userQuoteAta);
}

/** Baseline `ifx_let` before a sell — returns binding for quote proceeds account. */
export function appendQuoteProceedsBaseline(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  account: QuoteProceedsAccount
): U64Binding {
  const batch = scratch.letBuilder();
  const quoteBefore = letQuoteProceeds(batch, account);
  out.push(batch.buildIx());
  return quoteBefore;
}

export type ProceedsAfterSellResult = {
  quoteDelta: U64Binding;
  fee?: U64Binding;
  netQuote?: U64Binding;
};

export type DynamicServiceFeeParams = {
  account: QuoteProceedsAccount;
  quoteBefore: U64Binding;
  serviceFeeBps: number;
  feeRecipient?: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
};

/**
 * After sell: measure quote proceeds delta; optionally fee = bps × delta (floor) + patched transfer.
 * When `serviceFeeBps` is 0, only records `quoteDelta` (for sponsor assert).
 */
export function appendProceedsAfterSell(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  params: DynamicServiceFeeParams
): ProceedsAfterSellResult {
  const {
    account,
    quoteBefore,
    serviceFeeBps,
    feeRecipient,
    quoteMint,
    quoteTokenProgram,
  } = params;

  const after = scratch.letBuilder();
  const quoteAfter = letQuoteProceeds(after, account);
  const quoteDelta = after.letEval(expr.sub(quoteAfter, quoteBefore));

  if (serviceFeeBps <= 0) {
    out.push(after.buildIx());
    return { quoteDelta };
  }

  if (!feeRecipient) {
    throw new Error("feeRecipient required when serviceFeeBps > 0");
  }

  const fee = after.letEval(
    expr.bpsMulFloor(quoteDelta, expr.u64(serviceFeeBps))
  );
  const netQuote = after.letEval(expr.sub(quoteDelta, fee));
  out.push(after.buildIx());

  if (account.quoteLabel === "SOL") {
    out.push(
      patchedSolTransfer(scratch, account.user, feeRecipient, fee)
    );
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
          account.userQuoteAta,
          operatorQuoteAta,
          account.user,
          0,
          [],
          quoteTokenProgram
        ),
        fee
      )
    );
  }

  return { quoteDelta, fee, netQuote };
}

function patchedSolTransfer(
  scratch: FrameScratch,
  from: PublicKey,
  to: PublicKey,
  amount: U64Binding
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
  amount: U64Binding
): TransactionInstruction {
  return scratch.ixCpi(
    structuredCpi(template, structuredCpiPatch.tokenTransfer(amount)).build()
  );
}
