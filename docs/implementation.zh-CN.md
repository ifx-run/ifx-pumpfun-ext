[English](./implementation.md) | 中文

# 实现文档 — ifx-pumpfun-ext

TypeScript 首版模块划分、实现阶段与测试。Go/Rust 可在 API 与 [`design.zh-CN.md`](./design.zh-CN.md) §4 拓扑稳定后平行移植。

---

## 1. 目标目录

见英文版 [`implementation.md`](./implementation.md) §1（结构相同）。

---

## 2. 实现阶段

### Phase 0 — 脚手架（当前）

- [x] Git、配置样例、双语文档
- [ ] 依赖安装、`server.ts`、静态 `public/`

### Phase 1 — 链下 resolve + quote（无 Ifx）

**目标：** `/api/quote` **仅支持精确输入**。

1. **`pump/quote.ts`**
   - **买入** — 精确 quote 输入 → `buy_exact_quote_in_v2`；**不用 `buy_v2`**。
   - **卖出 / 互换** — 精确 base 输入 → `sell_v2`。
   - **手续费** — `feeRaw = quoteBasis × bps / 10000`；响应含 `serviceFeeRaw`、`netQuoteRaw`；永不收 base 代币。

2. **`pump/resolve.ts`** — batch 解析 mint、curve、quote。

3. **运营方一次性准备：** sponsor pubkey 的 **USDC ATA**（启用 USDC quote 前创建）。

### Phase 2 — 单跳买卖 + 条件关 ATA + 手续费

**公共 Frame（`ifx/frames.ts`）** — 仅 pubkey 列表：

1. 从 `publicFrames` 随机选一个。
2. `new FrameScratch(pk, DEFAULT_TAPE_LEN)` + `ixReset()`。
3. 无 Frame RPC、无 `decodeFrameAccount`、无启动加载。

代码见 [`implementation.md`](./implementation.md) §4。

- `buy.ts` — 第一跳**前**扣 quote 手续费 → `buy_exact_quote_in_v2`。
- `sell.ts` — `sell_v2` 后扣 quote 手续费 + 条件 close。
- `service-fee.ts` — SOL / USDC 分支转账。

### Phase 3 — 两跳互换 + 跳间手续费

- hop1：`sell_v2(A)`；hop1 后扣 quote 手续费；hop2 patch `netQuote = quoteDelta − fee` → `buy_exact_quote_in_v2(B)`。

### Phase 4 — Sponsor（SOL quote）

移植 `ifx/tests/sponsored_buy.ts`；`repay_margin_bps` 偿还 buffer。

### Phase 5 — 前端

- 可编辑：输入量；只读：预计收到、**平台手续费**、`netQuoteRaw`。
- build 冻结上次 quote 的 `inputRaw`。

---

## 3. Quote 模块（精确输入）

```ts
type QuoteResult = {
  inputRaw: string;
  expectedOutputRaw: string;
  minOutputRaw: string;
  serviceFeeRaw: string;
  netQuoteRaw: string;
  ixKind: "buy_exact_quote_in_v2" | "sell_v2" | "swap_a_b";
};
```

完整类型与 hop2 patch 示例见 [`implementation.md`](./implementation.md) §3–4。

---

## 4–8. HTTP、测试、RPC、清单

与英文版 [`implementation.md`](./implementation.md) §5–8 等价。
