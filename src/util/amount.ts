const AMOUNT_RE = /^\d+(\.\d+)?$/;

export function parseAmountToRaw(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!AMOUNT_RE.test(trimmed)) {
    throw new Error(`invalid amount: ${amount}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`too many decimal places (max ${decimals})`);
  }
  const padded = frac.padEnd(decimals, "0");
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return BigInt(combined === "" ? "0" : combined);
}

export function formatRawToUi(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

export function applyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / 10_000n;
}

export function minOutRaw(expected: bigint, slippageBps: number): bigint {
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}
