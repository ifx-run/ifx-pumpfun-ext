import {
  type AddressLookupTableAccount,
  type VersionedTransaction,
} from "@solana/web3.js";

import type { TxInspection, TxInstructionInspection } from "../types/api.js";

const PROGRAM_LABELS: Record<string, string> = {
  "ComputeBudget111111111111111111111111111111": "Compute Budget",
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump",
  ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj: "Ifx",
};

const PUMP_IX: Record<string, string> = {
  c2ab1c46684d5b2f: "buy_exact_quote_in_v2",
  "5df6823ce7e940b2": "sell_v2",
  "38fc74089edfcd5f": "buy_exact_sol_in",
};

const IFX_IX = [
  "ifx_create_frame",
  "ifx_close_frame",
  "ifx_reset_frame",
  "ifx_let",
  "ifx_assert",
  "ifx_assert_multi",
  "ifx_patched_cpi",
  "ifx_if_else",
] as const;

function programLabel(programId: string, ifxProgramId?: string): string {
  if (ifxProgramId && programId === ifxProgramId) return "Ifx";
  return PROGRAM_LABELS[programId] ?? programId.slice(0, 8) + "…";
}

function discHex(data: Uint8Array, len = 8): string {
  return Buffer.from(data.slice(0, Math.min(len, data.length))).toString("hex");
}

function decodeInstructionHint(
  programId: string,
  data: Uint8Array,
  ifxProgramId?: string
): string | undefined {
  if (programId === "ComputeBudget111111111111111111111111111111") {
    if (data.length >= 5 && data[0] === 2) {
      const units = Buffer.from(data).readUInt32LE(1);
      return `SetComputeUnitLimit(${units.toLocaleString()} CU)`;
    }
    if (data.length >= 9 && data[0] === 3) {
      const micro = Buffer.from(data).readBigUInt64LE(1);
      return `SetComputeUnitPrice(${micro.toLocaleString()} µL/CU)`;
    }
    return undefined;
  }

  if (programId === "11111111111111111111111111111111" && data.length >= 4) {
    const kind = Buffer.from(data).readUInt32LE(0);
    if (kind === 2) return "Transfer";
    if (kind === 0) return "CreateAccount";
    return `System(${kind})`;
  }

  if (
    programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
    programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  ) {
    const ix = data[0];
    const tokenIx: Record<number, string> = {
      3: "Transfer",
      9: "CloseAccount",
      17: "SyncNative",
    };
    if (ix !== undefined && tokenIx[ix]) return tokenIx[ix];
  }

  if (programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") {
    if (data[0] === 1) return "CreateIdempotent";
  }

  if (programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
    const name = PUMP_IX[discHex(data, 8)];
    if (name) return name;
    return `Pump (disc ${discHex(data, 8)})`;
  }

  const isIfx =
    (ifxProgramId && programId === ifxProgramId) ||
    programId === "ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj" ||
    programId.startsWith("ifx");
  if (isIfx && data.length >= 1) {
    const name = IFX_IX[data[0]!];
    if (name) return name;
    return `Ifx (disc ${data[0]})`;
  }

  return undefined;
}

function accountMetaFlags(
  keyIndex: number,
  staticKeyCount: number,
  loadedWritable: number,
  header: {
    numRequiredSignatures: number;
    numReadonlySignedAccounts: number;
    numReadonlyUnsignedAccounts: number;
  }
): { isSigner: boolean; isWritable: boolean } {
  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } =
    header;

  if (keyIndex < staticKeyCount) {
    const isSigner = keyIndex < numRequiredSignatures;
    if (isSigner) {
      return {
        isSigner: true,
        isWritable: keyIndex < numRequiredSignatures - numReadonlySignedAccounts,
      };
    }
    const unsignedIdx = keyIndex - numRequiredSignatures;
    const numUnsigned = staticKeyCount - numRequiredSignatures;
    return {
      isSigner: false,
      isWritable:
        unsignedIdx < numUnsigned - numReadonlyUnsignedAccounts,
    };
  }

  const loadedIdx = keyIndex - staticKeyCount;
  if (loadedIdx < loadedWritable) {
    return { isSigner: false, isWritable: true };
  }
  return { isSigner: false, isWritable: false };
}

