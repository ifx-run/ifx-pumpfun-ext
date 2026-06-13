[English](./design.md) | 中文

# 设计文档 — ifx-pumpfun-ext

## 1. 目标

本地可部署的 **后端 + 轻量静态前端**，展示 [Ifx](https://github.com/ifx-run/ifx) 在 Pump.fun 的四类编排能力：

1. **任意代币买卖** — 粘贴 mint，自动识别 quote（SOL / USDC），**精确输入**询价与下单（输出浮动）。
2. **同 quote 两跳互换** — A → quote → B；hop2 `spendable_quote_in` 由 hop1 输出 patch（`rawCpi`）。
3. **条件关 ATA** — 卖出后输入代币 ATA 余额为 0 则 close，否则 Skip。
4. **SOL quote 代付与偿还**（USDC 不支持）— sponsor 代付 gas/rent；卖出/互换卖出腿后 patch 偿还（含 buffer %）。

**非目标（v1）：** PumpSwap、Token-2022 harvest、Jito 拆 tx、**精确输出（exact-output）**。

---

## 2. 交互设计

**原则：** 用户选定币对并输入 **固定输入量** 后，防抖后立即询价；「构建并签名」复用同一输入，不再二次计价。

### 2.1 页面布局

```text
┌─────────────────────────────────────────────────────────┐
│  Pump × Ifx Showcase                    [Priority: 中▼] │
├─────────────────────────────────────────────────────────┤
│  模式: (● 买卖) (○ 互换)                                 │
│  代币 A / B mint 输入 → Quote: SOL | 进度 | decimals      │
├─────────────────────────────────────────────────────────┤
│  方向: [ 买入 ▼ ]                                         │
│  您支付 / 卖出  [ ________ ]  ← 买入填 quote，卖出/互换填 base │
│  预计收到（浮动）  1,234,567 TOKEN                        │
│  滑点  [ 1% ▼ ]                                           │
├─────────────────────────────────────────────────────────┤
│  [ 连接钱包 ]              [ 构建并签名 ]                  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 精确输入模型（必选）

**固定输入侧，输出浮动。** 滑点为浮动侧 **`min_out`**。**不用 `buy_v2`**（`amount` 固定 base 收到量 = exact-output）。买入仅用 **`buy_exact_quote_in_v2`**。

| 路由 | 固定输入 | 浮动输出 | Pump 指令 |
|------|----------|----------|-----------|
| **买入** | Quote（SOL / USDC） | Base | `buy_exact_quote_in_v2` |
| **卖出** | Base | Quote | `sell_v2` |
| **互换 A→B** | Base A | Base B | `sell_v2(A)` + patched `buy_exact_quote_in_v2(B)` |

- **买入：** 可编辑「您支付」（quote）；只读「预计收到」（base）。
- **卖出/互换：** 可编辑「您卖出」（base）；只读预计 quote 或 token B。

### 2.3 平台手续费

运营方（与 **sponsor 同一中心化账户**）按配置比例收取 **quote 手续费** — **永不**收取 pump 发射代币。

| 配置 | 默认 | 含义 |
|------|------|------|
| `serviceFee.bps` | `5` | **万分之五**（5/10000 = 0.05%），按 quote 计 |

**到账**

- **SOL quote** → 原生 lamports 进运营钱包
- **USDC quote** → SPL 转入运营方 **USDC ATA**（须 **提前创建**，一次性链下准备）

**收取时机**（只能在 quote 侧扣费）：

| 路由 | 时机 | 基数 |
|------|------|------|
| **买入** | **第一跳之前** | `fee = 输入 quote × bps/10000`；Pump 买入用 `输入 − fee` |
| **卖出** | **第一跳之后** | `fee = 卖出所得 quote × bps/10000` |
| **互换** | **第一跳之后、第二跳之前** | `fee = quote 增量 × bps/10000`；hop2 patch `增量 − fee` |
| **禁止** | 第二跳之后 | 输出必为 pump 代币，不能作手续费 |

询价响应含 `serviceFeeRaw`、`netQuoteRaw`。Ifx 用 `structuredCpiPatch` 转账；互换 hop2 用 `expr.sub(quoteDelta, fee)` patch。

### 2.4 防抖

输入量、滑点、优先费档位：**300ms debounce**；结束后立即 `POST /api/quote`。构建不重报价；blockhash 过期返回 409。

---

## 3. API

### 3.1 `POST /api/quote`

```json
{
  "mode": "trade",
  "side": "buy",
  "inputAmount": "0.05",
  "slippageBps": 100
}
```

| 字段 | 说明 |
|------|------|
| `inputAmount` | **精确输入** — `side=buy` 为 quote 单位；`side=sell` 或 `mode=swap` 为 base 单位 |

响应含 `inputRaw`、`expectedOutputRaw`、`minOutputRaw`（浮动侧链上下限）。无 `inputSide` 字段。

其余 API 见 [`design.md`](./design.md) §3。

---

## 4. Ifx 交易拓扑

每笔 tx 在 **随机选取的公共 Frame** 上开头 `scratch.ixReset()`（见 §4.0）。

### 4.0 公共 Frame（仅使用，不创建、不拉取）

本项目 **不创建 Frame**，**不 fetch / decode Frame 账户**（不用 `decodeFrameAccount`）。配置仅为 **公共 Frame pubkey 列表**；链下 planner 固定使用 Ifx **`DEFAULT_TAPE_LEN`**（512）。

```json
"publicFrames": [
  "6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn"
]
```

**每次 build：** 从列表随机选一个 pubkey → `new FrameScratch(framePk, DEFAULT_TAPE_LEN)` → `ixReset()`。

**不使用：** 启动时 Frame RPC batch、tape 长度配置、Frame 缓存文件。

**扩容：** 列表追加更多已有公共 Frame 地址即可；planner 仍用 `DEFAULT_TAPE_LEN`。

每笔业务 tx 开头 `ixReset()`。

### 4.1–4.3 拓扑（含手续费）

- **卖出：** `sell_v2` → 从 quote 所得扣费 → operator → 条件 close → [SOL] sponsor 偿还
- **买入：** 先从用户 quote 扣费 → operator → `buy_exact_quote_in_v2(净 quote)`
- **互换：** `sell_v2(A)` → 从 quote 增量扣费 → hop2 patch `buy_exact_quote_in_v2(增量 − fee)`

完整 ix 顺序见 [`design.md`](./design.md) §4.1–4.3。

---

## 5–9. 其余章节

RPC 批取、配置、依赖、风险与 Ifx 对照表见英文版 [`design.md`](./design.md) §5–9（内容等价）。
