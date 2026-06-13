import { arm, expr, ifElseArgs, staticCpi, type FrameScratch } from "@ifx-run/sdk";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Close base-token ATA when balance is zero after sell. */
export function appendConditionalCloseAta(
  scratch: FrameScratch,
  out: TransactionInstruction[],
  tokenAccount: PublicKey,
  rentDestination: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey
): void {
  const letBatch = scratch.letBuilder();
  const is2022 = tokenProgram.equals(TOKEN_2022_PROGRAM_ID);
  const balance = is2022
    ? letBatch.splToken2022Amount(tokenAccount)
    : letBatch.splTokenAmount(tokenAccount);
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
