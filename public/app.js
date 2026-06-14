import { Connection, VersionedTransaction } from "@solana/web3.js";

const $ = (id) => document.getElementById(id);

let publicConfig = {
  debounceMs: 300,
  defaultSlippageBps: 100,
  rpcUrl: "https://api.mainnet-beta.solana.com",
  balanceRefreshIntervalMs: 30_000,
};
let resolveState = null;
let quoteAbort = null;
let lastQuoteSnapshot = null;
let lastQuoteExceedsBalance = false;
let walletProvider = null;
let walletPubkey = null;

const BLOCKHASH_RETRIES = 3;
const MIN_MINT_LEN = 32;

let debounceTimer;
let resolveDebounceTimer;
let balanceRefreshTimer;
let resolveInFlight = false;
let resolvePending = false;

function logClientError(phase, err, context) {
  console.error(`[ifx-pumpfun] ${phase}`, err);
  if (context) console.error(`[ifx-pumpfun] ${phase} context`, context);
  if (err?.stack) console.error(err.stack);
}

function getWalletProvider() {
  if (window.solana?.isPhantom) return window.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  return window.solana ?? null;
}

function formatRawToUi(raw, decimals) {
  if (decimals === 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

function quoteAssetDecimals(label) {
  if (label === "SOL") return 9;
  if (label === "USDC") return 6;
  return null;
}

/** Format on-chain raw amount for SOL (lamports) or USDC (6 dec). */
function formatQuoteAsset(rawStr, label) {
  const dec = quoteAssetDecimals(label);
  if (dec == null) return rawStr;
  try {
    return formatRawToUi(BigInt(rawStr), dec);
  } catch {
    return rawStr;
  }
}

function quoteStatRow(term, value, hint = "") {
  const hintHtml = hint
    ? `<span class="quote-stat-hint">${hint}</span>`
    : "";
  return `<div class="quote-stat"><dt>${term}</dt><dd>${value}${hintHtml}</dd></div>`;
}

function setQuotePanelState(state) {
  $("quotePanel").className = `quote-panel quote-panel--${state}`;
}

function renderQuoteIdle(message = "Enter amount to get a quote.") {
  setQuotePanelState("idle");
  $("quoteHeroEyebrow").textContent = "Quote";
  $("quoteHeroAmount").textContent = "—";
  $("quoteHeroUnit").textContent = "";
  $("quoteHeroMin").textContent = message;
  $("quoteHeroMin").className = "quote-hero-min muted";
  $("quoteStats").classList.add("hidden");
  $("quoteStats").innerHTML = "";
  $("quoteAlerts").innerHTML = "";
  $("quoteTech").classList.add("hidden");
  $("quoteTechBody").textContent = "";
}

function renderQuoteLoading() {
  setQuotePanelState("loading");
  $("quoteHeroEyebrow").textContent = "Quoting…";
  $("quoteHeroAmount").textContent = "…";
  $("quoteHeroUnit").textContent = "";
  $("quoteHeroMin").textContent = "";
  $("quoteHeroMin").className = "quote-hero-min muted";
  $("quoteStats").classList.add("hidden");
  $("quoteAlerts").innerHTML = "";
  $("quoteTech").classList.add("hidden");
}

function renderQuoteError(message) {
  setQuotePanelState("error");
  $("quoteHeroEyebrow").textContent = "Quote failed";
  $("quoteHeroAmount").textContent = "—";
  $("quoteHeroUnit").textContent = "";
  $("quoteHeroMin").textContent = message;
  $("quoteHeroMin").className = "quote-hero-min error";
  $("quoteStats").classList.add("hidden");
  $("quoteAlerts").innerHTML = "";
  $("quoteTech").classList.add("hidden");
}

/** Which asset the input field spends and its on-chain balance. */
function getInputBalance() {
  if (!walletPubkey || !resolveState?.wallet) return null;

  const mode = $("mode").value;
  const side = $("side").value;
  const w = resolveState.wallet;

  if (mode === "swap" || side === "sell") {
    if (!w.baseA) return null;
    return {
      raw: BigInt(w.baseA.raw),
      decimals: w.baseA.decimals,
      label: "base A",
    };
  }
  if (resolveState.tokenA.quoteLabel === "SOL") {
    return { raw: BigInt(w.solRaw), decimals: 9, label: "SOL" };
  }
  return { raw: BigInt(w.usdcRaw), decimals: 6, label: "USDC" };
}

function updateBalancePctButtons() {
  const bal = getInputBalance();
  const enabled = !!(bal && bal.raw > 0n);
  document.querySelectorAll(".pct-btn").forEach((btn) => {
    btn.disabled = !enabled;
  });
}

function applyBalancePercent(percent) {
  const bal = getInputBalance();
  if (!bal || bal.raw <= 0n) return;

  const pct = BigInt(percent);
  const amountRaw = pct >= 100n ? bal.raw : (bal.raw * pct) / 100n;
  if (amountRaw <= 0n) return;

  $("inputAmount").value = formatRawToUi(amountRaw, bal.decimals);
  scheduleQuote();
}

function shortPubkey(pk) {
  if (!pk || pk.length < 12) return pk ?? "";
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function updateWalletUi() {
  const status = $("walletStatus");
  const connectBtn = $("connectBtn");
  const disconnectBtn = $("disconnectBtn");
  if (walletPubkey) {
    status.textContent = `Connected: ${shortPubkey(walletPubkey)}`;
    status.className = "wallet-status ok";
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
  } else {
    status.textContent = "Wallet not connected";
    status.className = "wallet-status muted";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  }
  updateBuildBtn();
}

function renderResolvePanel(state) {
  const out = $("resolveOut");
  if (!state) {
    out.textContent = "";
    out.className = "resolve-out muted";
    return;
  }
  const a = state.tokenA;
  let html = `<div class="ok">A: quote ${a.quoteLabel} · ${a.decimals} decimals</div>`;
  if (state.wallet) {
    const w = state.wallet;
    html += `<div class="muted">Wallet: ${w.solUi} SOL · ${w.usdcUi} USDC`;
    if (w.baseA) html += ` · ${w.baseA.ui} base A`;
    html += "</div>";
  }
  if (state.tokenB) {
    const b = state.tokenB;
    html += `<div>${state.swapEligible ? "✓" : "✗"} B: quote ${b.quoteLabel}`;
    if (!state.swapEligible) {
      html += ` — ${state.swapIneligibleReason}`;
    }
    html += "</div>";
  }
  out.innerHTML = html;
  out.className = "resolve-out";
}

function syncWalletFromQuote(q) {
  if (!q?.wallet || !resolveState) return;
  resolveState.wallet = q.wallet;
  renderResolvePanel(resolveState);
  updateBalancePctButtons();
}

function startBalanceRefreshTimer() {
  stopBalanceRefreshTimer();
  if (!walletPubkey) return;
  const intervalMs = publicConfig.balanceRefreshIntervalMs ?? 30_000;
  balanceRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    if ($("mintA").value.trim()) void refreshWalletState("interval");
  }, intervalMs);
}

function stopBalanceRefreshTimer() {
  if (balanceRefreshTimer) {
    clearInterval(balanceRefreshTimer);
    balanceRefreshTimer = null;
  }
}

/** Re-fetch token + wallet balances, then re-quote if amount is set. */
async function refreshWalletState(_reason) {
  const mintA = $("mintA").value.trim();
  if (!mintA) return;
  await doResolve({ quiet: true });
}

function scheduleResolve() {
  clearTimeout(resolveDebounceTimer);
  resolveDebounceTimer = setTimeout(() => {
    const mintA = $("mintA").value.trim();
    if (!mintA || mintA.length < MIN_MINT_LEN) return;
    void doResolve();
  }, publicConfig.debounceMs ?? 300);
}

function updateBuildBtn() {
  const btn = $("buildSignBtn");
  btn.disabled = !(walletPubkey && lastQuoteSnapshot && !lastQuoteExceedsBalance);
}

function snapshotFromQuote(q) {
  return {
    inputRaw: q.inputRaw,
    inputLabel: q.inputLabel,
    minOutputRaw: q.minOutputRaw,
    serviceFeeRaw: q.serviceFeeRaw,
    serviceFeeLabel: q.serviceFeeLabel,
    netQuoteRaw: q.netQuoteRaw,
    ixKind: q.ixKind,
  };
}

function tradeBodyBase() {
  const mode = $("mode").value;
  const slippageBps = Math.round(Number($("slippage").value || "1") * 100);
  const body = {
    mode,
    mintA: $("mintA").value.trim(),
    inputAmount: $("inputAmount").value.trim(),
    slippageBps,
  };
  if (mode === "trade") body.side = $("side").value;
  else body.mintB = $("mintB").value.trim();
  return body;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? res.statusText)
    );
    err.status = res.status;
    logClientError(`api ${path}`, err, { status: res.status, body });
    throw err;
  }
  return data;
}

function decodeTxBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

async function connectWallet() {
  const provider = getWalletProvider();
  if (!provider) {
    throw new Error("Install Phantom or Solflare to connect.");
  }
  const resp = await provider.connect();
  walletProvider = provider;
  walletPubkey = resp.publicKey.toString();
  updateWalletUi();
  startBalanceRefreshTimer();
  if ($("mintA").value.trim()) await doResolve();
  else scheduleQuote();
}

async function disconnectWallet() {
  if (walletProvider?.disconnect) {
    try {
      await walletProvider.disconnect();
    } catch {
      /* ignore */
    }
  }
  walletProvider = null;
  walletPubkey = null;
  updateWalletUi();
  stopBalanceRefreshTimer();
  updateBalancePctButtons();
}

async function isBlockhashValid(connection, lastValidBlockHeight) {
  if (!lastValidBlockHeight) return true;
  const height = await connection.getBlockHeight("confirmed");
  return height <= lastValidBlockHeight;
}

function isBlockhashSendError(err) {
  const msg = String(err?.message ?? err).toLowerCase();
  return (
    msg.includes("blockhash") ||
    msg.includes("block height exceeded") ||
    msg.includes("transaction expired")
  );
}

async function buildTransaction(body) {
  return api("/api/tx/build", {
    ...body,
    userPubkey: walletPubkey,
    priorityTier: $("priorityTier").value,
    quoteSnapshot: lastQuoteSnapshot,
  });
}

