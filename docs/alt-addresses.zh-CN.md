# Pump.fun × Ifx — ALT 地址清单

本文档汇总 **ifx-pumpfun-ext** 在 mainnet 组 v0 交易时，适合放进 Address Lookup Table (ALT) 的固定/半固定地址。  
目标：在启用 `solana.address_lookup_tables` 后，把单笔 legacy 交易放不下的账户（尤其 buy + Ifx close）压缩进 1232 字节包内。

> **链**：Solana Mainnet-Beta  
> **Pump SDK 参考版本**：`@pump-fun/pump-sdk` ^1.36（仓库内锁定版本）  
> **Ifx 参考**：`config.example.toml` 默认 `program_id` / `public_frames`

---

## 1. 本项目如何使用 ALT

`config.toml`：

```toml
[solana]
address_lookup_tables = [
  "YourCreatedAltPubkey...",
]
```

- 每次 `/api/tx/build` 会 **固定编译 v0 交易**，并把上述 ALT 传给 `compileToV0Message`。
- build 时从 RPC 拉取 ALT 链上状态（带 `rpc_cache_ttl_ms` 缓存）。
- **ALT 里必须已 extend 对应地址**，否则 v0 编译无法把账户索引化，体积也不会下降。

---

## 2. 不适合 / 不适合单独做「全局 ALT」的地址

| 类型 | 示例 | 说明 |
|------|------|------|
| 用户钱包 | `user` | 每笔交易不同 |
| 用户 SPL ATA | base / WSOL / USDC ATA | 随用户与 mint 变化 |
| Token mint | 各 Pump 代币 mint | 海量、不可枚举 |
| Bonding curve PDA | `bonding-curve` + mint | **每个 token 一个** |
| BC 侧 ATA | `associated_base/quote_bonding_curve` | 随 mint 变化 |
| Creator vault | `creator-vault` + creator | 随 token creator 变化 |
| User volume accumulator | `user_volume_accumulator` + user | 随用户变化 |

**建议**：全局 ALT 只放 **程序 ID、Sysvar、Global PDA、Quote mint、协议 fee 池** 等；若某几个 token 交易特别频繁，可另建 **per-mint 扩展 ALT**（见 §6）。

---

## 2.5 准确性说明（对照本仓库 `buy/sell v2`）

**不能简单说「附录里每个地址每笔 tx 都会用到」。** 下面按「是否与具体 token mint 无关」和「本仓库 bonding curve 买卖是否引用」分开说明（依据 Pump IDL + 本地 `accountsPartial` 组出来的 `buy_exact_quote_in_v2` 共 **27** 个账户）。

| 类别 | 与 token mint 无关？ | 本仓库 buy/sell v2 是否引用 | 说明 |
|------|---------------------|----------------------------|------|
| Tier A（System/SPL/ComputeBudget/Ifx/Pump program+Global+event） | 是 | **是**（Pump 侧） | ComputeBudget / Ifx 在 Pump ix 之外另算 |
| Tier B：`fee_program` + `fee_config` + `global_volume_accumulator` | 是 | **是** | IDL 固定账户 |
| Tier B：AMM / Mayhem / `pump` 平台币 mint / fee-program-global / fee event authority | 是 | **否** | Pump 生态其它路径；**bonding curve v2 买卖账户表里没有** |
| Tier C/D：fee & buyback 钱包 + quote ATA | 是（与 **quote mint** 绑定，非 base mint） | **每笔随机 1+1** | 16 个钱包不会同时出现；Mayhem 模式 protocol fee 来自链上 `Global.reservedFeeRecipients`，**可能不在 Tier C 列表内** |
| 用户 / creator / bonding curve / sharing_config 等 | 否 | **是** | 不应进「全局」ALT；`sharing_config` 按 base mint 派生 |

**Buyback 收款方**：本仓库写死在 `src/pump/fees.ts`，与 token 无关，Tier C 下半区 + Tier D 对应 ATA 可放心 extend。

