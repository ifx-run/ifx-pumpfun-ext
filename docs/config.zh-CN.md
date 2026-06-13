[English](./config.md) | 中文

# 配置说明

从 example 复制并本地编辑（均已 gitignore）：

- TOML：`cp config.example.toml config.toml`
- JSON：`cp config.example.json config.json`

**只保留一种格式** — 若两个文件同时存在，**优先读 `config.toml`**。

自定义路径：`IFX_PUMPFUN_CONFIG=/path/to/config.toml`。

参考副本：[`config.example.toml`](../config.example.toml)、[`config.example.json`](../config.example.json)。

## 中心化账户（分开配置）

| 段 | 用途 | 必填 |
|----|------|------|
| **`serviceFee`** / `[service_fee]` | 平台手续费收款（仅接收） | 只需 `pubkey` |
| **`sponsor`** / `[sponsor]` | SOL quote 代付 + 偿还 | `enabled=true` 时需 `pubkey` + `keypairPath`（需 co-sign） |

手续费 CPI 把 quote 转到 **`serviceFee.pubkey`**，运营方无需签名。代付从 **`sponsor.keypairPath`** 加载密钥 co-sign。

**不要在配置里写明文私钥。** 仅 sponsor 需要 keypair 文件（见 [`keys/README.md`](../keys/README.md)）。

**USDC quote：** 启用前须预先创建 **`serviceFee.pubkey`** 的 USDC ATA。

## 环境变量

见 [`config.md`](./config.md) 表格（含 `IFX_PUMPFUN_SERVICE_FEE_PUBKEY`、`IFX_PUMPFUN_SPONSOR_PUBKEY` 等）。

## 平台手续费

- 只收 **quote**（SOL / USDC），永不收 pump 代币
- 买入：第一跳**前**扣；卖出：第一跳**后**扣；互换：第一跳后、第二跳**前**扣

## 公共 Frame

配置 **`public_frames`** / `publicFrames`；不创建 Frame、不解码链上 Frame 账户。
