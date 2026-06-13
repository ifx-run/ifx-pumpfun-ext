# ifx-pumpfun-ext

English | [中文](./README.zh-CN.md)

Showcase for [Ifx](https://github.com/ifx-run/ifx): Pump.fun trading with **exact-input** routes, **quote-only service fee** (default 5 bps), conditional ATA close, same-quote two-hop swap, and SOL-quote sponsored gas — orchestrated in one tx via Ifx.

> **Status:** Design and implementation docs are in place; the TypeScript backend is pending ([`docs/implementation.md`](./docs/implementation.md)).

## Trading model

**All routes use exact-input only** — the user fixes the input side; the output is **estimated off-chain and floats** until execution. Slippage floors protect the floating output on-chain (`min_base_amount_out`, `min_sol_output`). There is **no exact-output mode** — we do **not** use `buy_v2` (it fixes base token amount).

See [`docs/design.md`](./docs/design.md) §2.3 for instruction mapping.

## Why this works

| Requirement | Ifx capability | Reference |
|-------------|----------------|-----------|
| Close ATA only when balance is 0 after sell | `ifx_let` + `ifx_if_else` → CloseAccount or Skip | [dust-destroy-token2022](https://github.com/ifx-run/ifx/blob/main/sdk/examples/dust-destroy-token2022.ts) |
| A→quote→B hop2 amount from hop1 output | Static hop1 → `let` intermediate quote → `rawCpiPatch` hop2 | [two-hop-token-swap](https://github.com/ifx-run/ifx/blob/main/sdk/examples/two-hop-token-swap.ts) |
| Sponsor rent/fee when user SOL is low; repay on sell | Baseline `let` → idempotent ATA → patched `SystemProgram.transfer` | [sponsored_buy](https://github.com/ifx-run/ifx/blob/main/tests/sponsored_buy.ts) |
| Pump `sell_v2` / `buy_exact_quote_in_v2` (+ raw patch on swap hop2) | `rawCpi` + documented `data_offset` | [raw-cpi-patches](https://github.com/ifx-run/ifx/blob/main/docs/raw-cpi-patches.md) |

Pump.fun **V2**: **`buy_exact_quote_in_v2`** (buy), **`sell_v2`** (sell / swap hop1). **`buy_v2` is not used** — it fixes base out (exact-output). Off-chain: [`@pump-fun/pump-sdk`](https://www.npmjs.com/package/@pump-fun/pump-sdk); on-chain: Ifx patches dynamic fields on swap hop2.

## Quick start

```bash
npm install
# Edit config.toml OR config.json (delete the other if both exist; toml wins)
# Set serviceFee.pubkey (receive-only); sponsor.keypairPath if sponsor enabled

npm run dev
# Open http://127.0.0.1:8787
```

## Documentation

| Doc | Description |
|-----|-------------|
| [`docs/design.md`](./docs/design.md) | UX, API, Ifx tx topology, exact-input rules |
| [`docs/implementation.md`](./docs/implementation.md) | Modules, RPC batching, phased rollout |
| [`docs/config.md`](./docs/config.md) | Configuration and env overrides |

## Architecture

```text
Browser (static UI)
    │  debounced quote / build tx
    ▼
TypeScript backend
    ├── pump-sdk     → buy_exact_quote_in_v2 / sell_v2 templates
    ├── @ifx-run/sdk → FrameScratch orchestration
    └── @solana/web3.js → getMultipleAccounts batching
    │
    ▼
Solana (mainnet) — Pump program + Ifx program
```

## License

MIT
