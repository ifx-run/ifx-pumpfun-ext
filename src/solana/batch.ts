import {
  Connection,
  PublicKey,
  type AccountInfo,
  type Commitment,
} from "@solana/web3.js";

const CHUNK = 100;

export async function fetchAccountsMap(
  connection: Connection,
  keys: PublicKey[],
  commitment?: Commitment
): Promise<Map<string, AccountInfo<Buffer> | null>> {
  const out = new Map<string, AccountInfo<Buffer> | null>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const infos = await connection.getMultipleAccountsInfo(slice, commitment);
    slice.forEach((pk, j) => out.set(pk.toBase58(), infos[j] ?? null));
  }
  return out;
}
