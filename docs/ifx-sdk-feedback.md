[中文](./ifx-sdk-feedback.zh-CN.md) | English

# Ifx TypeScript SDK — feedback from `ifx-pumpfun-ext`

Feedback from building and shipping the **ifx-pumpfun-ext** showcase on Solana mainnet — with a clear split between **what the SDK should fix** and **what integrators own**.

**Context:** Pump.fun bonding-curve v2 buy/sell/swap, conditional ATA close, platform fee, SOL sponsor + repay — all orchestrated with Ifx in one v0 transaction.

**SDK version referenced:** `@ifx-run/sdk` **0.1.1+** (mainnet program `ifxmwWVVZ…`). Items in §2 were addressed in **0.1.1**; this repo tracks that release.

**Adopted in this repo (0.1.1):** duck-typed `LetAccountInput` (removed `asIfxLetAccount`), `U64Binding` from SDK, `FrameScratch.forPublicFrame()`, `ifxIxHint` in tx inspector.

---

## 1. SDK scope (consensus)

The Ifx SDK should expose **generic orchestration primitives**, not full product transactions for every DEX:

| Belongs in SDK | Does not belong in SDK |
|----------------|------------------------|
| `FrameScratch`, `letBuilder`, `expr` | Whether the **whole tx** fits in 1232B (DEX + ALT + signers) |
| `rawCpi` / `structuredCpi`, `ifx_if_else` | Per-DEX `data_offset` for `rawCpiPatch` |
| Typed bindings, public Frame factory | Business planners (sponsor, two-hop, close ATA) |
| Optional: Ifx ix decode, tape capacity checks | Enumerating Pump / Raydium / Jupiter patch offsets |

**Examples / tests** (`two-hop-token-swap`, `sponsored_buy`, `dust-destroy-token2022`) are **reference patterns**, not importable product libraries — small accounting differences (SOL lamports delta vs USDC ATA balance, fee before vs after hop) break reuse; coarse planners add little value.

---

## 2. SDK should fix (P0–P1)

### 2.1 `instanceof PublicKey` — duplicate `@solana/web3.js`

**Symptom:** `letBuilder.lamports(user)` fails when `user` comes from the app’s `web3.js` copy (`toLetAccountMeta` uses `instanceof PublicKey`).

**Our workaround:** `src/ifx/let-account.ts` → `asIfxLetAccount()` wraps `AccountMeta`.

**Fix:** Duck-type `LetAccountInput` (`toBase58` / `toBytes`) or document `AccountMeta` as the preferred input. **This is an SDK bug — integrators should not carry a permanent workaround.**

**Priority:** P0.

---

### 2.2 Export binding types publicly

**Symptom:** Cross-module bindings are typed as `any`:

```ts
export type U64Binding = any; // src/ifx/planner/sponsor.ts
```

**Fix:** Export `ScratchValue<IfxTy>` (at least `ScratchValue<"u64">`) so `expr.sub(quoteDelta, fee)` is traceable in TypeScript. **Generic capability, not a business planner.**

**Priority:** P1.

---

### 2.3 Simpler public Frame construction

**Symptom:** Six positional ctor args; easy to confuse `authority` and `programId`.

**Our code:** `src/ifx/frames.ts`

```ts
new FrameScratch(frame, DEFAULT_TAPE_LEN, 0, 0, program, frame);
```

**Fix:**

```ts
FrameScratch.forPublicFrame({ framePubkey, programId, tapeLen?: DEFAULT_TAPE_LEN });
```

**Priority:** P1.

---

## 3. Integrator responsibility (not SDK)

### 3.1 Full transaction size and `tryCompile`

**Symptom:** Swap + sponsor ~1339B vs 1232B limit.

**Our approach:** `src/ifx/build.ts` — `compileToV0Message`, `tryCompile()`, optional smart-close drop, `transactionSizeBytes` in API.

