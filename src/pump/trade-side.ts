import type { TradeMode, TradeSide } from "../types/api.js";

/** Swap sells A first — treat as sell for input limits and bootstrap (not buy). */
export function effectiveTradeSide(
  mode: TradeMode,
  side?: TradeSide
): TradeSide {
  if (mode === "swap") return "sell";
  return side ?? "buy";
}

export function isBuyTrade(mode: TradeMode, side?: TradeSide): boolean {
  return mode === "trade" && effectiveTradeSide(mode, side) === "buy";
}
