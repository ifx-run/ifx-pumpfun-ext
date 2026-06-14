[English](./ifx-sdk-feedback.md) | 中文

# Ifx TypeScript SDK — 来自 `ifx-pumpfun-ext` 的改进建议

本文档汇总在 **ifx-pumpfun-ext** 样板项目研发与 mainnet 落地过程中，对 [`@ifx-run/sdk`](https://github.com/ifx-run/ifx/tree/main/sdk) 的改进建议，并明确 **SDK 应改什么、集成方应自己负责什么**。

**背景：** Pump.fun bonding curve v2 买卖/两跳互换、条件关 ATA、平台费、SOL sponsor 代付与偿还 —— 均在单笔 v0 交易内由 Ifx 编排完成。

**参考 SDK 版本：** `@ifx-run/sdk` ^0.1.0（mainnet program `ifxmwWVVZ…`）。

---

## 1. SDK 职责边界（共识）

Ifx SDK 应提供 **通用编排原语**，而不是替每个 DEX / 每个产品包办整条交易：

| 属于 SDK | 不属于 SDK |
|----------|------------|
| `FrameScratch`、`letBuilder`、`expr` | 整笔 tx 能否塞进 1232B（含 DEX、ALT、签名数） |
| `rawCpi` / `structuredCpi`、`ifx_if_else` | 某个 DEX 指令里第几个字节该 patch |
| 类型安全的 binding、公共 Frame 工厂 | sponsor / 两跳 / 关 ATA 等业务 planner |
| 可选：Ifx 指令 decode、tape 容量校验 | Pump / Raydium / Jupiter 的 offset 穷举 |

**examples / tests**（`two-hop-token-swap`、`sponsored_buy`、`dust-destroy-token2022`）的定位是 **参考模式**，不是可 import 的业务库 —— 稍有差异（SOL lamports delta vs USDC ATA 绝对值、费在 hop 前还是 hop 后）就复用不了，粗粒度 planner 价值有限。

---

## 2. SDK 应改（P0–P1）

### 2.1 `instanceof PublicKey` — 多份 `@solana/web3.js` 冲突

**现象：** 应用的 `PublicKey` 与 SDK 捆绑的 `web3.js` 不是同一构造函数时，`letBuilder.lamports(user)` 会失败（`toLetAccountMeta` 用 `instanceof PublicKey`）。

**本项目 workaround：** `src/ifx/let-account.ts` → `asIfxLetAccount()` 包成 `AccountMeta`。

**建议 SDK 修复：** 对 `LetAccountInput` 做 duck typing（`toBase58` / `toBytes`），或接受 `AccountMeta` 为首选形态并写进文档。**这是 SDK 层 bug，不应由每个集成方永久 workaround。**

**优先级：** P0。

---

### 2.2 Binding 类型应公开导出

**现象：** 跨模块传递链上 binding 时只能写 `any`：

```ts
// src/ifx/planner/sponsor.ts
export type U64Binding = any;
```

**建议：** 公开导出 `ScratchValue<IfxTy>`（至少 `ScratchValue<"u64">`），让 `expr.sub(quoteDelta, fee)` 的返回值在 TypeScript 里可追踪。**这是通用能力，不是业务 planner。**

**优先级：** P1。

---

### 2.3 `FrameScratch` 公共 Frame 构造应更简单

**现象：** 六个位置参数，易混淆 `authority` 与 `programId`；公共 Frame 需知 `authority === frame` PDA。

**本项目：** `src/ifx/frames.ts`

```ts
new FrameScratch(frame, DEFAULT_TAPE_LEN, 0, 0, program, frame);
```

**建议：**

```ts
FrameScratch.forPublicFrame({ framePubkey, programId, tapeLen?: DEFAULT_TAPE_LEN });
```

**优先级：** P1。

---

## 3. 集成方负责（不应进 SDK）

### 3.1 整笔交易体积与 `tryCompile`

**现象：** swap + sponsor 实测 ~1339B，超 legacy 1232B 上限。

**本项目做法：** `src/ifx/build.ts` 里 `compileToV0Message` + `tryCompile()`、可选丢弃 smart-close、API 回传 `transactionSizeBytes`。

**为何不进 SDK：** 体积取决于 **DEX 账户数、ALT、ComputeBudget、签名数、是否 v0** 等整笔交易因素，不是 Ifx 单独能估算的。Solana 侧已有 `compileToV0Message` 失败即反馈；是否降级（去掉 close ix）、是否禁用 sponsor，是 **产品 / 集成方策略**。

SDK 可在文档里注明「每条 `ifx_let` / `ifx_patched_cpi` 有固定 wire 开销」，但 **不提供** `compilePreview` 类 API。

---

### 3.2 第三方 DEX 的 `rawCpiPatch` offset

**现象：**

```ts
// src/pump/patch-offsets.ts — Pump.fun 专用
export const BUY_EXACT_QUOTE_IN_V2_SPENDABLE_QUOTE_IN_OFFSET = 8;
```

**为何不进 SDK：** `rawCpi` 的设计就是 **type-unsafe 逃生口**（见 ifx `raw-cpi-patches` 文档）。Pump、Raydium、自定义 program 的 layout 各不同，SDK **不能也不应** 穷举所有 DEX 的字段 offset。

集成方职责：对照目标 program 的 IDL / 文档，在本项目内维护常量；升级 IDL 时自行回归。SDK 文档可补充 **如何** 推导 Anchor 布局（discriminator 8 字节 + args），但不内置 Pump 专用 helper。

---

### 3.3 业务 planner（sponsor / 两跳 / 条件关 ATA）

**现象：** 本仓库 `src/ifx/planner/*` 与 ifx 官方 examples/tests 模式相似，但是 **Pump + 平台费 + sponsor 规则** 下的具体实现。

**为何不进 SDK：**

- SOL quote 测 **lamports delta**，USDC 测 **SPL ATA**，fee 在 buy 前 / sell 后 / swap 中间 —— 都是业务选择。
- 粗粒度 `@ifx-run/sdk/planners` 稍改就错，维护成本高、误导集成方以为「import 即可生产」。

**SDK 正确做法：** 保持 examples/tests 作参考；导出足够通用的 `letBuilder`、`rawCpiPatch`、`structuredCpiPatch`、`ifElseArgs` 即可。

---

## 4. 可选改进（P2，仍属通用能力）

以下不阻塞生产，但若做，应仍是 **与 venue 无关** 的 SDK 能力：

| 项 | 说明 | 优先级 |
|----|------|--------|
| **Ifx 指令 decode** | 本项目在 `tx-inspect.ts` 自维护 discriminator；可收进 SDK 的 `decodeIfxInstruction` | P2 |
| **Tape / binding 规划期校验** | `Value.index` 为 u8；复杂路由应用 `planRecordOffsets` 失败时给出清晰错误 | P2 |
| **Simulate / log 解析** | `parseIfxLogs` 便于调试，不涉及 DEX | P2 |
| **精简 peer 依赖** | 减少强绑 `@anchor-lang/core` 的安装面 | P2 |
| **文档：let 合并与 wire 开销** | 指导减少不必要的多条 `ifx_let`；mainnet 体积表见本项目 README | P2 |
| **链上合并 let（程序层）** | 减 wire 体积，非 SDK alone | P3 |

「静态 vs patch 转账何时用」属于 **集成文档**（可参考本项目 `docs/design.md` §2.4），不必做成 SDK API。

---

## 5. 非 SDK 边界（架构结论）

| 主题 | 结论 |
|------|------|
| **1232 字节墙** | Ifx 胶水 + 胖 DEX 占满 headroom 时，薄 wrapper 是集成方架构选择 |
| **正确性 vs 体积** | hop-2 必须 `ifx_let` 动态金额，不能 quote 快照（TOCTOU） |
| **ALT** | 集成方配置；SDK 不管理 lookup table |
| **公共 Frame 运维** | Frame 池 provisioning 属 ifx 运维，非 SDK runtime |

---

## 6. 建议路线图（修订）

| 优先级 | 项 | 归属 |
|--------|-----|------|
| **P0** | 修复 `PublicKey` / `LetAccountInput` 身份判断 | **SDK** |
| **P1** | 公开导出 `ScratchValue<T>` | **SDK** |
| **P1** | `FrameScratch.forPublicFrame()` | **SDK** |
| — | 整笔 tx 体积、`tryCompile`、smart-close 降级 | **集成方** |
| — | DEX `rawCpiPatch` offset 常量 | **集成方** |
| — | sponsor / swap / close 业务 planner | **集成方**（参考 examples） |
| P2 | Ifx ix decode、log 解析、tape 校验 | SDK（可选） |
| P3 | 链上减 wire 体积 | Ifx program |

---

## 7. 本仓库参考文件

| 文件 | 说明 |
|------|------|
| `src/ifx/let-account.ts` | PublicKey workaround（SDK 修后可删） |
| `src/ifx/frames.ts` | 公共 Frame scratch |
| `src/ifx/planner/*.ts` | **业务层** planner，非 SDK 范围 |
| `src/pump/patch-offsets.ts` | **Pump 专用** patch offset |
| `src/ifx/build.ts` | **集成方** tryCompile / 体积门控 |
| `src/util/tx-inspect.ts` | Inspector（可选迁入 SDK decode） |
| `README.md` § Ifx vs wrapper | mainnet 体积与边界反思 |

---

*基于 ifx-pumpfun-ext mainnet 集成经验；范围划分已与项目维护者对齐。*