**Why not SDK:** Size depends on **DEX account lists, ALTs, ComputeBudget, signature count, v0 vs legacy** — not Ifx alone. Solana already fails at compile time; whether to drop close ixs or disable sponsor is **product policy**.

The SDK may document per-ix wire overhead in prose; it should **not** ship a `compilePreview` API for whole transactions.

---

### 3.2 Third-party DEX `rawCpiPatch` offsets

**Symptom:**

```ts
// src/pump/patch-offsets.ts — Pump.fun only
export const BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET = 8;
```

**Why not SDK:** `rawCpi` is intentionally **type-unsafe** (see ifx `raw-cpi-patches`). Layouts differ per program; the SDK **cannot and should not** enumerate every DEX field offset.

Integrators maintain constants against their target IDL; SDK docs can explain **how** to derive Anchor layouts (8-byte discriminator + args), not ship Pump-specific helpers.

---

### 3.3 Business planners (sponsor / two-hop / conditional close)

**Symptom:** `src/ifx/planner/*` mirrors ifx examples/tests but under **Pump + platform fee + sponsor rules**.

**Why not SDK:**

- SOL quote uses **lamports delta**; USDC uses **SPL ATA**; fee timing differs by route — all product choices.
- Coarse `@ifx-run/sdk/planners` break on small changes and imply “import = production ready”.

**SDK role:** Keep examples/tests; export generic `letBuilder`, `rawCpiPatch`, `structuredCpiPatch`, `ifElseArgs`.

---

## 4. Optional improvements (P2 — still generic)

| Item | Notes | Priority |
|------|-------|----------|
| **Ifx ix decode** | We fork discriminators in `tx-inspect.ts` | P2 |
| **Tape / binding plan-time errors** | Clear errors when `planRecordOffsets` would overflow | P2 |
| **Log parser** | `parseIfxLogs` for debugging | P2 |
| **Slimmer peer deps** | Optional Anchor decoupling | P2 |
| **Docs: let batching / wire cost** | See this repo’s README size table | P2 |
| **On-chain let merging** | Program-level wire savings | P3 |

“When to patch vs static transfer” belongs in **integrator docs** (see our `docs/design.md` §2.4), not SDK APIs.

---

## 5. Architecture boundaries

| Topic | Conclusion |
|-------|------------|
| **1232B wall** | Thin wrapper is an integrator choice when Ifx glue + fat DEX exhaust headroom |
| **Correctness vs bytes** | Hop-2 must use on-chain `ifx_let` delta, not quote-time static amounts |
| **ALT** | Integrator-owned; SDK does not manage lookup tables |
| **Public Frame ops** | Frame pool provisioning is ifx ops, not SDK runtime |

---

## 6. Revised roadmap

| Priority | Item | Owner |
|----------|------|-------|
| **P0** | Fix `PublicKey` / `LetAccountInput` identity | **SDK** |
| **P1** | Export `ScratchValue<T>` | **SDK** |
| **P1** | `FrameScratch.forPublicFrame()` | **SDK** |
| — | Full tx size, `tryCompile`, smart-close policy | **Integrator** |
| — | DEX `rawCpiPatch` offset constants | **Integrator** |
| — | Sponsor / swap / close business planners | **Integrator** (see examples) |
| P2 | Ifx decode, logs, tape validation | SDK (optional) |
| P3 | On-chain wire size reduction | Ifx program |

---

## 7. References in this repo

| File | Role |
|------|------|
| `src/ifx/frames.ts` | `FrameScratch.forPublicFrame()` |
| `src/util/tx-inspect.ts` | `ifxIxHint` from SDK |
| `src/ifx/planner/*.ts` | **Business-layer** planners |
| `src/pump/patch-offsets.ts` | **Pump-specific** patch offset |
| `src/ifx/build.ts` | **Integrator** tryCompile / size gate |
| `src/util/tx-inspect.ts` | Inspector (candidate for SDK decode) |
| `README.md` § Ifx vs wrapper | Mainnet size / boundary notes |

---

*Scope split aligned with project maintainers after review.*
