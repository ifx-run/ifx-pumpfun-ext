import {
  expr,
  structuredCpi,
  structuredCpiPatch,
  type FrameScratch,
  type U64Binding,
} from "@ifx-run/sdk";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import type { AtaSpec } from "../../sponsor/ata-specs.js";

export type { AtaSpec } from "../../sponsor/ata-specs.js";
export type { U64Binding } from "@ifx-run/sdk";

function userAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

function sponsorAtaCreate(
  sponsor: PublicKey,
  user: PublicKey,
  spec: AtaSpec
): TransactionInstruction {
  const ata = userAta(user, spec.mint, spec.tokenProgram);
  return createAssociatedTokenAccountIdempotentInstruction(
    sponsor,
    ata,
    user,
    spec.mint,
    spec.tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

/**
 * Sponsor-paid idempotent ATA creates; returns on-chain `ataCost` binding.
 * Pattern from ifx/tests/sponsored_buy.ts.
 */
export function appendSponsorAtaBootstrap(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  sponsor: PublicKey,
  user: PublicKey,
  specs: AtaSpec[]
): { ataCost: U64Binding } | null {
  if (specs.length === 0) return null;

  const baseline = scratch.letBuilder();
  const befores = specs.map((s) =>
    baseline.lamports(userAta(user, s.mint, s.tokenProgram))
  );
  out.push(baseline.buildIx());

  for (const spec of specs) {
    out.push(sponsorAtaCreate(sponsor, user, spec));
  }

  const after = scratch.letBuilder();
  let total = after.letEval(expr.u64(0));
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const afterLamports = after.lamports(
      userAta(user, spec.mint, spec.tokenProgram)
    );
    const delta = after.letEval(expr.sub(afterLamports, befores[i]!));
    total = after.letEval(expr.add(total, delta));
  }
  out.push(after.buildIx());
  return { ataCost: total };
}

/** Patched SOL repay: (on-chain ataCost + tx fee) × buffer. */
export function appendSponsorRepay(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  user: PublicKey,
  sponsor: PublicKey,
  opts: {
    txFeeLamports: bigint;
    repayBufferPercent: number;
    ataCost?: U64Binding;
    /** When set, assert proceeds cover service fee + repay before transfer. */
    proceeds?: { quoteDelta: U64Binding; serviceFee?: U64Binding };
  }
): void {
  const repayBatch = scratch.letBuilder();
  const base = opts.ataCost
    ? repayBatch.letEval(
        expr.add(opts.ataCost, expr.u64(opts.txFeeLamports))
      )
    : repayBatch.letEval(expr.u64(opts.txFeeLamports));
  const repay = repayBatch.letEval(
    expr.div(
      expr.mul(base, expr.u64(100 + opts.repayBufferPercent)),
      expr.u64(100)
    )
  );
  out.push(repayBatch.buildIx());

  if (opts.proceeds) {
    appendProceedsCoverRepayAssert(
      scratch,
      out,
      opts.proceeds.quoteDelta,
      repay,
      opts.proceeds.serviceFee
    );
  }

  appendSponsorRepayTransfer(scratch, out, user, sponsor, repay);
}

export function appendSponsorRepayTransfer(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  user: PublicKey,
  sponsor: PublicKey,
  repay: U64Binding
): void {
  out.push(
    scratch.ixCpi(
      structuredCpi(
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: sponsor,
          lamports: 0,
        }),
        structuredCpiPatch.systemTransfer(repay)
      ).build()
    )
  );
}

/** Assert sell proceeds cover sponsor repay (and optional on-chain service fee). */
export function appendSponsorSettleAssert(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  quoteDelta: U64Binding,
  repay: U64Binding
): void {
  out.push(scratch.ixAssert(expr.ge(quoteDelta, repay)));
}

export function appendProceedsCoverRepayAssert(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  quoteDelta: U64Binding,
  repay: U64Binding,
  serviceFee?: U64Binding
): void {
  const required = serviceFee
    ? expr.add(serviceFee, repay)
    : repay;
  out.push(scratch.ixAssert(expr.ge(quoteDelta, required)));
}
