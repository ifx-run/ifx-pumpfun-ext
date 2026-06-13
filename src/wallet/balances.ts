import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import type { Connection, AccountInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { AppConfig } from "../config/types.js";
import type { TokenMeta, TradeMode, TradeSide } from "../types/api.js";
import { formatRawToUi } from "../util/amount.js";
import { userBaseAta } from "../pump/instructions.js";

export type WalletBalances = {
  solRaw: string;
  solUi: string;
  usdcRaw: string;
  usdcUi: string;
  baseA?: {
    raw: string;
    ui: string;
    decimals: number;
  };
};

export type InputLimitHint = {
  /** Asset the input amount is denominated in. */
  asset: "SOL" | "USDC" | "base";
  maxInputRaw: string;
  maxInputUi: string;
  exceedsBalance: boolean;
  hint: string | null;
};

function readSplAmount(
  ata: PublicKey,
  info: AccountInfo<Buffer> | null | undefined
): bigint {
  if (!info) return 0n;
  try {
    const acc = unpackAccount(ata, info, info.owner);
    return BigInt(acc.amount.toString());
  } catch {
    return 0n;
  }
}

/** SOL native + USDC ATA (+ optional base mint A ATA). Two RPC calls in parallel. */
export async function fetchWalletBalances(
  connection: Connection,
  config: AppConfig,
  user: PublicKey,
  baseToken?: Pick<TokenMeta, "mint" | "decimals" | "tokenProgram">
): Promise<WalletBalances> {
  const usdcMint = new PublicKey(config.pump.usdcMint);
  const usdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    user,
    false,
    TOKEN_PROGRAM_ID
  );

  const tokenKeys: PublicKey[] = [usdcAta];
  let baseAta: PublicKey | undefined;
  if (baseToken) {
    baseAta = userBaseAta(
      new PublicKey(baseToken.mint),
      user,
      new PublicKey(baseToken.tokenProgram)
    );
    tokenKeys.push(baseAta);
  }

  const [solLamports, tokenInfos] = await Promise.all([
    connection.getBalance(user, "confirmed"),
    connection.getMultipleAccountsInfo(tokenKeys, "confirmed"),
  ]);

  const usdcRaw = readSplAmount(usdcAta, tokenInfos[0] ?? null);
  const baseRaw =
    baseAta && tokenInfos[1]
      ? readSplAmount(baseAta, tokenInfos[1])
      : baseAta
        ? 0n
        : undefined;

  const out: WalletBalances = {
    solRaw: solLamports.toString(),
    solUi: formatRawToUi(BigInt(solLamports), 9),
    usdcRaw: usdcRaw.toString(),
    usdcUi: formatRawToUi(usdcRaw, 6),
  };

  if (baseToken && baseRaw !== undefined) {
    out.baseA = {
      raw: baseRaw.toString(),
      ui: formatRawToUi(baseRaw, baseToken.decimals),
      decimals: baseToken.decimals,
    };
  }

  return out;
}

export function computeInputLimit(opts: {
  mode: TradeMode;
  side: TradeSide;
  tokenA: TokenMeta;
  inputRaw: bigint;
  wallet: WalletBalances;
  sponsorEnabled: boolean;
}): InputLimitHint {
  const { mode, side, tokenA, inputRaw, wallet, sponsorEnabled } = opts;

  let asset: InputLimitHint["asset"];
  let maxRaw: bigint;
  let maxUi: string;
  let assetLabel: string;

  if (mode === "swap" || side === "sell") {
    asset = "base";
    maxRaw = BigInt(wallet.baseA?.raw ?? "0");
    maxUi = wallet.baseA?.ui ?? "0";
    assetLabel = "token A";
  } else if (tokenA.quoteLabel === "SOL") {
    asset = "SOL";
    maxRaw = BigInt(wallet.solRaw);
    maxUi = wallet.solUi;
    assetLabel = "SOL";
  } else {
    asset = "USDC";
    maxRaw = BigInt(wallet.usdcRaw);
    maxUi = wallet.usdcUi;
    assetLabel = "USDC";
  }

  const exceedsBalance = inputRaw > maxRaw;
  let hint: string | null = null;

  if (exceedsBalance) {
    hint = `Input exceeds ${assetLabel} balance (max ${maxUi})`;
  } else if (
    side === "buy" &&
    tokenA.quoteLabel === "SOL" &&
    !sponsorEnabled &&
    maxRaw > 0n
  ) {
    hint = `SOL balance ${wallet.solUi} — fee payer is your wallet; leave headroom for tx fees`;
  } else if (maxRaw === 0n) {
    hint = `No ${assetLabel} balance available for this trade`;
  }

  return {
    asset,
    maxInputRaw: maxRaw.toString(),
    maxInputUi: maxUi,
    exceedsBalance,
    hint,
  };
}