**Protocol fee 收款方**：运行时从链上 `Global` 读取（`pumpFeeRecipient`），Tier C 上半区与 SDK 静态表 **通常一致**，但 Mayhem 或 Global 升级后要以链上为准，并补 extend 对应 quote ATA。

**USDC 池**：Tier D 含 WSOL / USDC 两套协议 fee ATA；平台费 USDC ATA 在 Tier E。脚本默认两套都 extend。

---

## 3. 推荐 ALT 分层

### Tier A — 每条业务 tx 都会出现（必放）

Solana 系统 + SPL + 预算 + Ifx + Pump 核心。

| 标签 | 地址 |
|------|------|
| System Program | `11111111111111111111111111111111` |
| Compute Budget | `ComputeBudget111111111111111111111111111111` |
| SPL Token (legacy) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| SPL Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| WSOL mint | `So11111111111111111111111111111111111111112` |
| USDC mint (Pump whitelist quote) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| **Pump program** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| Pump Global PDA | `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` |
| Pump event authority | `Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1` |
| **Ifx program** | `ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj` |
| **Ifx public Frame**（默认示例） | `6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn` |

`ifx.public_frames` 配置了多个 Frame 时，**每个 Frame 都应加入 ALT**（每笔 build 随机选一个 Frame）。

### Tier B — Pump bonding curve v2 实际会引用的静态地址

以下在 `buy_exact_quote_in_v2` / `sell_v2` IDL 账户表中 **确实出现**（已与本地组 ix 核对）：

| 标签 | 地址 |
|------|------|
| Pump fee program | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Pump fee config PDA | `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt` |
| Global volume accumulator | `Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y` |

### Tier B′ — Pump 生态其它路径（与 token 无关，但本仓库 buy/sell **不引用**）

可 extend 进同一张 ALT（无害，略增表大小），但 **对压缩本项目的 bonding curve 交易体积没有帮助**：

| 标签 | 地址 | 典型用途 |
|------|------|----------|
| Pump fee program global | `CHqnuTkj6sXDFknM652aEFPECZh9qVsBXWkhPohmV9dA` | pump-fees 管理 ix |
| Pump fee event authority | `D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML` | pump-fees 事件 |
| Pump AMM program | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | BC 毕业后 swap |
| Pump AMM global | `HsC37rNFvJgpfH7y2Y6kqnwEQN4WfdM5FLArWnux5GUs` | AMM |
| Pump AMM event authority | `GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR` | AMM |
| Mayhem program | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | 创建 / Mayhem 专用 ix |
| Mayhem global params | `13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ` | Mayhem |
| Mayhem SOL vault | `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s` | Mayhem |
| PUMP 平台代币 mint | `pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn` | 平台币，非 BC 买卖账户 |

### Tier C — 协议 fee / buyback 收款方

Pump 每笔 buy/sell v2 会随机选一个 **protocol fee recipient** 和一个 **buyback fee recipient**（与平台 `serviceFee` 无关）。

- **Buyback**：本仓库 `src/pump/fees.ts` 硬编码，下表 8 个地址确定会用（随机其一）。
- **Protocol fee**：本仓库 `pumpFeeRecipient(global, mayhemMode)` 从链上 **Global** 读 `feeRecipient` + `feeRecipients`（普通）或 `reservedFeeRecipient(s)`（Mayhem）。下表与 SDK `CURRENT_FEE_RECIPIENTS` 对齐，**常规 token 足够**；Mayhem 若链上 reserved 集合不同，需额外 extend 那些钱包及其 quote ATA。

**Protocol fee recipients（8）**

| # | 地址 |
|---|------|
| 1 | `62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV` |
| 2 | `7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ` |
| 3 | `7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX` |
| 4 | `9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz` |
| 5 | `AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY` |
| 6 | `CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM` |
| 7 | `FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz` |
| 8 | `G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP` |

