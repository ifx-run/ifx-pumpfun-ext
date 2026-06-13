import type { AccountMeta, PublicKey } from "@solana/web3.js";

/**
 * Ifx letBuilder uses `instanceof PublicKey` against its bundled web3.js.
 * Pass AccountMeta when our PublicKey comes from another copy of the package.
 */
export function asIfxLetAccount(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}
