import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** SIMD-0296 / SIMD-0385: v1 serialized transaction ceiling. */
export const MAX_V1_TRANSACTION_SIZE = 4096;

/** v1 unset loaded-accounts cap is 0; 64 MiB matches the legacy/v0 default. */
export const DEFAULT_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export type V1ResourceConfig = {
  computeUnitLimit: number;
  loadedAccountsDataSizeLimit?: number;
  priorityFeeLamports: bigint;
};

export type CompiledV1Tx = {
  serialized: Uint8Array;
  base64: string;
};

function toKitRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

export function toKitInstruction(ix: TransactionInstruction): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((k) => ({
      address: address(k.pubkey.toBase58()),
      role: toKitRole(k.isSigner, k.isWritable),
    })),
    data: Uint8Array.from(ix.data),
  };
}

export async function compileV1Transaction(params: {
  feePayer: PublicKey;
  blockhash: string;
  lastValidBlockHeight: number;
  instructions: TransactionInstruction[];
  config: V1ResourceConfig;
  sponsorSecretKey?: Uint8Array;
}): Promise<CompiledV1Tx> {
  const kitIxs = params.instructions.map(toKitInstruction);
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(address(params.feePayer.toBase58()), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: params.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(params.lastValidBlockHeight),
        },
        m
      ),
    (m) => appendTransactionMessageInstructions(kitIxs, m),
    (m) =>
      setTransactionMessageConfig(
        {
          computeUnitLimit: params.config.computeUnitLimit,
          loadedAccountsDataSizeLimit:
            params.config.loadedAccountsDataSizeLimit ??
            DEFAULT_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
          priorityFeeLamports: params.config.priorityFeeLamports,
        },
        m
      )
  );

  let transaction = compileTransaction(message);
  if (params.sponsorSecretKey) {
    const signer = await createKeyPairSignerFromBytes(params.sponsorSecretKey);
    transaction = await partiallySignTransaction(
      [signer.keyPair],
      transaction
    );
  }

  const base64 = getBase64EncodedWireTransaction(transaction);
  return {
    serialized: Buffer.from(base64, "base64"),
    base64,
  };
}
