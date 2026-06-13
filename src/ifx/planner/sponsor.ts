import {
  expr,
  structuredCpi,
  structuredCpiPatch,
  type FrameScratch,
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
import { asIfxLetAccount } from "../let-account.js";

export type { AtaSpec } from "../../sponsor/ata-specs.js";

/** u64 binding stored on Frame tape between let batches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type U64Binding = any;

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
    baseline.lamports(asIfxLetAccount(userAta(user, s.mint, s.tokenProgram)))
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
      asIfxLetAccount(userAta(user, spec.mint, spec.tokenProgram))
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

/** Assert sell quote delta covers sponsor repay (swap hop1). */
export function appendSponsorSettleAssert(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  quoteDelta: U64Binding,
  repay: U64Binding
): void {
  out.push(scratch.ixAssert(expr.ge(quoteDelta, repay)));
}
