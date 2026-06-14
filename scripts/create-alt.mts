#!/usr/bin/env npx tsx
/**
 * Create (if needed) and extend a mainnet Address Lookup Table for ifx-pumpfun-ext.
 *
 * Usage:
 *   npm run alt:extend -- \
 *     --payer-keypair ./keys/payer.json \
 *     --authority-keypair ./keys/alt-authority.json
 *
 *   npm run alt:extend -- \
 *     --payer-keypair ./keys/payer.json \
 *     --authority-keypair ./keys/alt-authority.json \
 *     --lookup-table <ALT_ACCOUNT_PUBKEY>
 *
 * If --lookup-table is omitted, or the account is not on chain, a new ALT is created
 * with --authority-keypair as authority (paid by --payer-keypair), then extended.
 */
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";

import { loadKeypairFromFile } from "../src/config/keypair.js";
import { loadConfig } from "../src/config/load.js";
import { buildAltAddressList } from "./alt-addresses.js";

const EXTEND_BATCH_DEFAULT = 20;
const ALT_MAX_ADDRESSES = 256;

function solscanTxUrl(signature: string, rpcUrl: string): string {
  if (rpcUrl.includes("devnet")) {
    return `https://solscan.io/tx/${signature}?cluster=devnet`;
  }
  if (rpcUrl.includes("testnet")) {
    return `https://solscan.io/tx/${signature}?cluster=testnet`;
  }
  return `https://solscan.io/tx/${signature}`;
}

function logTxSignature(label: string, signature: string, rpcUrl: string) {
  console.log(`${label}: ${signature}`);
  console.log(`${label} (Solscan): ${solscanTxUrl(signature, rpcUrl)}`);
}

function usage(): never {
  console.error(`Usage:
  npm run alt:extend -- \\
    --payer-keypair ./keys/payer.json \\
    --authority-keypair ./keys/alt-authority.json \\
    [--lookup-table <ALT_ACCOUNT_PUBKEY>]

  --lookup-table 可选。未指定或链上不存在时，会用 authority 自动创建新 ALT 再 extend。
  --lookup-table 是账户地址（公钥），不是私钥文件。

Environment: reads RPC from config.toml unless --rpc is set.`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let payerKeypairPath: string | undefined;
  let authorityKeypairPath: string | undefined;
  let lookupTable: string | undefined;
  let rpcUrl: string | undefined;
  let minimal = false;
  let includeWsolAtas = true;
  let includeUsdcAtas = true;
  let batch = EXTEND_BATCH_DEFAULT;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--payer-keypair") payerKeypairPath = argv[++i];
    else if (a === "--authority-keypair") authorityKeypairPath = argv[++i];
    else if (a === "--lookup-table") lookupTable = argv[++i];
    else if (a === "--rpc") rpcUrl = argv[++i];
    else if (a === "--minimal") minimal = true;
    else if (a === "--no-wsol-atas") includeWsolAtas = false;
    else if (a === "--no-usdc-atas") includeUsdcAtas = false;
    else if (a === "--batch") batch = Number(argv[++i]);
    else usage();
  }

  if (!payerKeypairPath) {
    console.error("Missing --payer-keypair");
    usage();
  }
  if (!authorityKeypairPath) {
    console.error("Missing --authority-keypair");
    usage();
  }
  if (!Number.isFinite(batch) || batch < 1 || batch > 30) {
    throw new Error("--batch must be between 1 and 30");
  }

  return {
    payerKeypairPath,
    authorityKeypairPath,
    lookupTable,
    rpcUrl,
    minimal,
    includeWsolAtas,
    includeUsdcAtas,
    batch,
  };
}

async function sleepMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForAltActivation(
  connection: Connection,
  alt: PublicKey,
  maxAttempts = 30
) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await connection.getAddressLookupTable(alt);
    if (res.value) return;
    await sleepMs(500);
  }
  throw new Error(
    `ALT ${alt.toBase58()} not visible after create; retry extend with --lookup-table`
  );
}

function extendSigners(payer: Keypair, authority: Keypair): Keypair[] {
  return payer.publicKey.equals(authority.publicKey) ? [payer] : [payer, authority];
}

async function createAlt(
  connection: Connection,
  payer: Keypair,
  authority: Keypair
): Promise<PublicKey> {
  const slot = await connection.getSlot("confirmed");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createIx),
    extendSigners(payer, authority),
    { commitment: "confirmed" }
  );

  console.log("Created ALT:", altAddress.toBase58());
  logTxSignature("Create tx", sig, connection.rpcEndpoint);
  await waitForAltActivation(connection, altAddress);
  return altAddress;
}

