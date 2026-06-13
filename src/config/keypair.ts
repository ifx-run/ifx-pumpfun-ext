import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

/** Solana CLI keypair JSON: a 64-byte secret key array. */
export function loadKeypairFromFile(keypairPath: string): Keypair {
  const abs = resolve(process.cwd(), keypairPath);
  if (!existsSync(abs)) {
    throw new Error(`keypair file not found: ${abs}`);
  }

  const raw: unknown = JSON.parse(readFileSync(abs, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Error(
      `invalid keypair JSON at ${abs}: expected a 64-element number array (solana-keygen format)`
    );
  }

  const secret = Uint8Array.from(raw as number[]);
  return Keypair.fromSecretKey(secret);
}

export function resolveKeypairPath(keypairPath: string): string {
  return resolve(process.cwd(), keypairPath);
}

export function keypairFileExists(keypairPath: string | undefined): boolean {
  if (!keypairPath) return false;
  return existsSync(resolveKeypairPath(keypairPath));
}
