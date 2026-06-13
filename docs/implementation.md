[中文](./implementation.zh-CN.md) | English

# Implementation — ifx-pumpfun-ext

TypeScript-first module layout, rollout phases, and tests. Go/Rust backends can mirror the HTTP API and Ifx topology in [`design.md`](./design.md) §4 once stable.

---

## 1. Target layout

```text
ifx-pumpfun-ext/
├── config.example.json | config.example.toml
├── docs/
├── public/
├── src/
│   ├── server.ts
│   ├── config/
│   ├── solana/batch.ts
│   ├── pump/
│   │   ├── resolve.ts
│   │   ├── quote.ts          # exact-input quoting only
│   │   └── accounts.ts
│   ├── ifx/
│   │   ├── frames.ts          # pick public frame pubkey; DEFAULT_TAPE_LEN scratch
│   │   └── planner/
│   │       ├── buy.ts
│   │       ├── sell.ts
│   │       ├── swap.ts
│   │       ├── close-ata.ts
│   │       ├── sponsor.ts
│   │       └── service-fee.ts   # quote-only fee; placement per route
│   └── routes/
└── package.json
```

---

## 2. Phases

### Phase 0 — Scaffold (current)

- [x] Git repo, config examples, bilingual docs
- [ ] `npm install`, `src/server.ts`, static `public/`

### Phase 1 — Off-chain resolve + quote (no Ifx)

**Goal:** `/api/token/resolve` and `/api/quote` with **exact-input only**.

1. **`pump/quote.ts`**
   - **Buy** — exact quote in; estimate base out; `buy_exact_quote_in_v2` (`spendable_quote_in` exact, `min_base_amount_out` guard). **No `buy_v2`.**
   - **Sell / swap** — exact base in; `sell_v2` with `min_sol_output` guard.
   - **Service fee** — `feeRaw = quoteBasis × serviceFee.bps / 10000`; expose `serviceFeeRaw`, `netQuoteRaw` in quote response. Never fee on base mint.

2. **`pump/resolve.ts`** — batch fetch mint + bonding curve; detect quote; reject graduated curves.

3. **`solana/batch.ts`** — `getMultipleAccountsInfo` wrapper with chunking.

4. **Operator setup (once):** derive sponsor pubkey; **create USDC ATA** for operator if USDC-quote trades are enabled (shell/`spl-token create-account`, not in app hot path).

### Phase 2 — Single-hop buy/sell + conditional close

**Public Frames (`ifx/frames.ts`)** — pubkey list only:

1. **Pick** — uniform random from `config.ifx.publicFrames`.
2. **Scratch** — `new FrameScratch(pubkey, DEFAULT_TAPE_LEN, 0, 0, programId)`; first ix `ixReset()`.
3. No Frame RPC, no `decodeFrameAccount`, no startup load step.

- `ifx/planner/sell.ts` — exact base `sell_v2` + conditional close + fee after sell.
- `ifx/planner/buy.ts` — fee before `buy_exact_quote_in_v2`.
- `/api/tx/build` embeds `inputRaw` from quote response (immutable exact input).

### Phase 3 — Two-hop swap (raw CPI) + inter-hop fee

- Hop1: static `sell_v2(A)` (exact base A).
- Let `quoteDelta`; `fee = quoteDelta × bps / 10000`; `netQuote = quoteDelta − fee`.
- Fee transfer to operator; hop2 patch `spendable_quote_in ← netQuote` (`rawCpiPatch`).
- Static `min_base_amount_out` from off-chain estimate × slippage at build time.
- Confirm patch offsets in `patch-offsets.ts` via pump-sdk template hex dump.
- `ifx/planner/service-fee.ts` — shared SOL / USDC fee CPI helper.

### Phase 4 — Sponsor (SOL quote)

Port logic from `ifx/tests/sponsored_buy.ts`: baseline lets, assert, patched repay with `repay_margin_bps`.

### Phase 5 — Frontend

- Editable: input amount (quote if buy, base if sell/swap).
- Read-only: estimated output, **service fee**, net quote to Pump.
- Debounced quote; build uses frozen `inputRaw` from last quote.

---

## 3. Quote module sketch (exact-input)

```ts
type QuoteRequest = {
  mode: "trade" | "swap";
  side?: "buy" | "sell";
  inputRaw: bigint; // quote lamports/units if buy; base raw if sell/swap
  slippageBps: number;
};

type QuoteResult = {
  inputRaw: string;
  inputLabel: string;
  expectedOutputRaw: string;
  minOutputRaw: string;
  serviceFeeRaw: string;
  serviceFeeLabel: "SOL" | "USDC";
  netQuoteRaw: string;
  ixKind: "buy_exact_quote_in_v2" | "sell_v2" | "swap_a_b";
};
```

---

## 4. Public Frame pick

```ts
import { randomInt } from "crypto";
import { DEFAULT_TAPE_LEN, FrameScratch } from "@ifx-run/sdk";

export function scratchForBuild(
  publicFrames: PublicKey[],
  programId: PublicKey
): FrameScratch {
  const frame = publicFrames[randomInt(publicFrames.length)]!;
  return new FrameScratch(frame, DEFAULT_TAPE_LEN, 0, 0, programId);
}
```

---

## 5. Swap hop2 patch (USDC quote)

```ts
// After sell_v2(A); fee between hops
const batch = scratch.letBuilder();
const quoteDelta = batch.letEval(expr.sub(quoteAfter, quoteBefore));
const fee = batch.letEval(
  expr.div(expr.mul(quoteDelta, expr.u64(serviceFeeBps)), expr.u64(10_000n))
);
const netQuote = batch.letEval(expr.sub(quoteDelta, fee));
tx.add(batch.buildIx());
// → fee transfer (SOL / USDC) → hop2 patch spendable_quote_in = netQuote
```

SOL path: quote delta from `lamports(user)` before/after hop1.

---

## 6. HTTP server

Fastify or Express — see Phase 0 scaffold in previous doc. Routes: resolve, quote, build, public config.

---

## 7. Tests

| Layer | Focus |
|-------|--------|
| Unit | Exact-input quote guards; reject quote-input on sell |
| Simulate | `ifx_if_else` close vs skip logs |
| Manual | Buy base-in → sell base-in → ATA closed; swap A→B |

---

## 8. RPC budget

- resolve + quote: 1–2 RPC calls
- build: 1 batch + `getLatestBlockhash`

---

## 9. Checklist

- [ ] Phase 1: exact-input quote API
- [ ] Phase 2: buy/sell + conditional close
- [ ] Phase 3: swap + rawCpi hop2 + inter-hop fee
- [ ] Phase 4: sponsor repay
- [ ] Phase 5: UI + wallet
- [ ] Operator USDC ATA one-time setup doc