**Buyback fee recipients（8）** — 与 `src/pump/fees.ts` 中 `BUYBACK_RECIPIENTS` 一致

| # | 地址 |
|---|------|
| 1 | `5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD` |
| 2 | `9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7` |
| 3 | `GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL` |
| 4 | `3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR` |
| 5 | `5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6` |
| 6 | `EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL` |
| 7 | `5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD` |
| 8 | `A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW` |

### Tier D — Quote ATA（SOL / USDC 路径强烈建议）

`buy_exact_quote_in_v2` / `sell_v2` 会引用 **fee / buyback 在 quote mint 下的 ATA**。  
Legacy SOL 池实际 quote 为 WSOL；USDC 池 quote 为 USDC。

**WSOL ATA（SOL quote 路径）**

| Owner (fee recipient) | WSOL ATA |
|------------------------|----------|
| `62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV` | `94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb` |
| `7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ` | `7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC` |
| `7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX` | `X5QPJcpph4mBAJDzc4hRziFftSbcygV59kRb2Fu6Je1` |
| `9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz` | `Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS` |
| `AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY` | `FGptqdxjahafaCzpZ1T6EDtCzYMv7Dyn5MgBLyB3VUFW` |
| `CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM` | `CGEWR6pxwgQvYKeX4pZDqpZtWYPvyTjiAsw86SNzJtGy` |
| `FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz` | `7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx` |
| `G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP` | `BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA` |

| Owner (buyback) | WSOL ATA |
|-----------------|----------|
| `5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD` | `HjQjngTDqoHE6aaGhUqfz9aQ7WZcBRjy5xB8PScLSr8i` |
| `9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7` | `GAFuhgcd328SkkBYHpfadzmef9hTGAFRCi9QoCnsZQug` |
| `GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL` | `AktftA98kSWAxn6kVSoqBXBELUArjKu2H9WmKB48ULFY` |
| `3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR` | `6rVkF4HSgy1jrnC3HogfRgPHrq4CtLg5f11URpsC4i9D` |
| `5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6` | `GYH1Gae1wJytMSvMvw8JVcv7nuAbxi8i9erNVbERnzXd` |
| `EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL` | `CA7v8gHfbquYXyDnDx6QxWW8hmL1H7X6Y2RYDrGLnuck` |
| `5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD` | `CASRL2zkwDnppxEFQ4LgdwgR9pdz5Q8R8nEMKVZ9QoLp` |
| `A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW` | `qkYdTGRPHbWTWuBMz45bCiU6a23axRqf6sBHm9295WY` |

**USDC ATA（USDC quote 路径）** — `ATA(USDC, owner, allowOwnerOffCurve=true)`，与 WSOL 表同一批 16 个 owner

| Owner (fee recipient) | USDC ATA |
|------------------------|----------|
| `62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV` | `BqcWAXkSdknwQxvqXYVGKtttZynYNHACPVJmTaoqgfv8` |
| `7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ` | `3beutiWC6iV5Hz2RC711oXTqWa93rHUwsS58xWBHyTd6` |
| `7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX` | `FC6zaBZjnJ1tF5nY4b2nrPgu62thjXdRkk2sEtjxU16E` |
| `9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz` | `C5bwoYa7RD7Prc2u36idJ3hDjTvvoXPdBdx4iYeDVaQj` |
| `AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY` | `APnwGpYPQJqpndpjZFUFUrzsSU2sd2SG9qKtpXQgRimu` |
| `CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM` | `CN371Div8bqcEqq2grrGQfBX7geFLgHATEFMNLEuQs1U` |
| `FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz` | `2yC9PAQvtxFjdV2G79N7cGsFhitbNiEQmZ3Z6dmLWfQg` |
| `G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP` | `BMqY71czEnfwxTp7zTc3Wdkushpn8VfSJ6NGZX11djM1` |

