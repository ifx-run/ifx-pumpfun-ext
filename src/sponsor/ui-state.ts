import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import type {
  QuoteLabel,
  QuoteResponse,
  SponsorDetails,
  SponsorUiState,
  TradeMode,
  TradeSide,
} from "../types/api.js";
import { sellMinQuoteForSwap } from "../ifx/planner/swap.js";
import { applyBps, formatRawToUi } from "../util/amount.js";
import type { AtaSpec } from "./ata-specs.js";
import {
  computeTxFeeLamports,
  sponsorTxSignatureCount,
} from "./fees.js";
import {
  applyRepayBuffer,
  inactiveSponsorPlan,
  resolveSponsorPlan,
  type SponsorPlan,
} from "./plan.js";
import { sumMissingAtaRent } from "./rent.js";

export const GAS_INSUFFICIENT_ERROR =
  "Insufficient SOL for transaction gas and rent — wallet balance is too low and trade proceeds cannot cover fees";

export function isSponsorEligibleRoute(
  config: AppConfig,
  mode: TradeMode,
  side: TradeSide,
  quoteLabel: QuoteLabel
): boolean {
  if (!config.sponsor.enabled || quoteLabel !== "SOL") return false;
  if (mode === "swap") return false;
  return side === "sell";
}

export function sponsorUiForBuy(config: AppConfig, quoteLabel: QuoteLabel): SponsorUiState {
  if (!config.sponsor.enabled || quoteLabel !== "SOL") {
    return { visible: false, mode: "hidden", enabled: false, readonly: true };
  }
  return {
    visible: true,
    mode: "readonly_off",
    enabled: false,
    readonly: true,
    hint: "Sponsored gas is not available for buys — you pay gas and rent",
  };
}

export function sponsorUiForSwap(
  config: AppConfig,
  quoteLabel: QuoteLabel
): SponsorUiState {
  if (!config.sponsor.enabled || quoteLabel !== "SOL") {
    return { visible: false, mode: "hidden", enabled: false, readonly: true };
  }
  return {
    visible: true,
    mode: "readonly_off",
    enabled: false,
    readonly: true,
    hint: "Sponsored gas is not available for swaps — you pay gas and rent",
  };
}

export function sponsorUiHidden(): SponsorUiState {
  return { visible: false, mode: "hidden", enabled: false, readonly: true };
}

function minProceedsForRepay(
  quote: QuoteResponse,
  mode: TradeMode,
  side: TradeSide,
  slippageBps: number
): bigint {
  if (mode === "swap") {
    const quoteDeltaEst =
      BigInt(quote.serviceFeeRaw) + BigInt(quote.netQuoteRaw);
    return sellMinQuoteForSwap(quoteDeltaEst, slippageBps);
  }
  if (side === "sell") {
    return BigInt(quote.minOutputRaw);
  }
  return 0n;
}

function proceedsCoverRepay(
  minProceeds: bigint,
  serviceFeeRaw: bigint,
  repayLamports: bigint
): boolean {
  return minProceeds - serviceFeeRaw >= repayLamports;
}

/** Min net SOL the user keeps after platform fee (slippage-adjusted gross proceeds). */
function estimatedMinNetReceive(
  quote: QuoteResponse,
  mode: TradeMode,
  side: TradeSide,
  slippageBps: number,
  serviceFeeBps: number
): bigint {
  const minGross = minProceedsForRepay(quote, mode, side, slippageBps);
  const feeOnMin = applyBps(minGross, serviceFeeBps);
  return minGross > feeOnMin ? minGross - feeOnMin : 0n;
}

const REPAY_WARN_NUM = 10n;
const REPAY_WARN_DEN = 100n;

function buildRepayWarning(
  repayLamports: bigint,
  minNetReceive: bigint
): string | undefined {
  if (minNetReceive <= 0n) return undefined;
  if (repayLamports * REPAY_WARN_DEN <= minNetReceive * REPAY_WARN_NUM) {
    return undefined;
  }
  const repayUi = formatRawToUi(repayLamports, 9);
  const minUi = formatRawToUi(minNetReceive, 9);
  const pct =
    Number((repayLamports * 10000n) / minNetReceive) / 100;
  return `Sponsor repay (~${repayUi} SOL) exceeds 10% of your estimated minimum receive (~${minUi} SOL) — about ${pct.toFixed(1)}% of min receive. Estimate only; not enforced on-chain.`;
}

export type SponsorDecision = {
  sponsorUi: SponsorUiState;
  useSponsor: boolean;
  plan: SponsorPlan;
  details?: SponsorDetails;
};

