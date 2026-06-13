import { createRequire } from "node:module";

// pump-sdk's ESM bundle pulls CJS deps (@coral-xyz/anchor) with broken named exports.
const require = createRequire(import.meta.url);
const pumpSdk = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");

export const OnlinePumpSdk = pumpSdk.OnlinePumpSdk;
export const PUMP_SDK = pumpSdk.PUMP_SDK;
export const PUMP_PROGRAM_ID = pumpSdk.PUMP_PROGRAM_ID;
export const bondingCurvePda = pumpSdk.bondingCurvePda;
export const creatorVaultPda = pumpSdk.creatorVaultPda;
export const userVolumeAccumulatorPda = pumpSdk.userVolumeAccumulatorPda;
export const quoteAta = pumpSdk.quoteAta;
export const getPumpProgram = pumpSdk.getPumpProgram;
export const getBuyTokenAmountFromSolAmount = pumpSdk.getBuyTokenAmountFromSolAmount;
export const getSellSolAmountFromTokenAmount = pumpSdk.getSellSolAmountFromTokenAmount;
export const isLegacyQuoteMint = pumpSdk.isLegacyQuoteMint;

export type OnlinePumpSdk = InstanceType<typeof pumpSdk.OnlinePumpSdk>;

export type {
  BondingCurve,
  FeeConfig,
  Global,
} from "@pump-fun/pump-sdk";