async function signAndSend(connection, built) {
  const tx = decodeTxBase64(built.transaction);

  if (walletProvider.signAndSendTransaction) {
    const result = await walletProvider.signAndSendTransaction(tx, {
      skipPreflight: false,
    });
    const signature =
      typeof result === "string" ? result : result.signature?.toString?.() ?? String(result);
    await connection.confirmTransaction(
      {
        signature,
        blockhash: built.recentBlockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      },
      "confirmed"
    );
    return signature;
  }

  const signed = await walletProvider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    {
      signature,
      blockhash: built.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed"
  );
  return signature;
}

function solscanTxUrl(signature) {
  const rpc = publicConfig.rpcUrl ?? "";
  if (rpc.includes("devnet")) {
    return `https://solscan.io/tx/${signature}?cluster=devnet`;
  }
  if (rpc.includes("testnet")) {
    return `https://solscan.io/tx/${signature}?cluster=testnet`;
  }
  return `https://solscan.io/tx/${signature}`;
}

function renderInspectorBanner(opts) {
  const banner = $("inspectorBanner");
  if (!opts) {
    banner.className = "inspector-banner hidden";
    banner.innerHTML = "";
    return;
  }

  const { kind, title, message, built, signature } = opts;
  const kindClass =
    kind === "success"
      ? "banner-success"
      : kind === "error"
        ? "banner-error"
        : kind === "cancelled"
          ? "banner-cancelled"
          : "banner-progress";

  banner.className = `inspector-banner ${kindClass}`;

  let body = "";
  if (kind === "success" && signature) {
    const url = solscanTxUrl(signature);
    body = `
      <a class="banner-link" href="${url}" target="_blank" rel="noopener">View on Solscan →</a>
      <div class="banner-grid">
        <div>Signature<code>${signature}</code></div>
        <div>Frame<code>${built?.frameUsed ?? "—"}</code></div>
        <div>Fee payer<code>${built?.feePayer ?? walletPubkey ?? "—"}</code></div>
        <div>Tx size<code>${built?.transactionSizeBytes ?? "—"} B${
          built?.smartCloseApplied != null
            ? built.smartCloseApplied
              ? " · smart close"
              : " · no smart close"
            : ""
        }</code></div>
        ${
          built?.partiallySignedBy?.length
            ? `<div>Sponsor<code>${built.partiallySignedBy.map(shortPubkey).join(", ")}</code></div>`
            : ""
        }
      </div>`;
  } else if (message) {
    body = `<div class="muted">${message}</div>`;
  }

  banner.innerHTML = `
    <div class="banner-title ${kind === "success" ? "ok" : kind === "error" ? "error" : ""}">${title}</div>
    ${body}
  `;
}

