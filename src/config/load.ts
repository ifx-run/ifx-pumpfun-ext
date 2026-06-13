import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { parse as parseToml } from "smol-toml";
import { PublicKey } from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "./types.js";
import {
  keypairFileExists,
  loadKeypairFromFile,
  resolveKeypairPath,
} from "./keypair.js";

const DEFAULT_CONFIG_PATHS = [
  resolve(process.cwd(), "config.toml"),
  resolve(process.cwd(), "config.json"),
];

function readJsonConfig(path: string): Partial<AppConfig> {
  return JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

type PriorityFeeTierPartial = {
  microLamports: number;
  computeUnitLimit: number;
};

function tier(v: unknown): PriorityFeeTierPartial | undefined {
  const o = asRecord(v);
  if (!o) return undefined;
  const microLamports = num(o.microLamports ?? o.micro_lamports);
  const computeUnitLimit = num(o.computeUnitLimit ?? o.compute_unit_limit);
  if (microLamports === undefined || computeUnitLimit === undefined) return undefined;
  return { microLamports, computeUnitLimit };
}

function readTomlConfig(path: string): Partial<AppConfig> {
  const raw = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
  const server = asRecord(raw.server);
  const solana = asRecord(raw.solana ?? raw.rpc);
  const ifx = asRecord(raw.ifx);
  const pump = asRecord(raw.pump);
  const priorityFee = asRecord(raw.priorityFee ?? raw.priority_fee);
  const sponsor = asRecord(raw.sponsor);
  const serviceFee = asRecord(raw.serviceFee ?? raw.service_fee);
  const quote = asRecord(raw.quote);

  const partial: Partial<AppConfig> = {};

  if (server) {
    partial.server = {
      host: str(server.host) ?? "127.0.0.1",
      port: num(server.port) ?? 8787,
    };
  }

  if (solana) {
    partial.solana = {
      rpcUrl: str(solana.rpcUrl ?? solana.url ?? solana.rpc_url) ?? "",
      commitment:
        (str(solana.commitment) as AppConfig["solana"]["commitment"]) ?? "confirmed",
    };
  }

  if (ifx) {
    const frames = ifx.publicFrames ?? ifx.public_frames;
    partial.ifx = {
      programId: str(ifx.programId ?? ifx.program_id) ?? "",
      publicFrames: Array.isArray(frames)
        ? frames.filter((f): f is string => typeof f === "string")
        : [],
    };
  }

  if (pump) {
    partial.pump = {
      usdcMint: str(pump.usdcMint ?? pump.usdc_mint) ?? "",
      nativeMint: str(pump.nativeMint ?? pump.native_mint) ?? "",
    };
  }

  if (priorityFee) {
    const low = tier(priorityFee.low);
    const medium = tier(priorityFee.medium);
    const high = tier(priorityFee.high);
    const defaultTier = str(priorityFee.defaultTier ?? priorityFee.default_tier);
    if (low && medium && high && defaultTier) {
      partial.priorityFee = {
        low,
        medium,
        high,
        defaultTier: defaultTier as PriorityTier,
      };
    }
  }

  if (sponsor) {
    partial.sponsor = {
      enabled: sponsor.enabled === true,
      pubkey: str(sponsor.pubkey) ?? "",
      keypairPath: str(sponsor.keypairPath ?? sponsor.keypair_path),
      minUserSolLamports:
        num(sponsor.minUserSolLamports ?? sponsor.min_user_sol_lamports) ?? 0,
      repayBufferPercent:
        num(sponsor.repayBufferPercent ?? sponsor.repay_margin_bps ?? sponsor.repay_buffer_percent) ??
        0,
      estimatedAtaRentLamports:
        num(sponsor.estimatedAtaRentLamports ?? sponsor.estimated_ata_rent_lamports) ?? 0,
      estimatedTxFeeLamports:
        num(sponsor.estimatedTxFeeLamports ?? sponsor.estimated_tx_fee_lamports) ?? 0,
    };
  }

  if (serviceFee) {
    partial.serviceFee = {
      bps: num(serviceFee.bps) ?? 0,
      pubkey: str(serviceFee.pubkey ?? serviceFee.recipient_pubkey) ?? "",
    };
  }

  if (quote) {
    partial.quote = {
      debounceMs: num(quote.debounceMs ?? quote.debounce_ms) ?? 300,
      defaultSlippageBps:
        num(quote.defaultSlippageBps ?? quote.default_slippage_bps) ?? 100,
    };
  }

  const cacheTtl = num(raw.rpcCacheTtlMs ?? raw.rpc_cache_ttl_ms);
  if (cacheTtl !== undefined) partial.rpcCacheTtlMs = cacheTtl;

  return partial;
}

function readConfigFile(path: string): Partial<AppConfig> {
  return extname(path) === ".toml" ? readTomlConfig(path) : readJsonConfig(path);
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function envStr(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** Deep-merge partial config onto defaults. */
function mergeConfig(base: AppConfig, partial: Partial<AppConfig>): AppConfig {
  return {
    server: { ...base.server, ...partial.server },
    solana: { ...base.solana, ...partial.solana },
    ifx: { ...base.ifx, ...partial.ifx },
    pump: { ...base.pump, ...partial.pump },
    priorityFee: {
      ...base.priorityFee,
      ...partial.priorityFee,
      low: { ...base.priorityFee.low, ...partial.priorityFee?.low },
      medium: { ...base.priorityFee.medium, ...partial.priorityFee?.medium },
      high: { ...base.priorityFee.high, ...partial.priorityFee?.high },
    },
    sponsor: { ...base.sponsor, ...partial.sponsor },
    serviceFee: { ...base.serviceFee, ...partial.serviceFee },
    quote: { ...base.quote, ...partial.quote },
    rpcCacheTtlMs: partial.rpcCacheTtlMs ?? base.rpcCacheTtlMs,
  };
}

export function defaultConfig(): AppConfig {
  return {
    server: { host: "127.0.0.1", port: 8787 },
    solana: {
      rpcUrl: "https://api.mainnet-beta.solana.com",
      commitment: "confirmed",
    },
    ifx: {
      programId: "ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj",
      publicFrames: ["6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn"],
    },
    pump: {
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      nativeMint: "So11111111111111111111111111111111111111112",
    },
    priorityFee: {
      low: { microLamports: 1_000, computeUnitLimit: 400_000 },
      medium: { microLamports: 10_000, computeUnitLimit: 500_000 },
      high: { microLamports: 50_000, computeUnitLimit: 600_000 },
      defaultTier: "medium",
    },
    sponsor: {
      enabled: false,
      pubkey: "",
      minUserSolLamports: 5_000_000,
      repayBufferPercent: 10,
      estimatedAtaRentLamports: 2_039_280,
      estimatedTxFeeLamports: 15_000,
    },
    serviceFee: {
      bps: 5,
      pubkey: "",
    },
    quote: { debounceMs: 300, defaultSlippageBps: 100 },
    rpcCacheTtlMs: 2_000,
  };
}

function isValidPubkey(v: string): boolean {
  if (!v || v.includes("REPLACE_WITH")) return false;
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

function assertKeypairSection(
  label: "serviceFee" | "sponsor",
  pubkey: string,
  keypairPath: string | undefined,
  required: boolean
): void {
  if (!keypairPath) {
    if (required) {
      throw new Error(`${label}.keypairPath is required`);
    }
    return;
  }

  const abs = resolveKeypairPath(keypairPath);
  if (!keypairFileExists(keypairPath)) {
    throw new Error(`${label}.keypairPath not found: ${abs}`);
  }

  if (isValidPubkey(pubkey)) {
    const kp = loadKeypairFromFile(keypairPath);
    if (kp.publicKey.toBase58() !== pubkey) {
      throw new Error(
        `${label}: keypair at ${keypairPath} does not match configured pubkey ${pubkey}`
      );
    }
  }
}

function validateConfig(cfg: AppConfig): void {
  if (cfg.ifx.publicFrames.length === 0) {
    throw new Error("ifx.publicFrames must not be empty");
  }

  const tier = cfg.priorityFee.defaultTier;
  if (!["low", "medium", "high"].includes(tier)) {
    throw new Error(`invalid priorityFee.defaultTier: ${tier as string}`);
  }

  if (cfg.serviceFee.bps > 0 && !isValidPubkey(cfg.serviceFee.pubkey)) {
    throw new Error(
      "serviceFee.pubkey must be a valid base58 pubkey when serviceFee.bps > 0"
    );
  }

  if (cfg.sponsor.enabled && !isValidPubkey(cfg.sponsor.pubkey)) {
    throw new Error("sponsor.pubkey must be a valid base58 pubkey when sponsor.enabled is true");
  }

  assertKeypairSection(
    "sponsor",
    cfg.sponsor.pubkey,
    cfg.sponsor.keypairPath,
    cfg.sponsor.enabled
  );
}

export function loadConfig(): AppConfig {
  let cfg = defaultConfig();

  const configPath =
    envStr("IFX_PUMPFUN_CONFIG") ??
    DEFAULT_CONFIG_PATHS.find((p) => existsSync(p));

  if (configPath && existsSync(configPath)) {
    cfg = mergeConfig(cfg, readConfigFile(configPath));
  }

  const rpcUrl = envStr("IFX_PUMPFUN_RPC_URL");
  if (rpcUrl) cfg.solana.rpcUrl = rpcUrl;

  const port = envInt("IFX_PUMPFUN_PORT");
  if (port !== undefined) cfg.server.port = port;

  const feeBps = envInt("IFX_PUMPFUN_SERVICE_FEE_BPS");
  if (feeBps !== undefined) cfg.serviceFee.bps = feeBps;

  const feeRecipient = envStr("IFX_PUMPFUN_SERVICE_FEE_PUBKEY");
  if (feeRecipient) cfg.serviceFee.pubkey = feeRecipient;

  const sponsorPubkey = envStr("IFX_PUMPFUN_SPONSOR_PUBKEY");
  if (sponsorPubkey) cfg.sponsor.pubkey = sponsorPubkey;

  const sponsorKeypair = envStr("IFX_PUMPFUN_SPONSOR_KEYPAIR");
  if (sponsorKeypair) cfg.sponsor.keypairPath = sponsorKeypair;

  validateConfig(cfg);
  return cfg;
}

export function isPriorityTier(v: string): v is PriorityTier {
  return v === "low" || v === "medium" || v === "high";
}