/** Resolve user sponsor toggle state, effective plan, and UI metadata for sell SOL routes. */
export async function resolveSponsorDecision(
  connection: Connection,
  config: AppConfig,
  opts: {
    mode: TradeMode;
    side: TradeSide;
    quote: QuoteResponse;
    slippageBps: number;
    priorityTier: PriorityTier;
    user: PublicKey;
    walletSolRaw: bigint;
    bootstrapSpecs: AtaSpec[];
    useSponsorRequest?: boolean;
  }
): Promise<SponsorDecision> {
  const { mode, side, quote, slippageBps, priorityTier, user, walletSolRaw } =
    opts;
  const quoteLabel = quote.serviceFeeLabel;

  if (!isSponsorEligibleRoute(config, mode, side, quoteLabel)) {
    return {
      sponsorUi: sponsorUiHidden(),
      useSponsor: false,
      plan: inactiveSponsorPlan(config),
    };
  }

  const userTxFee = computeTxFeeLamports(config, priorityTier, 1);
  const missingAtaRent = await sumMissingAtaRent(
    connection,
    user,
    opts.bootstrapSpecs
  );
  const userSelfPayLamports = userTxFee + missingAtaRent;
  const userCanSelfPay = walletSolRaw >= userSelfPayLamports;

  let useSponsor: boolean;
  if (!userCanSelfPay) {
    useSponsor = true;
  } else if (opts.useSponsorRequest === true) {
    useSponsor = true;
  } else {
    useSponsor = false;
  }

  const sponsorUi: SponsorUiState = {
    visible: true,
    mode: userCanSelfPay ? "optional" : "forced",
    enabled: useSponsor,
    readonly: !userCanSelfPay,
    hint: userCanSelfPay
      ? "Pay gas from your wallet, or enable to repay sponsor from trade proceeds"
      : "Wallet SOL too low for gas and rent — repaid from trade proceeds",
  };

  if (!useSponsor) {
    if (!userCanSelfPay) {
      throw new Error(GAS_INSUFFICIENT_ERROR);
    }
    return {
      sponsorUi,
      useSponsor: false,
      plan: inactiveSponsorPlan(config),
      details: {
        pubkey: config.sponsor.pubkey,
        active: false,
        feePayer: "user",
        settleLamports: "0",
        repayLamports: "0",
        txFeeLamports: userTxFee.toString(),
        missingAtaRentLamports: missingAtaRent.toString(),
        userSelfPayLamports: userSelfPayLamports.toString(),
        repaidFrom: null,
      },
    };
  }

  const plan = await resolveSponsorPlan(connection, config, {
    quoteLabel,
    priorityTier,
    user,
    bootstrapSpecs: opts.bootstrapSpecs,
    useSponsor: true,
  });

  if (!plan.active) {
    throw new Error(GAS_INSUFFICIENT_ERROR);
  }

  const minProceeds = minProceedsForRepay(quote, mode, side, slippageBps);
  const feeOnMin = applyBps(minProceeds, config.serviceFee.bps);
  if (!proceedsCoverRepay(minProceeds, feeOnMin, plan.repayLamports)) {
    throw new Error(GAS_INSUFFICIENT_ERROR);
  }

  const minNetReceive = estimatedMinNetReceive(
    quote,
    mode,
    side,
    slippageBps,
    config.serviceFee.bps
  );
  const repayWarning = buildRepayWarning(plan.repayLamports, minNetReceive);

  return {
    sponsorUi,
    useSponsor: true,
    plan,
    details: {
      pubkey: plan.pubkey.toBase58(),
      active: true,
      feePayer: "sponsor",
      settleLamports: plan.settleLamports.toString(),
      repayLamports: plan.repayLamports.toString(),
      txFeeLamports: plan.txFeeLamports.toString(),
      missingAtaRentLamports: plan.missingAtaRentLamports.toString(),
      userSelfPayLamports: userSelfPayLamports.toString(),
      repaidFrom: "trade_output",
      ...(repayWarning ? { repayWarning } : {}),
    },
  };
}

export function appendSponsorRouteTags(
  route: string[],
  _mode: TradeMode,
  _side: TradeSide,
  useSponsor: boolean
): string[] {
  if (!useSponsor) return route;
  return [...route, "sponsor.repay"];
}

/** Sponsor settle/repay estimate for UI when plan is not fully resolved (no wallet). */
export async function estimateSponsorRepayLamports(
  connection: Connection,
  config: AppConfig,
  opts: {
    priorityTier: PriorityTier;
    user: PublicKey;
    bootstrapSpecs: AtaSpec[];
  }
): Promise<bigint> {
  const missingAtaRent = await sumMissingAtaRent(
    connection,
    opts.user,
    opts.bootstrapSpecs
  );
  const txFeeLamports = computeTxFeeLamports(
    config,
    opts.priorityTier,
    sponsorTxSignatureCount()
  );
  const settle = missingAtaRent + txFeeLamports;
  return applyRepayBuffer(settle, config.sponsor.repayBufferPercent);
}
