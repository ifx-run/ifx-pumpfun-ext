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

import type { AppConfig } from "../../config/types.js";

export type AtaSpec = {
  mint: PublicKey;
  tokenProgram: PublicKey;
};

function userAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
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
 * Sponsor-paid idempotent ATA creates with on-chain rent baselines.
 * Pattern from ifx/tests/sponsored_buy.ts (buy / swap bootstrap).
 */
export function appendSponsorAtaBootstrap(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  sponsor: PublicKey,
  user: PublicKey,
  specs: AtaSpec[]
): void {
  if (specs.length === 0) return;

  const baseline = scratch.letBuilder();
  for (const spec of specs) {
    baseline.lamports(userAta(user, spec.mint, spec.tokenProgram));
  }
  out.push(baseline.buildIx());

  for (const spec of specs) {
    out.push(sponsorAtaCreate(sponsor, user, spec));
  }
}

/** Patched SOL repay to sponsor after sell/swap (SOL quote). */
export function appendSponsorRepay(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  user: PublicKey,
  sponsor: PublicKey,
  config: AppConfig
): void {
  const repayBatch = scratch.letBuilder();
  const base = repayBatch.letEval(
    expr.add(
      expr.u64(config.sponsor.estimatedAtaRentLamports),
      expr.u64(config.sponsor.estimatedTxFeeLamports)
    )
  );
  const repay = repayBatch.letEval(
    expr.div(
      expr.mul(base, expr.u64(100 + config.sponsor.repayBufferPercent)),
      expr.u64(100)
    )
  );
  out.push(repayBatch.buildIx());

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
