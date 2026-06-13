import type { AppConfig } from "../config/types.js";
import type { PumpContext } from "../pump/context.js";
import { loadTokenBuildAccounts } from "../pump/accounts.js";
import type { TradeMode, TradeSide } from "../types/api.js";
import {
  buyAtaSpecs,
  swapHop2AtaSpecs,
  type AtaSpec,
} from "./ata-specs.js";

export async function resolveBootstrapAtaSpecs(
  pump: PumpContext,
  config: AppConfig,
  req: {
    mode: TradeMode;
    side?: TradeSide;
    mintA: string;
    mintB?: string;
  }
): Promise<AtaSpec[]> {
  if (req.mode === "swap") {
    if (!req.mintB) throw new Error("mintB required for swap");
    const accountsB = await loadTokenBuildAccounts(pump, config, req.mintB);
    return swapHop2AtaSpecs(accountsB);
  }
  if (req.side === "sell") return [];
  const accounts = await loadTokenBuildAccounts(pump, config, req.mintA);
  return buyAtaSpecs(accounts);
}