| Owner (buyback) | USDC ATA |
|-----------------|----------|
| `5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD` | `6oCkp6gpyjxVTeL6ahMYcekN2x2pzt1KY8g2LqemaTNE` |
| `9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7` | `DxvbV1rR2hmFJ2gYGXmz7jnMPsvf39M1BWd3Ejshd3Zj` |
| `GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL` | `H2CUXP4v2ZSWEFvnj9C6RbbD8cNNZPLK3H374nKARN1t` |
| `3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR` | `9JR4rG7BK32TVENGAcKMseS7tdoz3Y5pXeSq234MEowH` |
| `5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6` | `4EcDKGwpgYLVnMmjJCDrUN2DVLQKSpSKyMhqU1GbuMsv` |
| `EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL` | `EZbmj4jpfk9GGgRNfzX3e13Zo4ZaNMHQ5UUmRVcZQyEF` |
| `5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD` | `BJQ1HTx43bBDF1ba8GfZAfxSMZneTmQNr5m9yUfx6vAu` |
| `A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW` | `fewxWzSMHpHhDT9c5FysEXnHXtxvWVeHPvFVTyZdPwh` |

`scripts/alt-addresses.ts` 与 `npm run alt:extend` **默认同时 extend WSOL + USDC 两套**（纯 SOL 店可用 `--no-usdc-atas`，纯 USDC 店可用 `--no-wsol-atas`）。

### Tier E — 平台手续费（本项目 `service_fee`）

与 Pump 协议 fee（Tier C/D）无关，为本仓库 `config.toml` → `[service_fee].pubkey` 收取的平台费。

| 标签 | 地址 | 说明 |
|------|------|------|
| Platform service fee recipient | `BKNnVDyzcPGCWnk8zX3Cn2KKhLASk5iTjVpxUW7YTb8P` | SOL 路径直接转账收款方；USDC 路径 SPL 转出 owner |
| Service fee USDC ATA | `GX5xun6rCNC72WJrTx75Z7do3wLigXsKf8kDPeDVoCcv` | USDC 池 platform fee 转入目标（`ATA(USDC, recipient)`） |

`config.toml` 示例：

```toml
[service_fee]
bps = 5
pubkey = "BKNnVDyzcPGCWnk8zX3Cn2KKhLASk5iTjVpxUW7YTb8P"
```

启用 USDC 池或 USDC 平台费时，**recipient 与 USDC ATA 都应 extend 进 ALT**。

| Sponsor pubkey | `sponsor.pubkey` | 启用 sponsor 时为 fee payer / 偿还接收方（按实际配置） |

---

## 4. Ifx 编排相关账户

每笔 tx 指令顺序（简化）：

```
ComputeBudget ×2 → ifx_reset → [SPL ATA create] → [service fee] → [wrap SOL] → pump buy/sell
→ ifx_let / ifx_if_else (close ATA) → [sponsor repay]
```

Ifx 指令 **remaining accounts** 中会重复出现：

- **Frame**（Tier A，必在 ALT）
- **Ifx program**（Tier A）
- **Token / Token-2022 program**（close & CPI 模板）
- 被 `let` / `close` 的用户 ATA（Tier「不适合全局 ALT」— 用户侧账户）

把 **程序 ID + Frame + Pump Global + 协议 fee 池** 放进 ALT，通常即可把 buy + close 从 ~1260B 压到 1232B 以内。

---

## 5. 创建与 extend ALT

### 仓库脚本（create + extend）

地址列表见 `scripts/alt-addresses.ts`（与本文附录一致，含平台手续费 Tier E）。

**只有 authority 私钥、还没有 ALT 时**（不传 `--lookup-table`）会自动建表再 extend：

```bash
npm run alt:extend -- \
  --payer-keypair ./keys/payer.json \
  --authority-keypair ./keys/alt-authority.json
```

