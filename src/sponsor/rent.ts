import { ACCOUNT_SIZE } from "@solana/spl-token";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { AtaSpec } from "./ata-specs.js";

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

/** Sum rent for ATAs that do not exist yet (idempotent create would charge). */
export async function sumMissingAtaRent(
  connection: Connection,
  user: PublicKey,
  specs: AtaSpec[]
): Promise<bigint> {
  if (specs.length === 0) return 0n;

  const atas = specs.map((s) =>
    userAta(user, s.mint, s.tokenProgram)
  );
  const [infos, minRent] = await Promise.all([
    connection.getMultipleAccountsInfo(atas),
    connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
  ]);

  let total = 0n;
  for (const info of infos) {
    if (info === null) total += BigInt(minRent);
  }
  return total;
}
