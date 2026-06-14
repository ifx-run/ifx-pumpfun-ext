import { PublicKey } from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import type {
  QuoteLabel,
  QuoteRequest,
  QuoteResponse,
  TokenMeta,
} from "../types/api.js";
import { applyBps, formatRawToUi, minOutRaw, parseAmountToRaw } from "../util/amount.js";
import type { PumpContext } from "./context.js";
import { resolveTokens } from "./resolve.js";
import { resolveBootstrapAtaSpecs } from "../sponsor/bootstrap-specs.js";
import {
  assertSponsorRepayCoverage,
  sponsorQuoteHint,
} from "../sponsor/plan.js";
import { sellMinQuoteForSwap } from "../ifx/planner/swap.js";
import {
  computeInputLimit,
  fetchWalletBalances,
} from "../wallet/balances.js";

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
    serviceFeeLabel: tokenA.quoteLabel as QuoteLabel,
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
  } else {
    const side = req.side ?? "buy";
    if (side === "buy") {
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
  }

  const quoteLabel = response.serviceFeeLabel;
  const side = req.side ?? "buy";
  const priorityTier = (req.priorityTier ??
    config.priorityFee.defaultTier) as PriorityTier;

  let result: QuoteResponse = response;

  if (req.userPubkey) {
    const needsBase =
      req.mode === "swap" || (req.side ?? "buy") === "sell";
    const wallet =
      resolved.wallet ??
      (await fetchWalletBalances(
        pump.connection,
        config,
        new PublicKey(req.userPubkey),
        needsBase ? resolved.tokenA : undefined
      ));
    const inputLimit = computeInputLimit({
      mode: req.mode,
      side,
      tokenA: resolved.tokenA,
      inputRaw: BigInt(response.inputRaw),
      wallet,
      sponsorEnabled: config.sponsor.enabled,
    });
    result = { ...result, wallet, inputLimit };
  }

  if (config.sponsor.enabled && quoteLabel === "SOL") {
    const bootstrapSpecs = await resolveBootstrapAtaSpecs(pump, config, {
      mode: req.mode,
      side,
      mintA: req.mintA,
      mintB: req.mintB,
    });
    const user = req.userPubkey
      ? new PublicKey(req.userPubkey)
      : undefined;
    const sponsor = await sponsorQuoteHint(pump.connection, config, {
      quoteLabel,
      priorityTier,
      user,
      bootstrapSpecs,
    });
    if (sponsor) {
      const repayLamports = BigInt(sponsor.estimatedLamports);
      if (req.mode === "swap") {
        const quoteDeltaEst =
          BigInt(response.serviceFeeRaw) + BigInt(response.netQuoteRaw);
        assertSponsorRepayCoverage(
          sellMinQuoteForSwap(quoteDeltaEst, slippageBps),
          BigInt(response.serviceFeeRaw),
          repayLamports
        );
      } else if (side === "sell") {
        assertSponsorRepayCoverage(
          BigInt(response.minOutputRaw),
          BigInt(response.serviceFeeRaw),
          repayLamports
        );
      }

      const route = [...result.route];
      if (req.mode === "swap" || side === "buy") {
        route.unshift("sponsor.bootstrap");
      }
      if (req.mode === "swap" || side === "sell") {
        route.push("sponsor.repay");
      }
      return { ...result, sponsor, route };
    }
  }

  return result;
}