function acctFlags(isSigner, isWritable) {
  const parts = [];
  if (isSigner) parts.push("S");
  if (isWritable) parts.push("W");
  if (!isSigner && !isWritable) parts.push("R");
  return parts.join("") || "—";
}

function acctResolveLabel(account) {
  if (account.altLoaded) {
    if (account.resolution === "alt-writable") return "ALT·W";
    if (account.resolution === "alt-readonly") return "ALT·R";
    return "ALT";
  }
  if (account.inAltTableUnused) {
    return "static†";
  }
  return "static";
}

function acctResolveTitle(account) {
  if (account.altLoaded) {
    return "Loaded via Address Lookup Table — 1-byte index instead of 32-byte pubkey in message";
  }
  if (account.inAltTableUnused) {
    return "Pubkey is in your ALT table but serialized as static here (signers/fee payer must stay static; others may be compiler placement)";
  }
  return "Full pubkey in message static account keys — not ALT-loaded";
}

function wireCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") ?? "";
      try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });
  });
}

function renderTxInspector(inspection, statusText) {
  const status = $("inspectorStatus");
  const meta = $("inspectorMeta");
  const list = $("inspectorInstructions");
  const rawWrap = $("inspectorRaw");
  const rawPre = $("inspectorRawPre");

  status.textContent = statusText;

  if (!inspection) {
    meta.classList.add("hidden");
    rawWrap.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  meta.classList.remove("hidden");
  rawWrap.classList.remove("hidden");

  const smartClose =
    inspection.smartCloseApplied == null
      ? "—"
      : inspection.smartCloseApplied
        ? "applied"
        : "skipped (size)";

  meta.innerHTML = `
    <div class="meta-kv"><span>Version</span><code>v${inspection.version}</code></div>
    <div class="meta-kv"><span>Instructions</span><code>${inspection.numInstructions}</code></div>
    <div class="meta-kv"><span>Tx size</span><code>${inspection.transactionSizeBytes ?? "—"} B</code></div>
    <div class="meta-kv"><span>Account keys</span><code>${inspection.totalAccountKeys} (${inspection.staticAccountKeys} static + ${inspection.loadedWritableAccounts}W/${inspection.loadedReadonlyAccounts}R ALT)</code></div>
    <div class="meta-kv"><span>Frame</span><code>${inspection.frameUsed ?? "—"}</code></div>
    <div class="meta-kv"><span>Fee payer</span><code>${inspection.feePayer ?? "—"}</code></div>
    <div class="meta-kv"><span>Smart close</span><code>${smartClose}</code></div>
    <div class="meta-kv"><span>ALTs</span><code>${inspection.addressLookupTables?.length ?? 0}</code></div>
  `;

  status.title =
    "Resolve: ALT = loaded via lookup table (size win). static = full pubkey in message. static† = in ALT table but static (signers must stay static). No automatic compression for system programs without ALT.";

  list.innerHTML = inspection.instructions
    .map(
      (ix) => `
    <article class="ix-card">
      <header class="ix-card-head">
        <span class="ix-index">#${ix.index}</span>
        <span class="ix-program">${ix.programLabel}</span>
        ${ix.hint ? `<span class="ix-hint">${ix.hint}</span>` : ""}
        <span class="ix-program-id">${ix.programId}</span>
      </header>
      <table class="ix-accounts">
        <thead>
          <tr><th>#</th><th>Account</th><th>Flags</th><th>Resolve</th></tr>
        </thead>
        <tbody>
          ${ix.accounts
            .map(
              (a, i) => `
            <tr>
              <td>${i}</td>
              <td><code>${a.pubkey}</code></td>
              <td class="acct-flags">${acctFlags(a.isSigner, a.isWritable)}</td>
              <td class="acct-resolve ${a.altLoaded ? "resolve-alt" : a.inAltTableUnused ? "resolve-static-unused" : "resolve-static"}" title="${acctResolveTitle(a)}">${acctResolveLabel(a)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="ix-data">
        <div class="ix-data-label">
          <span>Data · ${ix.dataLength} bytes</span>
          <button type="button" class="secondary copy-btn" data-copy="${ix.dataHex}">Copy hex</button>
        </div>
        <pre>${ix.dataHex}</pre>
      </div>
    </article>`
    )
    .join("");

  rawPre.textContent = JSON.stringify(inspection, null, 2);
  wireCopyButtons(list);
}

async function doBuildSign() {
  if (!walletPubkey) {
    renderInspectorBanner({
      kind: "error",
      title: "Wallet required",
      message: "Connect wallet first.",
    });
    return;
  }
  if (!lastQuoteSnapshot) {
    renderInspectorBanner({
      kind: "error",
      title: "Quote required",
      message: "Quote first — build uses frozen quote amounts.",
    });
    return;
  }

  const trade = tradeBodyBase();
  if (!trade.mintA || !trade.inputAmount) {
    renderInspectorBanner({
      kind: "error",
      title: "Invalid input",
      message: "Need mint A and input amount.",
    });
    return;
  }

  const connection = new Connection(publicConfig.rpcUrl, "confirmed");
  const buildBody = { ...trade, userPubkey: walletPubkey };

  for (let attempt = 1; attempt <= BLOCKHASH_RETRIES; attempt++) {
    renderInspectorBanner({
      kind: "progress",
      title: attempt > 1 ? "Rebuilding transaction" : "Building transaction",
      message:
        attempt > 1
          ? `Blockhash expired — retry ${attempt}/${BLOCKHASH_RETRIES}…`
          : "Assembling instructions and checking size…",
    });
    renderTxInspector(null, "Building…");

    let built;
    try {
      built = await buildTransaction(buildBody);
    } catch (e) {
      logClientError("build", e, { buildBody, attempt, quoteSnapshot: lastQuoteSnapshot });
      renderInspectorBanner({
        kind: "error",
        title: "Build failed",
        message: e.message,
      });
      renderTxInspector(null, `Build failed: ${e.message}`);
      return;
    }

    renderInspectorBanner({
      kind: "progress",
      title: "Awaiting signature",
      message: `${built.transactionSizeBytes ?? "?"} B · approve in wallet`,
    });
    renderTxInspector(built.inspection, "Built — inspect instructions below");

    const valid = await isBlockhashValid(connection, built.lastValidBlockHeight);
    if (!valid) {
      if (attempt < BLOCKHASH_RETRIES) continue;
      renderInspectorBanner({
        kind: "error",
        title: "Blockhash expired",
        message: "Try Build & sign again.",
      });
      return;
    }

    try {
      const signature = await signAndSend(connection, built);
      renderInspectorBanner({
        kind: "success",
        title: "Transaction confirmed",
        built,
        signature,
      });
      renderTxInspector(built.inspection, "Confirmed — inspect instructions below");
      await refreshWalletState("tx-confirmed");
      return;
    } catch (e) {
      if (isBlockhashSendError(e) && attempt < BLOCKHASH_RETRIES) continue;
      if (e.code === 4001 || String(e.message).includes("User rejected")) {
        renderInspectorBanner({
          kind: "cancelled",
          title: "Cancelled in wallet",
          message: "Transaction not sent. Unsigned build remains below.",
        });
        renderTxInspector(built.inspection, "Cancelled — inspect unsigned tx below");
        return;
      }
      logClientError("sign-send", e, {
        attempt,
        feePayer: built?.feePayer,
        frameUsed: built?.frameUsed,
        txBytes: built?.transaction?.length,
      });
      renderInspectorBanner({
        kind: "error",
        title: "Send failed",
        message: e.message ?? String(e),
      });
      renderTxInspector(built.inspection, "Send failed — inspect tx below");
      return;
    }
  }
}

function updateModeUi() {
  const mode = $("mode").value;
  const isSwap = mode === "swap";
  document.querySelectorAll(".swap-only").forEach((el) => {
    el.classList.toggle("hidden", !isSwap);
  });
  document.querySelectorAll(".trade-only").forEach((el) => {
    el.classList.toggle("hidden", isSwap);
  });
  updateInputLabel();
  updateBalancePctButtons();
}

function updateInputLabel() {
  const mode = $("mode").value;
  const side = $("side").value;
  const label = $("inputLabel");
  if (mode === "swap") {
    label.textContent = "You sell (base A)";
    return;
  }
  label.textContent = side === "buy" ? "You pay (quote)" : "You sell (base)";
}

async function swapMintFields() {
  if ($("mode").value !== "swap") return;
  const mintA = $("mintA");
  const mintB = $("mintB");
  const tmp = mintA.value;
  mintA.value = mintB.value;
  mintB.value = tmp;
  lastQuoteSnapshot = null;
  lastQuoteExceedsBalance = false;
  updateBuildBtn();
  if (mintA.value.trim()) await doResolve();
  else {
    resolveState = null;
    renderResolvePanel(null);
    updateBalancePctButtons();
    renderQuoteIdle();
  }
}

async function doResolve(opts = {}) {
  const { quiet = false } = opts;
  const mintA = $("mintA").value.trim();
  if (!mintA) return;

  if (resolveInFlight) {
    resolvePending = true;
    return;
  }
  resolveInFlight = true;

  const mintB = $("mintB").value.trim();
  const out = $("resolveOut");
  if (!quiet) {
    out.textContent = "Resolving…";
    out.className = "resolve-out muted";
  }
  try {
    resolveState = await api("/api/token/resolve", {
      mintA,
      mintB: mintB || undefined,
      userPubkey: walletPubkey || undefined,
    });
    renderResolvePanel(resolveState);
    updateBalancePctButtons();
    scheduleQuote();
  } catch (e) {
    logClientError("resolve", e, { mintA, mintB });
    resolveState = null;
    out.textContent = e.message;
    out.className = "resolve-out error";
    updateBalancePctButtons();
  } finally {
    resolveInFlight = false;
    if (resolvePending) {
      resolvePending = false;
      void doResolve(opts);
    }
  }
}

function renderQuote(q) {
  setQuotePanelState("ready");

  const mode = $("mode").value;
  const side = $("side").value;
  const slipPct = $("slippage").value || "1";
  const feeBps = publicConfig.serviceFeeBps;
  const feeHint = feeBps != null ? `${feeBps} bps` : "";

  const feeUi = formatQuoteAsset(q.serviceFeeRaw, q.serviceFeeLabel);
  const netUi = formatQuoteAsset(q.netQuoteRaw, q.serviceFeeLabel);
  const tokenADecimals = resolveState?.tokenA?.decimals ?? 6;
  const tokenBDecimals = resolveState?.tokenB?.decimals ?? 6;

  let eyebrow;
  let amount;
  let unit;
  let minLine;
  const stats = [];

  if (mode === "swap") {
    eyebrow = "Estimated receive";
    amount = q.expectedOutputUi;
    unit = "Token B";
    const minUi = formatRawToUi(BigInt(q.minOutputRaw), tokenBDecimals);
    minLine = `Minimum ${minUi} Token B at ${slipPct}% slippage`;
    const inputUi = formatRawToUi(BigInt(q.inputRaw), tokenADecimals);
    stats.push(quoteStatRow("You pay", `${inputUi} Token A`));
    stats.push(
      quoteStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
    stats.push(
      quoteStatRow("To hop 2 buy", `${netUi} ${q.serviceFeeLabel}`)
    );
  } else if (side === "buy") {
    eyebrow = "Estimated receive";
    amount = q.expectedOutputUi;
    unit = "tokens";
    const minUi = formatRawToUi(BigInt(q.minOutputRaw), tokenADecimals);
    minLine = `Minimum ${minUi} tokens at ${slipPct}% slippage`;
    const payUi = formatQuoteAsset(q.inputRaw, q.serviceFeeLabel);
    stats.push(
      quoteStatRow("You pay", `${payUi} ${q.serviceFeeLabel}`)
    );
    stats.push(
      quoteStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
    stats.push(
      quoteStatRow("To Pump buy", `${netUi} ${q.serviceFeeLabel}`)
    );
  } else {
    eyebrow = "Estimated receive";
    amount = netUi;
    unit = q.serviceFeeLabel;
    const minUi = formatQuoteAsset(q.minOutputRaw, q.serviceFeeLabel);
    minLine = `Minimum ~${minUi} ${q.serviceFeeLabel} at ${slipPct}% slippage (gross, before fee)`;
    const sellUi = formatRawToUi(BigInt(q.inputRaw), tokenADecimals);
    stats.push(quoteStatRow("You sell", `${sellUi} tokens`));
    stats.push(
      quoteStatRow(
        "Gross from Pump",
        `${q.expectedOutputUi} ${q.serviceFeeLabel}`
      )
    );
    stats.push(
      quoteStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
  }

  $("quoteHeroEyebrow").textContent = eyebrow;
  $("quoteHeroAmount").textContent = amount;
  $("quoteHeroUnit").textContent = unit;
  $("quoteHeroMin").textContent = minLine;
  $("quoteHeroMin").className = "quote-hero-min muted";

  $("quoteStats").innerHTML = stats.join("");
  $("quoteStats").classList.remove("hidden");

  const alerts = [];
  if (q.inputLimit) {
    lastQuoteExceedsBalance = q.inputLimit.exceedsBalance;
    const cls = q.inputLimit.exceedsBalance ? "warn" : "info";
    let text = `Max ${q.inputLimit.asset}: ${q.inputLimit.maxInputUi}`;
    if (q.inputLimit.hint) text += ` — ${q.inputLimit.hint}`;
    alerts.push(`<div class="quote-alert ${cls}">${text}</div>`);
  } else {
    lastQuoteExceedsBalance = false;
  }
  updateBuildBtn();

  if (q.sponsor) {
    const sponsorSol = formatQuoteAsset(q.sponsor.estimatedLamports, "SOL");
    alerts.push(
      `<div class="quote-alert info">Sponsor repay (est.): ~${sponsorSol} SOL</div>`
    );
  }

  $("quoteAlerts").innerHTML = alerts.join("");

  $("quoteTechBody").innerHTML = [
    `Route: ${q.route.join(" → ")}`,
    `inputRaw: ${q.inputRaw} (${q.inputLabel}, frozen for build)`,
    `minOutputRaw: ${q.minOutputRaw}`,
    `serviceFeeRaw: ${q.serviceFeeRaw} (${q.serviceFeeLabel})`,
    `netQuoteRaw: ${q.netQuoteRaw}`,
  ].join("<br>");
  $("quoteTech").classList.remove("hidden");
}

async function doQuote() {
  const mintA = $("mintA").value.trim();
  const inputAmount = $("inputAmount").value.trim();
  if (!mintA || !inputAmount) return;

  if (quoteAbort) quoteAbort.abort();
  quoteAbort = new AbortController();

  const body = tradeBodyBase();
  if (walletPubkey) body.userPubkey = walletPubkey;

  renderQuoteLoading();
  lastQuoteSnapshot = null;
  lastQuoteExceedsBalance = false;
  updateBuildBtn();

  try {
    const res = await fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: quoteAbort.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    lastQuoteSnapshot = snapshotFromQuote(data);
    renderQuote(data);
    syncWalletFromQuote(data);
    updateBuildBtn();
  } catch (e) {
    if (e.name === "AbortError") return;
    logClientError("quote", e, body);
    renderQuoteError(e.message);
  }
}

function scheduleQuote() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doQuote, publicConfig.debounceMs ?? 300);
}

async function init() {
  try {
    const res = await fetch("/api/config/public");
    publicConfig = {
      ...publicConfig,
      ...(await res.json()),
    };
    $("slippage").value = String((publicConfig.defaultSlippageBps ?? 100) / 100);
    if (publicConfig.defaultPriorityTier) {
      $("priorityTier").value = publicConfig.defaultPriorityTier;
    }
  } catch {
    /* defaults */
  }

  const provider = getWalletProvider();
  if (provider?.isConnected && provider.publicKey) {
    walletProvider = provider;
    walletPubkey = provider.publicKey.toString();
  }
  provider?.on?.("connect", async (pk) => {
    walletProvider = provider;
    walletPubkey = pk?.toString?.() ?? provider.publicKey?.toString?.();
    updateWalletUi();
    startBalanceRefreshTimer();
    if ($("mintA").value.trim()) await doResolve();
    else scheduleQuote();
  });
  provider?.on?.("disconnect", () => {
    walletProvider = null;
    walletPubkey = null;
    updateWalletUi();
    stopBalanceRefreshTimer();
    updateBalancePctButtons();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && walletPubkey && $("mintA").value.trim()) {
      void refreshWalletState("visible");
    }
  });

  $("mode").addEventListener("change", () => {
    updateModeUi();
    doResolve();
  });
  $("side").addEventListener("change", () => {
    updateInputLabel();
    updateBalancePctButtons();
    scheduleQuote();
  });
  $("mintA").addEventListener("change", doResolve);
  $("mintA").addEventListener("input", scheduleResolve);
  $("mintA").addEventListener("paste", () => setTimeout(scheduleResolve, 0));
  $("mintB").addEventListener("change", doResolve);
  $("mintB").addEventListener("input", scheduleResolve);
  $("mintB").addEventListener("paste", () => setTimeout(scheduleResolve, 0));
  $("swapMintsBtn").addEventListener("click", () => {
    swapMintFields().catch((e) => logClientError("swap-mints", e));
  });
  $("inputAmount").addEventListener("input", scheduleQuote);
  $("slippage").addEventListener("input", scheduleQuote);
  document.querySelectorAll(".pct-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyBalancePercent(Number(btn.dataset.pct));
    });
  });
  $("quoteBtn").addEventListener("click", doQuote);
  $("connectBtn").addEventListener("click", () => {
    connectWallet().catch((e) => {
      $("walletStatus").textContent = e.message;
      $("walletStatus").className = "wallet-status error";
    });
  });
  $("disconnectBtn").addEventListener("click", () => disconnectWallet());
  $("buildSignBtn").addEventListener("click", doBuildSign);

  renderQuoteIdle();
  updateModeUi();
  updateWalletUi();
  updateBalancePctButtons();
  if (walletPubkey) {
    startBalanceRefreshTimer();
    if ($("mintA").value.trim()) void doResolve();
  }
}

init();
