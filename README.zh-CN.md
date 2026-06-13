# ifx-pumpfun-ext

[English](./README.md) | 中文

[Ifx](https://github.com/ifx-run/ifx) 能力展示：Pump.fun **精确输入**买卖、**quote 平台手续费**（默认万分之五）、条件关 ATA、同 quote 两跳互换、SOL 代付 gas — 单笔 tx 内 Ifx 编排。

> **状态：** 设计与实现文档已落地；TypeScript 后端待实现（[`docs/implementation.zh-CN.md`](./docs/implementation.zh-CN.md)）。

## 交易模型

**所有路由均为精确输入（exact-input）** — 用户固定输入侧；输出侧链下估算并浮动。链上滑点保护浮动输出（`min_base_amount_out`、`min_sol_output`）。**不用 `buy_v2`** — 它固定 base 数量（exact-output）。

详见 [`docs/design.zh-CN.md`](./docs/design.zh-CN.md) §2.3。

## 为什么可行

| 需求 | Ifx 能力 | 参考 |
|------|----------|------|
| 卖出后余额为 0 才关 ATA | `ifx_let` + `ifx_if_else` → CloseAccount 或 Skip | [dust-destroy-token2022](https://github.com/ifx-run/ifx/blob/main/sdk/examples/dust-destroy-token2022.ts) |
| A→quote→B 第二跳 amount 来自第一跳 | hop1 静态 CPI → `let` 中间 quote → `rawCpiPatch` hop2 | [two-hop-token-swap](https://github.com/ifx-run/ifx/blob/main/sdk/examples/two-hop-token-swap.ts) |
| SOL 不足时代付 rent/fee，卖出后偿还 | 基线 `let` → 幂等 ATA → patched transfer | [sponsored_buy](https://github.com/ifx-run/ifx/blob/main/tests/sponsored_buy.ts) |
| Pump `sell_v2` / `buy_exact_quote_in_v2`（互换 hop2 raw patch） | `rawCpi` + `data_offset` | [raw-cpi-patches](https://github.com/ifx-run/ifx/blob/main/docs/raw-cpi-patches.zh-CN.md) |

买入 **`buy_exact_quote_in_v2`**，卖出/互换 hop1 **`sell_v2`**；**不用 `buy_v2`**（exact-output）。

## 快速开始

```bash
npm install
# 编辑 config.toml 或 config.json（二选一；同时存在时优先 toml）
# 填写 serviceFee.pubkey（仅收款）；启用 sponsor 时配置 keypairPath

npm run dev
# 浏览器打开 http://127.0.0.1:8787
```

## 文档

| 文档 | 说明 |
|------|------|
| [`docs/design.zh-CN.md`](./docs/design.zh-CN.md) | 交互、API、Ifx 拓扑、精确输入规则 |
| [`docs/implementation.zh-CN.md`](./docs/implementation.zh-CN.md) | 模块、RPC 批取、实现阶段 |
| [`docs/config.zh-CN.md`](./docs/config.zh-CN.md) | 配置与环境变量 |

## 许可证

MIT
