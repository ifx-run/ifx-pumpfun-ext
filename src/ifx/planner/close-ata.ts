import { arm, expr, ifElseArgs, staticCpi, type FrameScratch } from "@ifx-run/sdk";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { asIfxLetAccount } from "../let-account.js";

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

export type CloseAtaCandidate = {
  tokenAccount: PublicKey;
  rentDestination: PublicKey;
  owner: PublicKey;
  tokenProgram: PublicKey;
};

/** Close a token account when its balance is zero (Ifx if_else). */
export function appendConditionalCloseAta(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  params: CloseAtaCandidate
): void {
  const { tokenAccount, rentDestination, owner, tokenProgram } = params;
  const letBatch = scratch.letBuilder();
  const tokenRef = asIfxLetAccount(tokenAccount);
  const is2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID);
  const balance = is2022
    ? letBatch.splToken2022Amount(tokenRef)
    : letBatch.splTokenAmount(tokenRef);
  out.push(letBatch.buildIx());

  const close = staticCpi(
    createCloseAccountInstruction(
      tokenAccount,
      rentDestination,
      owner,
      [],
      tokenProgram
    )
  );
  out.push(
    scratch.ixIfElse(
      ifElseArgs(expr.isZero(balance), arm.cpi(close.staticStep)),
      close.remaining
    )
  );
}

/** Build optional smart-close instructions appended after core trade ixs. */
export function buildSmartCloseInstructions(
  scratch: FrameScratch,
  candidates: CloseAtaCandidate[]
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  for (const candidate of candidates) {
    appendConditionalCloseAta(scratch, ixs, candidate);
  }
  return ixs;
}
