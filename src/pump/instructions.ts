import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import { pumpBuybackFeeRecipient, pumpFeeRecipient } from "./fees.js";
import {
  bondingCurvePda,
  creatorVaultPda,
  getPumpProgram,
  quoteAta,
  type BondingCurve,
  type Global,
  PUMP_SDK,
  userVolumeAccumulatorPda,
} from "./sdk.js";

export type PumpIxParams = {
  global: Global;
  bondingCurve: BondingCurve;
  mint: PublicKey;
  user: PublicKey;
  baseTokenProgram: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
};

export function userBaseAta(
  mint: PublicKey,
  user: PublicKey,
  tokenProgram: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, user, true, tokenProgram);
}

export function userQuoteAta(
  user: PublicKey,
  quoteMint: PublicKey,
  quoteTokenProgram: PublicKey
): PublicKey {
  return quoteAta(user, quoteMint, quoteTokenProgram);
}

export function idempotentAtaCreate(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, true, tokenProgram),
    owner,
    mint,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

/** Wrap lamports into user's WSOL ATA before SOL-quote buy. */
export function wrapSolIxs(
  user: PublicKey,
  wsolAta: PublicKey,
  lamports: bigint
): TransactionInstruction[] {
  if (lamports <= 0n) return [];
  return [
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: wsolAta,
      lamports: Number(lamports),
    }),
    createSyncNativeInstruction(wsolAta),
  ];
}

export async function buyExactQuoteInV2Instruction(
  params: PumpIxParams & {
    spendableQuoteIn: bigint;
    minTokensOut: bigint;
    associatedBaseUser?: PublicKey;
  }
): Promise<TransactionInstruction> {
  const {
    global,
    bondingCurve,
    mint,
    user,
    baseTokenProgram,
    quoteMint,
    quoteTokenProgram,
    spendableQuoteIn,
    minTokensOut,
  } = params;

  const bondingCurvePk = bondingCurvePda(mint);
  const creator = bondingCurve.creator;
  const creatorVault = creatorVaultPda(creator);
  const userVolumeAccumulator = userVolumeAccumulatorPda(user);
  const feeRecipient = pumpFeeRecipient(global, bondingCurve.isMayhemMode);
  const buybackFeeRecipient = pumpBuybackFeeRecipient();
  const associatedBaseUser =
    params.associatedBaseUser ?? userBaseAta(mint, user, baseTokenProgram);

  const program = getPumpProgram(undefined as unknown as import("@solana/web3.js").Connection);
  return program.methods
    .buyExactQuoteInV2(
      new BN(spendableQuoteIn.toString()),
      new BN(minTokensOut.toString())
    )
    .accountsPartial({
      baseMint: mint,
      quoteMint,
      baseTokenProgram,
      quoteTokenProgram,
      feeRecipient,
      associatedQuoteFeeRecipient: quoteAta(
        feeRecipient,
        quoteMint,
        quoteTokenProgram
      ),
      buybackFeeRecipient,
      associatedQuoteBuybackFeeRecipient: quoteAta(
        buybackFeeRecipient,
        quoteMint,
        quoteTokenProgram
      ),
      associatedBaseBondingCurve: getAssociatedTokenAddressSync(
        mint,
        bondingCurvePk,
        true,
        baseTokenProgram
      ),
      associatedQuoteBondingCurve: quoteAta(
        bondingCurvePk,
        quoteMint,
        quoteTokenProgram
      ),
      user,
      associatedBaseUser,
      associatedQuoteUser: quoteAta(user, quoteMint, quoteTokenProgram),
      creatorVault,
      associatedCreatorVault: quoteAta(
        creatorVault,
        quoteMint,
        quoteTokenProgram
      ),
      associatedUserVolumeAccumulator: quoteAta(
        userVolumeAccumulator,
        quoteMint,
        quoteTokenProgram
      ),
    })
    .instruction();
}

export async function sellV2Instruction(
  params: PumpIxParams & {
    baseAmountIn: bigint;
    minQuoteOut: bigint;
  }
): Promise<TransactionInstruction> {
  const {
    global,
    bondingCurve,
    mint,
    user,
    baseTokenProgram,
    quoteMint,
    quoteTokenProgram,
    baseAmountIn,
    minQuoteOut,
  } = params;

  return PUMP_SDK.getSellV2InstructionRaw({
    user,
    mint,
    creator: bondingCurve.creator,
    amount: new BN(baseAmountIn.toString()),
    quoteAmount: new BN(minQuoteOut.toString()),
    feeRecipient: pumpFeeRecipient(global, bondingCurve.isMayhemMode),
    buybackFeeRecipient: pumpBuybackFeeRecipient(),
    tokenProgram: baseTokenProgram,
    quoteMint,
    quoteTokenProgram,
  });
}

export function isNativeQuoteMint(quoteMint: PublicKey): boolean {
  return quoteMint.equals(NATIVE_MINT);
}
