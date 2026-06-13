import BN from "bn.js";
import {
  OnlinePumpSdk as OnlinePumpSdkClass,
  PUMP_SDK,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  isLegacyQuoteMint,
  type BondingCurve,
  type FeeConfig,
  type Global,
  type OnlinePumpSdk,
} from "./sdk.js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";

import type { AppConfig } from "../config/types.js";
import { fetchAccountsMap } from "../solana/batch.js";
import type { QuoteLabel, TokenMeta } from "../types/api.js";

export type PumpSharedState = {
  global: Global;
  feeConfig: FeeConfig;
};

export class PumpContext {
  readonly online: OnlinePumpSdk;
  private globalCache: { at: number; value: PumpSharedState } | null = null;

  constructor(
    readonly connection: Connection,
    readonly config: AppConfig
  ) {
    this.online = new OnlinePumpSdkClass(connection);
  }

  async getSharedState(): Promise<PumpSharedState> {
    const now = Date.now();
    if (
      this.globalCache &&
      now - this.globalCache.at < this.config.rpcCacheTtlMs
    ) {
      return this.globalCache.value;
    }
    const [global, feeConfig] = await Promise.all([
      this.online.fetchGlobal(),
      this.online.fetchFeeConfig(),
    ]);
    const value = { global, feeConfig };
    this.globalCache = { at: now, value };
    return value;
  }

  usdcMintPk(): PublicKey {
    return new PublicKey(this.config.pump.usdcMint);
  }

  resolveQuoteLabel(quoteMint: PublicKey): QuoteLabel {
    if (isLegacyQuoteMint(quoteMint)) return "SOL";
    if (quoteMint.equals(this.usdcMintPk())) return "USDC";
    throw new Error(`unsupported quote mint: ${quoteMint.toBase58()}`);
  }

  effectiveQuoteMint(curve: BondingCurve): PublicKey {
    return isLegacyQuoteMint(curve.quoteMint)
      ? new PublicKey(this.config.pump.nativeMint)
      : curve.quoteMint;
  }

  async loadTokenMeta(mint: PublicKey): Promise<TokenMeta> {
    const bcPk = bondingCurvePda(mint);
    const accounts = await fetchAccountsMap(this.connection, [mint, bcPk]);
    const mintInfo = accounts.get(mint.toBase58());
    const bcInfo = accounts.get(bcPk.toBase58());

    if (!mintInfo) throw new Error(`mint not found: ${mint.toBase58()}`);
    if (!bcInfo) throw new Error(`bonding curve not found for ${mint.toBase58()}`);

    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);
    if (bondingCurve.complete) {
      throw new Error(`token graduated (bonding curve complete): ${mint.toBase58()}`);
    }

    const mintDecoded = unpackMint(mint, mintInfo, mintInfo.owner);
    const quoteMint = this.effectiveQuoteMint(bondingCurve);

    return {
      mint: mint.toBase58(),
      quoteMint: quoteMint.toBase58(),
      quoteLabel: this.resolveQuoteLabel(bondingCurve.quoteMint),
      decimals: mintDecoded.decimals,
      tokenProgram: mintInfo.owner.toBase58(),
      bondingCurve: bcPk.toBase58(),
      complete: bondingCurve.complete,
      creator: bondingCurve.creator.toBase58(),
    };
  }

  decodeBondingCurveFromChain(mint: PublicKey): Promise<BondingCurve> {
    return this.online.fetchBondingCurve(mint);
  }

  quoteDecimals(label: QuoteLabel): number {
    return label === "SOL" ? 9 : 6;
  }

  isToken2022(program: string): boolean {
    return program === TOKEN_2022_PROGRAM_ID.toBase58();
  }

  tokenProgramId(program: string): PublicKey {
    return program === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
  }

  async estimateBuyBaseOut(
    mint: PublicKey,
    quoteInRaw: bigint,
    quoteMint: PublicKey
  ): Promise<bigint> {
    const { global, feeConfig } = await this.getSharedState();
    const bondingCurve = await this.online.fetchBondingCurve(mint);
    const out = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: new BN(quoteInRaw.toString()),
      quoteMint,
    });
    return BigInt(out.toString());
  }

  async estimateSellQuoteOut(
    mint: PublicKey,
    baseInRaw: bigint
  ): Promise<bigint> {
    const { global, feeConfig } = await this.getSharedState();
    const bondingCurve = await this.online.fetchBondingCurve(mint);
    const out = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: new BN(baseInRaw.toString()),
    });
    return BigInt(out.toString());
  }
}

export function sameQuote(a: TokenMeta, b: TokenMeta): boolean {
  return a.quoteMint === b.quoteMint && a.quoteLabel === b.quoteLabel;
}
