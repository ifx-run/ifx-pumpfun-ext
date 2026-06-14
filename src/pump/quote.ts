import { PublicKey } from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import type { QuoteRequest, QuoteResponse } from "../types/api.js";
import { formatRawToUi, applyBps, minOutRaw, parseAmountToRaw } from "../util/amount.js";
import type { PumpContext } from "./context.js";
import { resolveTokens } from "./resolve.js";
import { resolveBootstrapAtaSpecs } from "../sponsor/bootstrap-specs.js";
import {
  appendSponsorRouteTags,
  GAS_INSUFFICIENT_ERROR,
  isSponsorEligibleRoute,
  resolveSponsorDecision,
  sponsorUiForBuy,
  sponsorUiForSwap,
  sponsorUiHidden,
} from "../sponsor/ui-state.js";
import { computeTxFeeLamports } from "../sponsor/fees.js";
import { sumMissingAtaRent } from "../sponsor/rent.js";
import { sellMinQuoteForSwap } from "../ifx/planner/swap.js";
import {
  computeInputLimit,
  fetchWalletBalances,
} from "../wallet/balances.js";
import { effectiveTradeSide, isBuyTrade } from "./trade-side.js";
import type { TokenMeta } from "../types/api.js";

function serviceFeeRaw(basis: bigint, bps: number): bigint {
  return applyBps(basis, bps);
}

async function quoteBuy(
  pump: PumpContext,
  token: TokenMeta,
  inputAmount: string,
  slippageBps: number,
  serviceFeeBps: number
): Promise<QuoteResponse> {
  const quoteDecimals = pump.quoteDecimals(token.quoteLabel);
  const inputRaw = parseAmountToRaw(inputAmount, quoteDecimals);
  const fee = serviceFeeRaw(inputRaw, serviceFeeBps);
  if (fee >= inputRaw) {
    throw new Error("input too small after service fee");
  }
  const netQuote = inputRaw - fee;
  const quoteMint = new PublicKey(token.quoteMint);
  const expectedOut = await pump.estimateBuyBaseOut(
    new PublicKey(token.mint),
    netQuote,
    quoteMint
  );

  return {
    inputRaw: inputRaw.toString(),
    inputLabel: token.quoteLabel,
    expectedOutputRaw: expectedOut.toString(),
    expectedOutputUi: formatRawToUi(expectedOut, token.decimals),
    minOutputRaw: minOutRaw(expectedOut, slippageBps).toString(),
    serviceFeeRaw: fee.toString(),
    serviceFeeLabel: token.quoteLabel,
    netQuoteRaw: netQuote.toString(),
    route: ["service_fee", "pump.buy_exact_quote_in_v2"],
    ixKind: "buy_exact_quote_in_v2",
  };
}

async function quoteSell(
  pump: PumpContext,
  token: TokenMeta,
  inputAmount: string,
  slippageBps: number,
  serviceFeeBps: number
): Promise<QuoteResponse> {
  const inputRaw = parseAmountToRaw(inputAmount, token.decimals);
  const expectedQuote = await pump.estimateSellQuoteOut(
    new PublicKey(token.mint),
    inputRaw
  );
  const fee = serviceFeeRaw(expectedQuote, serviceFeeBps);
  const netQuote = expectedQuote > fee ? expectedQuote - fee : 0n;

  return {
    inputRaw: inputRaw.toString(),
    inputLabel: "base",
    expectedOutputRaw: expectedQuote.toString(),
    expectedOutputUi: formatRawToUi(
      expectedQuote,
      pump.quoteDecimals(token.quoteLabel)
    ),
    minOutputRaw: minOutRaw(expectedQuote, slippageBps).toString(),
    serviceFeeRaw: fee.toString(),
    serviceFeeLabel: token.quoteLabel,
    netQuoteRaw: netQuote.toString(),
    route: ["pump.sell_v2", "service_fee", "ifx.smart_close?"],
    ixKind: "sell_v2",
  };
}

async function quoteSwap(
  pump: PumpContext,
  tokenA: TokenMeta,
  tokenB: TokenMeta,
  inputAmount: string,
  slippageBps: number,
  serviceFeeBps: number
): Promise<QuoteResponse> {
  const inputRaw = parseAmountToRaw(inputAmount, tokenA.decimals);
  const quoteDelta = await pump.estimateSellQuoteOut(
    new PublicKey(tokenA.mint),
    inputRaw
  );
  const fee = serviceFeeRaw(quoteDelta, serviceFeeBps);
  if (fee >= quoteDelta) {
    throw new Error("swap quote output too small after service fee");
  }
  const netQuote = quoteDelta - fee;
  const quoteMint = new PublicKey(tokenA.quoteMint);
  const expectedB = await pump.estimateBuyBaseOut(
    new PublicKey(tokenB.mint),
    netQuote,
    quoteMint
  );

  return {
    inputRaw: inputRaw.toString(),
    inputLabel: "base",
    expectedOutputRaw: expectedB.toString(),
    expectedOutputUi: formatRawToUi(expectedB, tokenB.decimals),
    minOutputRaw: minOutRaw(expectedB, slippageBps).toString(),
    serviceFeeRaw: fee.toString(),
    serviceFeeLabel: tokenA.quoteLabel as QuoteResponse["serviceFeeLabel"],
    netQuoteRaw: netQuote.toString(),
    route: [
      "pump.sell_v2",
      "service_fee",
      "ifx.let",
      "pump.buy_exact_quote_in_v2.patched",
      "ifx.smart_close?",
    ],
    ixKind: "swap_a_b",
  };
}

