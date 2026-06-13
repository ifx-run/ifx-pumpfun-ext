import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import type { AppConfig } from "../config/types.js";
import type { TokenMeta } from "../types/api.js";
import { fetchAccountsMap } from "../solana/batch.js";
import type { PumpContext } from "./context.js";
import {
  bondingCurvePda,
  isLegacyQuoteMint,
  PUMP_SDK,
  type BondingCurve,
  type Global,
} from "./sdk.js";

export type TokenBuildAccounts = {
  token: TokenMeta;
  mint: PublicKey;
  global: Global;
  bondingCurve: BondingCurve;
  bondingCurveAccountInfo: AccountInfo<Buffer>;
  quoteMint: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
};

export async function loadTokenBuildAccounts(
  pump: PumpContext,
  config: AppConfig,
  mintStr: string
): Promise<TokenBuildAccounts> {
  const token = await pump.loadTokenMeta(new PublicKey(mintStr));
  const mint = new PublicKey(token.mint);
  const bcPk = bondingCurvePda(mint);
  const accounts = await fetchAccountsMap(pump.connection, [bcPk]);
  const bcInfo = accounts.get(bcPk.toBase58());
  if (!bcInfo) throw new Error(`bonding curve not found: ${bcPk.toBase58()}`);

  const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);
  const { global } = await pump.getSharedState();
  const quoteMint = isLegacyQuoteMint(bondingCurve.quoteMint)
    ? new PublicKey(config.pump.nativeMint)
    : bondingCurve.quoteMint;

  return {
    token,
    mint,
    global,
    bondingCurve,
    bondingCurveAccountInfo: bcInfo,
    quoteMint,
    baseTokenProgram: pump.tokenProgramId(token.tokenProgram),
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  };
}
