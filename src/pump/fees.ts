import { PublicKey } from "@solana/web3.js";

import type { Global } from "./sdk.js";

/** Pump protocol fee recipient (not platform service fee). */
export function pumpFeeRecipient(global: Global, mayhemMode: boolean): PublicKey {
  if (mayhemMode) {
    const recipients = [global.reservedFeeRecipient, ...global.reservedFeeRecipients];
    return recipients[Math.floor(Math.random() * recipients.length)]!;
  }
  const recipients = [global.feeRecipient, ...global.feeRecipients];
  return recipients[Math.floor(Math.random() * recipients.length)]!;
}

const BUYBACK_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((s) => new PublicKey(s));

export function pumpBuybackFeeRecipient(): PublicKey {
  return BUYBACK_RECIPIENTS[Math.floor(Math.random() * BUYBACK_RECIPIENTS.length)]!;
}