**已有 ALT 时**传入 `--lookup-table`（create 输出的 Lookup Table Address）只 extend；链上查不到该地址时会自动新建一张表。

```bash
npm run alt:extend -- \
  --payer-keypair ./keys/payer.json \
  --authority-keypair ./keys/alt-authority.json \
  --lookup-table <ALT_ACCOUNT_PUBKEY>
```

| 参数 | 含义 |
|------|------|
| `--payer-keypair` | 付 gas / rent 的钱包私钥文件 |
| `--authority-keypair` | ALT authority 私钥（创建时写入链上，有权 extend） |
| `--lookup-table` | 可选；ALT **账户地址**（公钥），不是私钥文件 |

若 payer 与 authority 是同一钱包，两个 `--*-keypair` 可指向同一文件。

```bash
# 可选：跳过 WSOL 或 USDC 协议 fee ATA（默认两套都加）
npm run alt:extend -- --payer-keypair ./keys/payer.json --authority-keypair ./keys/alt-authority.json --no-wsol-atas
npm run alt:extend -- --payer-keypair ./keys/payer.json --authority-keypair ./keys/alt-authority.json --lookup-table <ALT> --minimal
```

每次 extend 前会**拉取链上已有地址**去重；重复执行不会浪费 256 槽位。脚本结束会打印应写入 `config.toml` 的 lookup table 地址。

### 备选：Solana CLI

```bash
solana address-lookup-table create --keypair ./keys/alt-authority.json --url <RPC>
solana address-lookup-table extend <ALT_PUBKEY> \
  --keypair ./keys/alt-authority.json \
  --addresses ... \
  --url <RPC>
```

**限制**：

- 单张 ALT 最多 **256** 地址；Tier A–D 合计约 **70+**，一张表足够起步。
- 单 tx 最多引用 **64** 个 ALT 账户索引；可配置 **多张 ALT**（`address_lookup_tables` 数组）。

---

## 6. 按 Token 扩展（可选第二张 ALT）

若主要交易集中在少数 mint，可额外 extend：

| 派生 | Seeds / 公式 |
|------|----------------|
| Bonding curve | `["bonding-curve", mint]` @ Pump program |
| Bonding curve v2 | `["bonding-curve-v2", mint]` @ Pump program |
| BC base ATA | ATA(mint, bonding_curve, base_token_program) |
| BC quote ATA | ATA(quote_mint, bonding_curve, quote_token_program) |
| Creator vault | `["creator-vault", creator]` @ Pump program |
| Creator vault quote ATA | ATA(quote_mint, creator_vault, quote_token_program) |

Pump SDK 辅助函数：`bondingCurvePda(mint)`、`bondingCurveV2Pda(mint)`、`creatorVaultPda(creator)`、`quoteAta(owner, quoteMint, program)`。

---

## 7. 维护说明

1. **Pump SDK 升级**后复查 Tier C/D（fee recipient 列表可能变更）。
2. **Mayhem 模式** token 可能走 `reservedFeeRecipient` 集合；链上 Global 账户另有动态列表，极端情况下需补充 extend。
3. **Ifx `public_frames`** 增删时同步更新 ALT。
4. extend 后需 **1 个 slot** 左右生效，再用于 build。
5. 本仓库 build 仅 **读取** ALT，不负责创建；ALT authority 由运营方自持。

---

## 附录 A — 一键复制地址列表（Tier A + B + C + 默认 Frame）

用于脚本 `extend`（不含 Tier D WSOL ATA；可按 §Tier D 表追加）。

```
11111111111111111111111111111111
ComputeBudget111111111111111111111111111111
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
So11111111111111111111111111111111111111112
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1
ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj
6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn
pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt
CHqnuTkj6sXDFknM652aEFPECZh9qVsBXWkhPohmV9dA
D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML
Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y
pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
HsC37rNFvJgpfH7y2Y6kqnwEQN4WfdM5FLArWnux5GUs
GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR
MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e
13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ
BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s
pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV
7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ
7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX
9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz
AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY
CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM
FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz
G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP
5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD
9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7
GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL
3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR
5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6
EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL
5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD
A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW
```

