import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

type AltCacheEntry = {
  at: number;
  tables: AddressLookupTableAccount[];
};

let cache: { key: string; entry: AltCacheEntry } | null = null;

export async function fetchAddressLookupTables(
  connection: Connection,
  addresses: readonly string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];

  const tables: AddressLookupTableAccount[] = [];
  for (const address of addresses) {
    const res = await connection.getAddressLookupTable(new PublicKey(address));
    if (!res.value) {
      throw new Error(`address lookup table not found: ${address}`);
    }
    tables.push(res.value);
  }
  return tables;
}

/** Cached ALT fetch (keyed by ordered address list). */
export async function getAddressLookupTables(
  connection: Connection,
  addresses: readonly string[],
  ttlMs: number
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];

  const key = addresses.join(",");
  const now = Date.now();
  if (cache && cache.key === key && now - cache.entry.at < ttlMs) {
    return cache.entry.tables;
  }

  const tables = await fetchAddressLookupTables(connection, addresses);
  cache = { key, entry: { at: now, tables } };
  return tables;
}