async function attachSponsorFields(
  pump: PumpContext,
  config: AppConfig,
  req: QuoteRequest,
  response: QuoteResponse,
  side: "buy" | "sell",
  slippageBps: number,
  priorityTier: PriorityTier,
  walletSolRaw?: bigint
): Promise<QuoteResponse> {
  const quoteLabel = response.serviceFeeLabel;

  if (isBuyTrade(req.mode, side)) {
    return {
      ...response,
      sponsorUi: sponsorUiForBuy(config, quoteLabel),
    };
  }

  if (req.mode === "swap") {
    const sponsorUi = sponsorUiForSwap(config, quoteLabel);
    if (!req.userPubkey || walletSolRaw === undefined) {
      return { ...response, sponsorUi };
    }

    const bootstrapSpecs = await resolveBootstrapAtaSpecs(pump, config, {
      mode: req.mode,
      side,
      mintA: req.mintA,
      mintB: req.mintB,
    });
    const userTxFee = computeTxFeeLamports(config, priorityTier, 1);
    const missingAtaRent = await sumMissingAtaRent(
      pump.connection,
      new PublicKey(req.userPubkey),
      bootstrapSpecs
    );
    const userSelfPayLamports = userTxFee + missingAtaRent;
    if (walletSolRaw < userSelfPayLamports) {
      throw new Error(GAS_INSUFFICIENT_ERROR);
    }

    return {
      ...response,
      sponsorUi,
      sponsor: {
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

  if (!isSponsorEligibleRoute(config, req.mode, side, quoteLabel)) {
    return {
      ...response,
      sponsorUi: sponsorUiHidden(),
    };
  }

  if (!req.userPubkey || walletSolRaw === undefined) {
    return {
      ...response,
      sponsorUi: {
        visible: true,
        mode: "optional",
        enabled: false,
        readonly: false,
        hint: "Connect wallet to estimate gas and sponsored repay",
      },
    };
  }

  const bootstrapSpecs = await resolveBootstrapAtaSpecs(pump, config, {
    mode: req.mode,
    side,
    mintA: req.mintA,
    mintB: req.mintB,
  });

  const decision = await resolveSponsorDecision(pump.connection, config, {
    mode: req.mode,
    side,
    quote: response,
    slippageBps,
    priorityTier,
    user: new PublicKey(req.userPubkey),
    walletSolRaw,
    bootstrapSpecs,
    useSponsorRequest: req.useSponsor,
  });

  return {
    ...response,
    route: appendSponsorRouteTags(response.route, req.mode, side, decision.useSponsor),
    sponsorUi: decision.sponsorUi,
    ...(decision.details ? { sponsor: decision.details } : {}),
  };
}

export async function quoteTrade(
  pump: PumpContext,
  config: AppConfig,
  req: QuoteRequest
): Promise<QuoteResponse> {
  const resolved = await resolveTokens(
    pump,
    config,
    req.mintA,
    req.mintB,
    req.userPubkey
  );
  const slippageBps = req.slippageBps;
  const serviceFeeBps = config.serviceFee.bps;
  const side = effectiveTradeSide(req.mode, req.side);
  const priorityTier = (req.priorityTier ??
    config.priorityFee.defaultTier) as PriorityTier;

  let response: QuoteResponse;

  if (req.mode === "swap") {
    if (!req.mintB) throw new Error("mintB required for swap mode");
    if (!resolved.tokenB) throw new Error("tokenB resolve failed");
    if (!resolved.swapEligible) {
      throw new Error(resolved.swapIneligibleReason ?? "swap not eligible");
    }
    response = await quoteSwap(
      pump,
      resolved.tokenA,
      resolved.tokenB,
      req.inputAmount,
      slippageBps,
      serviceFeeBps
    );
  } else if (side === "buy") {
    response = await quoteBuy(
      pump,
      resolved.tokenA,
      req.inputAmount,
      slippageBps,
      serviceFeeBps
    );
  } else {
    response = await quoteSell(
      pump,
      resolved.tokenA,
      req.inputAmount,
      slippageBps,
      serviceFeeBps
    );
  }

  let result: QuoteResponse = response;
  let walletSolRaw: bigint | undefined;

  if (req.userPubkey) {
    const needsBase = req.mode === "swap" || side === "sell";
    const wallet =
      resolved.wallet ??
      (await fetchWalletBalances(
        pump.connection,
        config,
        new PublicKey(req.userPubkey),
        needsBase ? resolved.tokenA : undefined
      ));
    walletSolRaw = BigInt(wallet.solRaw);
    const inputLimit = computeInputLimit({
      mode: req.mode,
      side,
      tokenA: resolved.tokenA,
      inputRaw: BigInt(response.inputRaw),
      wallet,
    });
    result = { ...result, wallet, inputLimit };
  }

  result = await attachSponsorFields(
    pump,
    config,
    req,
    result,
    side,
    slippageBps,
    priorityTier,
    walletSolRaw
  );

  return result;
}
