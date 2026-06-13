[中文](./config.zh-CN.md) | English

# Configuration

Edit **`config.toml`** or **`config.json`** at the repo root (both are tracked in git). **Use one format only** — if both files exist, **`config.toml` wins**.

Override path: `IFX_PUMPFUN_CONFIG=/path/to/config.toml`.

Reference copies: [`config.example.toml`](../config.example.toml), [`config.example.json`](../config.example.json).

## Centralized accounts (separate)

| Section | Purpose | Required fields |
|---------|---------|-----------------|
| **`serviceFee`** / `[service_fee]` | Quote fee recipient (receive-only) | `pubkey` only — fee CPI sends SOL/USDC **to** this wallet; no operator signature |
| **`sponsor`** / `[sponsor]` | SOL-quote gas/rent advance + repay | `pubkey`, `keypairPath` when `enabled = true` (must co-sign) |

Fee CPI targets **`serviceFee.pubkey`**. Sponsor loads **`sponsor.keypairPath`** for co-signing. Pubkeys may match; configs stay separate.

**Never store raw private keys in config.** Sponsor keypair: `./keys/sponsor.json` (see [`keys/README.md`](../keys/README.md)); `keys/` is gitignored.

**USDC quote:** pre-create **`serviceFee.pubkey`**'s USDC ATA before USDC trades.

### JSON

```json
"serviceFee": {
  "bps": 5,
  "pubkey": "YourFeeRecipientPubkey..."
},
"sponsor": {
  "enabled": false,
  "pubkey": "YourSponsorPubkey...",
  "keypairPath": "./keys/sponsor.json"
}
```

### TOML

```toml
[service_fee]
bps = 5
pubkey = "YourFeeRecipientPubkey..."

[sponsor]
enabled = false
pubkey = "YourSponsorPubkey..."
keypair_path = "./keys/sponsor.json"
```

Generate sponsor keypair:

```bash
mkdir -p keys
solana-keygen new -o keys/sponsor.json --no-bip39-passphrase
```

## Environment overrides

| Variable | Config key |
|----------|------------|
| `IFX_PUMPFUN_RPC_URL` | `solana.rpcUrl` |
| `IFX_PUMPFUN_PORT` | `server.port` |
| `IFX_PUMPFUN_CONFIG` | path to config file |
| `IFX_PUMPFUN_SERVICE_FEE_BPS` | `serviceFee.bps` |
| `IFX_PUMPFUN_SERVICE_FEE_PUBKEY` | `serviceFee.pubkey` |
| `IFX_PUMPFUN_SPONSOR_PUBKEY` | `sponsor.pubkey` |
| `IFX_PUMPFUN_SPONSOR_KEYPAIR` | `sponsor.keypairPath` |

## Priority fee tiers

UI shows Low / Medium / High. Build request passes `priorityTier`:

```ts
ComputeBudgetProgram.setComputeUnitLimit(compute_unit_limit)
ComputeBudgetProgram.setComputeUnitPrice(priority_fee[tier])
```

## Quote / slippage

- `quote.debounce_ms` — client debounce before `/api/quote`.
- `quote.default_slippage_bps` — default slippage floor on the **floating output** (`min_base_amount_out` / `min_sol_output`).

## Service fee rules

| Rule | Detail |
|------|--------|
| Asset | **Quote only** — SOL or USDC. **Never** pump base tokens. |
| Recipient | `serviceFee.pubkey` |
| USDC | Pre-create operator USDC ATA |
| Buy | Fee **before** `buy_exact_quote_in_v2` |
| Sell | Fee **after** `sell_v2` |
| Swap | Fee **after** sell hop, **before** buy hop |

## Public Frames

Set **`public_frames`** / `publicFrames` — existing public Frame pubkeys. No Frame creation or on-chain decode in this project. Planner uses Ifx **`DEFAULT_TAPE_LEN`** (512).
