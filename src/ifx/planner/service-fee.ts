import {
  createTransferInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import type { QuoteLabel } from "../../types/api.js";
import { quoteAta } from "../../pump/sdk.js";

export type ServiceFeeIxParams = {
  quoteLabel: QuoteLabel;
  feeRaw: bigint;
  user: PublicKey;
  userQuoteAta: PublicKey;
  recipient: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram?: PublicKey;
};

/** Platform service fee — static amount at build time. */
export function serviceFeeTransferIx(
  params: ServiceFeeIxParams
): TransactionInstruction {
  const { quoteLabel, feeRaw, user, userQuoteAta, recipient, quoteMint } = params;
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

export function isWrappedSol(mint: PublicKey): boolean {
  return mint.equals(NATIVE_MINT);
}

/** After SOL-quote sell, fee is taken as WSOL SPL (operator WSOL ATA must exist). */
export function serviceFeeTransferIxAfterSolSell(
  params: Omit<ServiceFeeIxParams, "quoteLabel"> & { userWsolAta: PublicKey }
): TransactionInstruction {
  const quoteTokenProgram = params.quoteTokenProgram ?? TOKEN_PROGRAM_ID;
  const destAta = quoteAta(
    params.recipient,
    NATIVE_MINT,
    quoteTokenProgram
  );
  return createTransferInstruction(
    params.userWsolAta,
    destAta,
    params.user,
    params.feeRaw,
    [],
    quoteTokenProgram
  );
}