**附录 B — Tier D WSOL ATA 全集**（16 个，建议 SOL 主路径一并 extend）

```
94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb
7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC
X5QPJcpph4mBAJDzc4hRziFftSbcygV59kRb2Fu6Je1
Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS
FGptqdxjahafaCzpZ1T6EDtCzYMv7Dyn5MgBLyB3VUFW
CGEWR6pxwgQvYKeX4pZDqpZtWYPvyTjiAsw86SNzJtGy
7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx
BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA
HjQjngTDqoHE6aaGhUqfz9aQ7WZcBRjy5xB8PScLSr8i
GAFuhgcd328SkkBYHpfadzmef9hTGAFRCi9QoCnsZQug
AktftA98kSWAxn6kVSoqBXBELUArjKu2H9WmKB48ULFY
6rVkF4HSgy1jrnC3HogfRgPHrq4CtLg5f11URpsC4i9D
GYH1Gae1wJytMSvMvw8JVcv7nuAbxi8i9erNVbERnzXd
CA7v8gHfbquYXyDnDx6QxWW8hmL1H7X6Y2RYDrGLnuck
CASRL2zkwDnppxEFQ4LgdwgR9pdz5Q8R8nEMKVZ9QoLp
qkYdTGRPHbWTWuBMz45bCiU6a23axRqf6sBHm9295WY
```

**附录 C — Tier D USDC ATA 全集**（16 个，USDC quote 路径）

```
BqcWAXkSdknwQxvqXYVGKtttZynYNHACPVJmTaoqgfv8
3beutiWC6iV5Hz2RC711oXTqWa93rHUwsS58xWBHyTd6
FC6zaBZjnJ1tF5nY4b2nrPgu62thjXdRkk2sEtjxU16E
C5bwoYa7RD7Prc2u36idJ3hDjTvvoXPdBdx4iYeDVaQj
APnwGpYPQJqpndpjZFUFUrzsSU2sd2SG9qKtpXQgRimu
CN371Div8bqcEqq2grrGQfBX7geFLgHATEFMNLEuQs1U
2yC9PAQvtxFjdV2G79N7cGsFhitbNiEQmZ3Z6dmLWfQg
BMqY71czEnfwxTp7zTc3Wdkushpn8VfSJ6NGZX11djM1
6oCkp6gpyjxVTeL6ahMYcekN2x2pzt1KY8g2LqemaTNE
DxvbV1rR2hmFJ2gYGXmz7jnMPsvf39M1BWd3Ejshd3Zj
H2CUXP4v2ZSWEFvnj9C6RbbD8cNNZPLK3H374nKARN1t
9JR4rG7BK32TVENGAcKMseS7tdoz3Y5pXeSq234MEowH
4EcDKGwpgYLVnMmjJCDrUN2DVLQKSpSKyMhqU1GbuMsv
EZbmj4jpfk9GGgRNfzX3e13Zo4ZaNMHQ5UUmRVcZQyEF
BJQ1HTx43bBDF1ba8GfZAfxSMZneTmQNr5m9yUfx6vAu
fewxWzSMHpHhDT9c5FysEXnHXtxvWVeHPvFVTyZdPwh
```

**附录 D — 平台手续费（Tier E）**

```
BKNnVDyzcPGCWnk8zX3Cn2KKhLASk5iTjVpxUW7YTb8P
GX5xun6rCNC72WJrTx75Z7do3wLigXsKf8kDPeDVoCcv
```

---

## 相关配置

- 示例配置：`config.example.toml` → `[solana].address_lookup_tables`
- 实现：`src/solana/alt.ts`、`src/ifx/build.ts` → `finalizeTx`（v0 + ALT）
