import { Connection } from "@solana/web3.js";

import type { AppConfig } from "../config/types.js";

export function createConnection(config: AppConfig): Connection {
  return new Connection(config.solana.rpcUrl, {
    commitment: config.solana.commitment,
  });
}
