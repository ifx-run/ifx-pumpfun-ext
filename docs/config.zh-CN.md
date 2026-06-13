[English](./config.md) | 中文

# 配置说明

复制 example 文件并本地编辑（均已 gitignore）：

- TOML：`cp config.example.toml config.toml`
- JSON：`cp config.example.json config.local.json`

环境变量覆盖见 [`config.md`](./config.md) 表格；JSON 路径：`IFX_PUMPFUN_CONFIG`。

## 完整示例

见英文版 [`config.md`](./config.md) TOML 示例（与 `config.example.toml` 一致）。

## 优先费档位

前端展示低 / 中 / 高；build 时传 `priorityTier`，写入 ComputeBudget。

## 报价与滑点

- `quote.debounce_ms` — 调用 `/api/quote` 前的防抖。
- `quote.default_slippage_bps` — 默认滑点，作为浮动输出的 **`min_out`** 下限（`min_base_amount_out` / `min_sol_output`）。

## 平台手续费

```toml
[service_fee]
bps = 5   # 万分之五
```

- **只收 quote**（SOL / USDC），**永不**收 pump 代币
- 收款方 = 中心化运营账户（与 sponsor 同 pubkey）
- **USDC：** 须预先创建运营方 USDC ATA
- **SOL：** 直接进运营钱包
- 买入：第一跳**前**扣；卖出：第一跳**后**扣；互换：第一跳后、第二跳**前**扣

环境变量：`IFX_PUMPFUN_SERVICE_FEE_BPS`。

## Sponsor 安全

- 勿提交 `config.toml`、`config.local.json`、keypair。
- `repay_margin_bps` 覆盖 simulation 无法拦截的链上失败沉没成本。

## 公共 Frame

配置 **`public_frames`** / `publicFrames`：已有公共 Frame 的 pubkey。本项目 **不** 创建 Frame，**不** RPC 拉取或 decode Frame 账户。

| 应该 | 不应该 |
|------|--------|
| 配置 pubkey 列表 | 配置 `tape_len` 或使用 `decodeFrameAccount` |
| 每次 build：`new FrameScratch(pk, DEFAULT_TAPE_LEN)` | 启动时 batch 拉取 Frame |
| 每笔 tx 开头 `ixReset()` | 在本项目内创建 Frame |

链下 planner 使用 Ifx **`DEFAULT_TAPE_LEN`**（512）。扩容时向列表追加 pubkey 即可。
