[中文](./config.zh-CN.md) | English

# Configuration

Copy an example file and edit locally (both gitignored):

- TOML: `cp config.example.toml config.toml`
- JSON: `cp config.example.json config.local.json`

Override via env vars (table below). JSON path: `IFX_PUMPFUN_CONFIG=/path/to/config.local.json`.

## Example (TOML)

```toml
[server]
host = "127.0.0.1"
port = 8787

[rpc]
url = "https://api.mainnet-beta.solana.com"
commitment = "confirmed"
cache_ttl_ms = 2000

[ifx]
# program_id = "ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj"
public_frames = [
  "6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn",
]

[sponsor]
# keypair_path = "./keys/sponsor.json"
# secret_key_base58 = "..."
repay_margin_bps = 100
min_user_sol_lamports = 5_000_000
advance_cap_lamports = 20_000_000

[priority_fee]
low = 1_000
medium = 10_000
high = 100_000
compute_unit_limit = 400_000

[quote]
debounce_ms = 300
default_slippage_bps = 100

[pump]
usdc_mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
native_mint = "So11111111111111111111111111111111111111112"
```

## Environment overrides

| Variable | Config key |
|----------|------------|
| `IFX_PUMPFUN_RPC_URL` | `rpc.url` |
| `IFX_PUMPFUN_PORT` | `server.port` |
| `IFX_PUMPFUN_SPONSOR_KEYPAIR` | `sponsor.keypair_path` |
| `IFX_PUMPFUN_SPONSOR_SECRET` | `sponsor.secret_key_base58` |
| `IFX_PUMPFUN_CONFIG` | path to JSON config file |
| `IFX_PUMPFUN_SERVICE_FEE_BPS` | `service_fee.bps` |

## Priority fee tiers

UI shows Low / Medium / High. Build request passes `priorityTier`:

```ts
ComputeBudgetProgram.setComputeUnitLimit(compute_unit_limit)
ComputeBudgetProgram.setComputeUnitPrice(priority_fee[tier])
```

## Quote / slippage

- `quote.debounce_ms` — client debounce before `/api/quote`.
- `quote.default_slippage_bps` — default slippage floor on the **floating output** (`min_base_amount_out` / `min_sol_output`).

## Service fee

```toml
[service_fee]
bps = 5   # 万分之五 = 0.05%
```

| Rule | Detail |
|------|--------|
| Asset | **Quote only** — SOL (native) or USDC (SPL). **Never** pump base/meme tokens. |
| Recipient | Operator pubkey (= sponsor centralized account). |
| USDC | Operator **USDC ATA must exist** before USDC-quote trades (create once off-chain; not in user tx). |
| SOL | Fee credits operator wallet lamports directly. |
| Buy | Fee **before** `buy_exact_quote_in_v2` — deducted from user’s quote input. |
| Sell | Fee **after** `sell_v2` — from quote proceeds. |
| Swap | Fee **after** sell hop, **before** buy hop — hop2 uses `quoteDelta − fee`. |
| Forbidden | Fee **after** hop 2 (output is pump token). |

Env override: `IFX_PUMPFUN_SERVICE_FEE_BPS` → `service_fee.bps`.

## Sponsor security

- Never commit `config.toml`, `config.local.json`, or keypair files.
- `repay_margin_bps` covers sunk cost when simulation cannot catch on-chain failures (e.g. advance 0.01 SOL → repay 0.0101 SOL at 100 bps).

## Public Frames

Set **`public_frames`** / `publicFrames` — base58 pubkeys of **existing public Frames**. This project **never** creates Frames and **does not** RPC-fetch or decode Frame accounts.

| Do | Don't |
|----|-------|
| List one or more public Frame pubkeys | Configure `tape_len` or call `decodeFrameAccount` |
| `new FrameScratch(pk, DEFAULT_TAPE_LEN)` per build | Batch-fetch Frame accounts at startup |
| `ixReset()` at the start of every business tx | Create Frames in this repo |

Planner tape size: Ifx **`DEFAULT_TAPE_LEN`** (512) from `@ifx-run/sdk` — standard for public Frames.

Append more existing Frame pubkeys to the list to spread load; no other Frame setup in this showcase.