function accountKeyResolution(
  keyIndex: number,
  staticKeyCount: number,
  loadedWritable: number
): "alt-writable" | "alt-readonly" | "static" {
  if (keyIndex < staticKeyCount) return "static";
  const loadedIdx = keyIndex - staticKeyCount;
  if (loadedIdx < loadedWritable) return "alt-writable";
  return "alt-readonly";
}

function buildAltTableAddressSet(
  lookupTables: AddressLookupTableAccount[]
): Set<string> {
  const set = new Set<string>();
  for (const table of lookupTables) {
    for (const addr of table.state.addresses) {
      set.add(addr.toBase58());
    }
  }
  return set;
}

export function inspectVersionedTransaction(
  tx: VersionedTransaction,
  lookupTables: AddressLookupTableAccount[],
  opts?: {
    ifxProgramId?: string;
    frameUsed?: string;
    feePayer?: string;
    smartCloseApplied?: boolean;
    transactionSizeBytes?: number;
    addressLookupTableAddresses?: string[];
  }
): TxInspection {
  const message = tx.message;
  const accountKeys = message.getAccountKeys({
    addressLookupTableAccounts: lookupTables,
  });

  const staticKeyCount = message.staticAccountKeys.length;
  const loadedWritable = message.addressTableLookups.reduce(
    (n, l) => n + l.writableIndexes.length,
    0
  );
  const loadedReadonly = message.addressTableLookups.reduce(
    (n, l) => n + l.readonlyIndexes.length,
    0
  );
  const altTableAddresses = buildAltTableAddressSet(lookupTables);

  const instructions: TxInstructionInspection[] = message.compiledInstructions.map(
    (ix, index) => {
      const programId = accountKeys.get(ix.programIdIndex)!.toBase58();
      const data = Buffer.from(ix.data);
      const accounts = ix.accountKeyIndexes.map((keyIndex) => {
        const flags = accountMetaFlags(
          keyIndex,
          staticKeyCount,
          loadedWritable,
          message.header
        );
        const pubkey = accountKeys.get(keyIndex)!.toBase58();
        const resolution = accountKeyResolution(
          keyIndex,
          staticKeyCount,
          loadedWritable
        );
        const inAltTable = altTableAddresses.has(pubkey);
        return {
          index: keyIndex,
          pubkey,
          isSigner: flags.isSigner,
          isWritable: flags.isWritable,
          /** Resolved via ALT lookup (v0 size win). */
          altLoaded: resolution !== "static",
          resolution,
          /** Pubkey is listed in a configured ALT but serialized static in this tx. */
          inAltTableUnused: resolution === "static" && inAltTable,
        };
      });

      const hint = decodeInstructionHint(programId, data, opts?.ifxProgramId);

      return {
        index,
        programId,
        programLabel: programLabel(programId, opts?.ifxProgramId),
        hint,
        accounts,
        dataHex: data.toString("hex"),
        dataBase64: data.toString("base64"),
        dataLength: data.length,
      };
    }
  );

  return {
    version: 0,
    numInstructions: instructions.length,
    staticAccountKeys: staticKeyCount,
    loadedWritableAccounts: loadedWritable,
    loadedReadonlyAccounts: loadedReadonly,
    totalAccountKeys: accountKeys.length,
    addressLookupTables: opts?.addressLookupTableAddresses ?? [],
    frameUsed: opts?.frameUsed,
    feePayer: opts?.feePayer,
    smartCloseApplied: opts?.smartCloseApplied,
    transactionSizeBytes: opts?.transactionSizeBytes,
    instructions,
  };
}