async function fetchAltState(connection: Connection, alt: PublicKey) {
  const res = await connection.getAddressLookupTable(alt);
  if (!res.value) return null;
  return {
    addresses: new Set(res.value.state.addresses.map((pk) => pk.toBase58())),
    authority: res.value.state.authority,
  };
}

async function resolveLookupTable(
  connection: Connection,
  payer: Keypair,
  authority: Keypair,
  lookupTableArg: string | undefined
): Promise<PublicKey> {
  if (lookupTableArg) {
    const altPk = new PublicKey(lookupTableArg);
    const state = await fetchAltState(connection, altPk);
    if (state) {
      if (!state.authority) {
        throw new Error(`ALT ${altPk.toBase58()} has no authority (deactivated?)`);
      }
      if (!state.authority.equals(authority.publicKey)) {
        throw new Error(
          `authority-keypair (${authority.publicKey.toBase58()}) does not match on-chain ALT authority (${state.authority.toBase58()})`
        );
      }
      console.log("Using existing ALT:", altPk.toBase58());
      return altPk;
    }
    console.warn(
      `ALT ${altPk.toBase58()} not found on chain — creating a new lookup table`
    );
  } else {
    console.log("No --lookup-table specified — creating a new lookup table");
  }

  return createAlt(connection, payer, authority);
}

function filterAddressesToExtend(
  prepared: PublicKey[],
  onChain: Set<string>
): PublicKey[] {
  const seen = new Set(onChain);
  const toAdd: PublicKey[] = [];
  for (const pk of prepared) {
    const s = pk.toBase58();
    if (seen.has(s)) continue;
    seen.add(s);
    toAdd.push(pk);
  }
  return toAdd;
}

async function extendAlt(
  connection: Connection,
  payer: Keypair,
  authority: Keypair,
  altAddress: PublicKey,
  addresses: PublicKey[],
  batchSize: number
) {
  if (addresses.length === 0) {
    console.log("No new addresses to extend — ALT already up to date.");
    return;
  }

  const signers = extendSigners(payer, authority);

  for (let i = 0; i < addresses.length; i += batchSize) {
    const chunk = addresses.slice(i, i + batchSize);
    const ix = AddressLookupTableProgram.extendLookupTable({
      lookupTable: altAddress,
      authority: authority.publicKey,
      payer: payer.publicKey,
      addresses: chunk,
    });
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      signers,
      { commitment: "confirmed" }
    );
    logTxSignature(
      `Extend tx ${i + 1}-${i + chunk.length}/${addresses.length}`,
      sig,
      connection.rpcEndpoint
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  const rpc = args.rpcUrl ?? config.solana.rpcUrl;
  const connection = new Connection(rpc, config.solana.commitment);
  const payer = loadKeypairFromFile(args.payerKeypairPath!);
  const authority = loadKeypairFromFile(args.authorityKeypairPath!);

  const prepared = buildAltAddressList({
    minimal: args.minimal,
    includeWsolAtas: args.includeWsolAtas,
    includeUsdcAtas: args.includeUsdcAtas,
  }).map((s) => new PublicKey(s));

  console.log("RPC:", rpc);
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Prepared addresses (offline list):", prepared.length);

  const altPk = await resolveLookupTable(
    connection,
    payer,
    authority,
    args.lookupTable
  );

  const state = await fetchAltState(connection, altPk);
  const onChain = state?.addresses ?? new Set<string>();

  const toAdd = filterAddressesToExtend(prepared, onChain);
  const skipped = prepared.length - toAdd.length;

  console.log("Lookup table:", altPk.toBase58());
  console.log("On-chain ALT size:", onChain.size);
  console.log("Already present (skipped):", skipped);
  console.log("New addresses to extend:", toAdd.length);

  if (onChain.size + toAdd.length > ALT_MAX_ADDRESSES) {
    throw new Error(
      `Would exceed ALT limit (${ALT_MAX_ADDRESSES}): on-chain ${onChain.size} + new ${toAdd.length}`
    );
  }

  await extendAlt(connection, payer, authority, altPk, toAdd, args.batch);
  const final = await connection.getAddressLookupTable(altPk);
  console.log("Final ALT size:", final.value?.state.addresses.length ?? "?");

  console.log("\nconfig.toml [solana].address_lookup_tables should include:\n");
  console.log(`  "${altPk.toBase58()}",`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
