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
let lastBuilt = null;
let lastQuoteExceedsBalance = false;
let expiresAtMs = 0;
let walletProvider = null;
let walletPubkey = null;
/** SOL + USDC only — refreshed on load / connect / interval. */
let quoteWallet = null;

const BLOCKHASH_RETRIES = 3;
const MIN_MINT_LEN = 32;

let debounceTimer;
let resolveDebounceTimer;
let balanceRefreshTimer;
let blockhashTimer = null;
let resolveInFlight = false;
let resolvePending = false;
/** User preference when sponsor toggle is optional (sell SOL). */
let useSponsorPreference = false;
let lastSponsorUi = null;
/** When true, trade preview + inspector are frozen (Sign & Send in flight). */
let rightPanelLocked = false;

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

function summaryStatRow(term, value, hint = "") {
  const hintHtml = hint
    ? `<span class="trade-stat-hint">${hint}</span>`
    : "";
  return `<div class="trade-stat"><dt>${term}</dt><dd>${value}${hintHtml}</dd></div>`;
}

function mintShortLabel(fieldId, fallback) {
  const v = $(fieldId).value.trim();
  return v.length >= 8 ? shortPubkey(v) : fallback;
}

function setTradeSummaryState(state) {
  $("tradeSummary").className = `trade-summary trade-summary--${state}`;
}

function clearTradeSummaryExchange() {
  $("summaryPayAmount").textContent = "—";
  $("summaryPayUnit").textContent = "";
  $("summaryReceiveAmount").textContent = "—";
  $("summaryReceiveUnit").textContent = "";
}

function lockRightPanel() {
  rightPanelLocked = true;
  cancelPendingQuote();
  stopBlockhashCountdown();
  $("signSendBtn").disabled = true;
  $("blockhashCountdown").classList.add("hidden");
}

function unlockRightPanel() {
  rightPanelLocked = false;
  updateSignSendBtn();
}

function renderQuoteIdle(message = "Enter amount on the left to preview.") {
  if (rightPanelLocked) return;
  setTradeSummaryState("idle");
  clearTradeSummaryExchange();
  $("summarySub").textContent = message;
  $("summarySub").className = "trade-summary-sub muted";
  $("summaryStats").classList.add("hidden");
  $("summaryStats").innerHTML = "";
  $("summaryAlerts").innerHTML = "";
  $("summaryTech").classList.add("hidden");
  $("summaryTechBody").textContent = "";
  hideSponsorUi();
}

function hideSponsorUi() {
  $("sponsorRow").classList.add("hidden");
  $("sponsorDetails").classList.add("hidden");
  $("sponsorDetails").innerHTML = "";
  $("sponsorHint").textContent = "";
  $("sponsorWarning").textContent = "";
  $("sponsorWarning").classList.add("hidden");
  lastSponsorUi = null;
}

function sponsorToggleApplies() {
  if (!publicConfig.sponsorEnabled) return false;
  const mode = $("mode").value;
  const side = $("side").value;
  return mode === "trade" && side === "sell";
}

function renderSponsorUi(sponsorUi, sponsor) {
  const row = $("sponsorRow");
  const toggle = $("sponsorToggle");
  const hint = $("sponsorHint");
  const details = $("sponsorDetails");

  if (!sponsorUi?.visible) {
    hideSponsorUi();
    return;
  }

  lastSponsorUi = sponsorUi;
  row.classList.remove("hidden");
  toggle.checked = !!sponsorUi.enabled;
  toggle.disabled = !!sponsorUi.readonly;
  row.classList.toggle("trade-sponsor-row--readonly", !!sponsorUi.readonly);
  row.classList.toggle("trade-sponsor-row--forced", sponsorUi.mode === "forced");
  hint.textContent = sponsorUi.hint ?? "";

  const warn = $("sponsorWarning");
  if (sponsor?.repayWarning) {
    warn.textContent = sponsor.repayWarning;
    warn.classList.remove("hidden");
  } else {
    warn.textContent = "";
    warn.classList.add("hidden");
  }

  if (sponsor?.active) {
    details.classList.remove("hidden");
    details.innerHTML = [
      summaryStatRow("Sponsored", "Yes"),
      summaryStatRow("Sponsor", shortPubkey(sponsor.pubkey), sponsor.pubkey),
      summaryStatRow(
        "Repay (est.)",
        `${formatQuoteAsset(sponsor.repayLamports, "SOL")} SOL`,
        "Repaid from trade proceeds"
      ),
      summaryStatRow(
        "Settle (est.)",
        `${formatQuoteAsset(sponsor.settleLamports, "SOL")} SOL`,
        "Gas + rent before buffer"
      ),
      summaryStatRow(
        "Fee payer",
        sponsor.feePayer === "sponsor" ? "Sponsor" : "Your wallet"
      ),
    ].join("");
  } else if (sponsor) {
    details.classList.remove("hidden");
    details.innerHTML = [
      summaryStatRow("Sponsored", "No"),
      summaryStatRow("Fee payer", "Your wallet"),
      summaryStatRow(
        "Gas + rent (est.)",
        `${formatQuoteAsset(sponsor.userSelfPayLamports, "SOL")} SOL`
      ),
    ].join("");
  } else {
    details.classList.add("hidden");
    details.innerHTML = "";
  }
}

function renderQuoteLoading() {
  if (rightPanelLocked) return;
  setTradeSummaryState("loading");
  $("summaryPayAmount").textContent = "…";
  $("summaryPayUnit").textContent = "";
  $("summaryReceiveAmount").textContent = "…";
  $("summaryReceiveUnit").textContent = "";
  $("summarySub").textContent = walletPubkey
    ? "Fetching quote and assembling transaction…"
    : "Fetching quote…";
  $("summarySub").className = "trade-summary-sub muted";
  $("summaryStats").classList.add("hidden");
  $("summaryAlerts").innerHTML = "";
  $("summaryTech").classList.add("hidden");
  lastBuilt = null;
  stopBlockhashCountdown();
  renderInspectorBanner(null);
  renderTxInspector(null, "Quoting & building…");
  updateSignSendBtn();
}

function renderQuoteError(message) {
  if (rightPanelLocked) return;
  setTradeSummaryState("error");
  clearTradeSummaryExchange();
  $("summarySub").textContent = message;
  $("summarySub").className = "trade-summary-sub error";
  $("summaryStats").classList.add("hidden");
  $("summaryAlerts").innerHTML = "";
  $("summaryTech").classList.add("hidden");
  lastBuilt = null;
  stopBlockhashCountdown();
  renderTxInspector(null, "Quote failed");
  renderInspectorBanner(null);
  updateSignSendBtn();
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
  onTradeInputChanged();
}

function shortPubkey(pk) {
  if (!pk || pk.length < 12) return pk ?? "";
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function walletBalanceChip(asset, amount) {
  return `<div class="wallet-balance-chip">
    <span class="wallet-balance-asset">${asset}</span>
    <span class="wallet-balance-amount">${amount}</span>
  </div>`;
}

function renderQuoteWalletBalances(wallet) {
  const el = $("walletBalances");
  if (!walletPubkey || !wallet) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.innerHTML = `<div class="wallet-balance-chips">${[
    walletBalanceChip("SOL", wallet.solUi),
    walletBalanceChip("USDC", wallet.usdcUi),
  ].join("")}</div>`;
  el.classList.remove("hidden");
}

async function refreshQuoteWalletBalances() {
  if (!walletPubkey) {
    quoteWallet = null;
    renderQuoteWalletBalances(null);
    return;
  }
  try {
    quoteWallet = await api("/api/wallet/balances", { userPubkey: walletPubkey });
    renderQuoteWalletBalances(quoteWallet);
  } catch (e) {
    logClientError("wallet-balances", e, { userPubkey: walletPubkey });
  }
}

function renderTokenPanel(panelId, opts) {
  const out = $(panelId);
  if (!opts) {
    out.innerHTML = "";
    out.className = "token-panel hidden";
    return;
  }

  if (opts.error) {
    out.className = "token-panel token-panel--error";
    out.textContent = opts.error;
    out.classList.remove("hidden");
    return;
  }

  if (opts.loading) {
    out.className = "token-panel token-panel--loading";
    out.textContent = "Resolving token…";
    out.classList.remove("hidden");
    return;
  }

  const { token, mintStr = "", baseBalance, swapNote } = opts;
  if (!token) {
    out.innerHTML = "";
    out.className = "token-panel hidden";
    return;
  }

  const mintLabel = mintStr.length >= 8 ? shortPubkey(mintStr) : "—";
  const safeMint = mintStr.replace(/"/g, "&quot;");

  let balanceBlock = "";
  if (baseBalance != null) {
    balanceBlock = `
      <div class="token-panel-balance">
        <span>Your balance</span>
        <strong>${baseBalance}</strong>
      </div>`;
  } else if (walletPubkey) {
    balanceBlock = `
      <div class="token-panel-balance muted">
        <span>Your balance</span>
        <strong>0</strong>
      </div>`;
  } else {
    balanceBlock = `<div class="token-panel-note muted">Connect wallet to see your balance</div>`;
  }

  let swapBlock = "";
  if (swapNote) {
    swapBlock = `<div class="token-panel-swap-flag ${swapNote.ok ? "ok" : "error"}">${swapNote.text}</div>`;
  }

  out.className = "token-panel";
  out.innerHTML = `
    <div class="token-panel-grid">
      <span class="token-panel-k">Quote pool</span>
      <span class="token-panel-v">${token.quoteLabel}</span>
      <span class="token-panel-k">Decimals</span>
      <span class="token-panel-v">${token.decimals}</span>
      <span class="token-panel-k">Mint</span>
      <code class="token-panel-v" title="${safeMint}">${mintLabel}</code>
    </div>
    ${balanceBlock}
    ${swapBlock}`;
  out.classList.remove("hidden");
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
    renderQuoteWalletBalances(quoteWallet);
  } else {
    status.textContent = "Wallet not connected";
    status.className = "wallet-status muted";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
    quoteWallet = null;
    renderQuoteWalletBalances(null);
  }
  updateSignSendBtn();
}

function stopBlockhashCountdown() {
  if (blockhashTimer) {
    clearInterval(blockhashTimer);
    blockhashTimer = null;
  }
  expiresAtMs = 0;
}

function isBlockhashExpired() {
  return expiresAtMs > 0 && Date.now() >= expiresAtMs;
}

function startBlockhashCountdown(blockhash) {
  stopBlockhashCountdown();
  expiresAtMs = blockhash?.expiresAtMs ?? 0;
  updateSignSendBtn();
  if (!expiresAtMs) return;
  blockhashTimer = setInterval(updateSignSendBtn, 1000);
}

function updateSignSendBtn() {
  if (rightPanelLocked) return;
  const btn = $("signSendBtn");
  const countdown = $("blockhashCountdown");

  if (!walletPubkey) {
    btn.disabled = true;
    btn.textContent = "Sign & Send";
    countdown.classList.add("hidden");
    return;
  }

  if (lastQuoteExceedsBalance || !lastQuoteSnapshot) {
    btn.disabled = true;
    btn.textContent = "Sign & Send";
    countdown.classList.add("hidden");
    return;
  }

  if (!lastBuilt) {
    btn.disabled = true;
    btn.textContent = "Sign & Send";
    countdown.classList.add("hidden");
    return;
  }

  if (isBlockhashExpired()) {
    btn.disabled = false;
    btn.textContent = "Quote & Build";
    countdown.textContent = "Blockhash expired";
    countdown.classList.remove("hidden");
    countdown.classList.add("expired");
    return;
  }

  btn.disabled = false;
  btn.textContent = "Sign & Send";
  countdown.classList.remove("expired");
  countdown.classList.remove("hidden");
  const secs = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  countdown.textContent = `Re-quote in ${secs}s`;
}

function applyPrepareResponse(data, opts = {}) {
  const { silent = false } = opts;
  if (rightPanelLocked && !silent) return;

  const touchUi = !silent && !rightPanelLocked;

  lastQuoteSnapshot = snapshotFromQuote(data);
  lastBuilt = data.build ?? null;

  if (data.blockhash) {
    if (touchUi) {
      startBlockhashCountdown(data.blockhash);
    } else {
      expiresAtMs = data.blockhash.expiresAtMs ?? 0;
    }
  } else if (touchUi) {
    stopBlockhashCountdown();
  }

  if (!touchUi) return;

  if (data.sponsorUi?.readonly) {
    useSponsorPreference = !!data.sponsorUi.enabled;
  }
  renderQuote(data);
  syncWalletFromQuote(data);

  if (data.build?.inspection) {
    const size = data.build.transactionSizeBytes ?? "?";
    renderTxInspector(
      data.build.inspection,
      `Ready · ${size} B · inspect instructions below`
    );
    renderInspectorBanner(null);
  } else if (data.buildSkippedReason === "no_wallet") {
    renderTxInspector(null, "Connect wallet to preview transaction");
    renderInspectorBanner(null);
  } else if (data.buildSkippedReason === "exceeds_balance") {
    renderTxInspector(null, "Input exceeds balance — cannot build");
    renderInspectorBanner({
      kind: "error",
      title: "Cannot build",
      message: data.inputLimit?.hint ?? "Input exceeds wallet balance.",
    });
  } else if (data.buildSkippedReason === "build_error") {
    renderTxInspector(null, "Quote OK — build failed");
    renderInspectorBanner({
      kind: "error",
      title: "Build failed",
      message: data.buildError ?? "Transaction could not be assembled.",
    });
  } else {
    renderTxInspector(null, "No transaction preview");
    renderInspectorBanner(null);
  }

  updateSignSendBtn();
}

function renderResolvePanel(state) {
  if (!state) {
    renderTokenPanel("tokenAPanel", null);
    renderTokenPanel("tokenBPanel", null);
    return;
  }

  const mintA = $("mintA").value.trim();
  renderTokenPanel("tokenAPanel", {
    token: state.tokenA,
    mintStr: mintA,
    baseBalance: state.wallet?.baseA?.ui ?? null,
  });

  if (state.tokenB) {
    const mintB = $("mintB").value.trim();
    const swapText = state.swapEligible
      ? "✓ Same quote pool — swap eligible"
      : `✗ ${state.swapIneligibleReason ?? "Swap not eligible"}`;
    renderTokenPanel("tokenBPanel", {
      token: state.tokenB,
      mintStr: mintB,
      swapNote: { ok: state.swapEligible, text: swapText },
    });
  } else {
    renderTokenPanel("tokenBPanel", null);
  }
}

function syncWalletFromQuote(q) {
  if (!q?.wallet) return;
  quoteWallet = {
    solRaw: q.wallet.solRaw,
    solUi: q.wallet.solUi,
    usdcRaw: q.wallet.usdcRaw,
    usdcUi: q.wallet.usdcUi,
  };
  renderQuoteWalletBalances(quoteWallet);
  if (resolveState) {
    resolveState.wallet = q.wallet;
    renderResolvePanel(resolveState);
  }
  updateBalancePctButtons();
}

function startBalanceRefreshTimer() {
  stopBalanceRefreshTimer();
  if (!walletPubkey) return;
  const intervalMs = publicConfig.balanceRefreshIntervalMs ?? 30_000;
  balanceRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    void refreshWalletState("interval");
  }, intervalMs);
}

function stopBalanceRefreshTimer() {
  if (balanceRefreshTimer) {
    clearInterval(balanceRefreshTimer);
    balanceRefreshTimer = null;
  }
}

function cancelPendingQuote() {
  clearTimeout(debounceTimer);
  if (quoteAbort) {
    quoteAbort.abort();
    quoteAbort = null;
  }
}

/** After a confirmed send — keep right panel as-is, stop auto re-quote. */
function resetAfterSuccessfulSend() {
  cancelPendingQuote();
  $("inputAmount").value = "";
  lastQuoteSnapshot = null;
  lastBuilt = null;
  lastQuoteExceedsBalance = false;
  updateBalancePctButtons();
}

/** Re-fetch quote wallet balances; re-resolve mint if set. */
async function refreshWalletState(_reason, opts = {}) {
  const { skipQuote = false } = opts;
  await refreshQuoteWalletBalances();
  const mintA = $("mintA").value.trim();
  if (mintA) await doResolve({ quiet: true, skipQuote });
}

function scheduleResolve() {
  clearTimeout(resolveDebounceTimer);
  resolveDebounceTimer = setTimeout(() => {
    const mintA = $("mintA").value.trim();
    if (!mintA || mintA.length < MIN_MINT_LEN) {
      resolveState = null;
      renderResolvePanel(null);
      updateBalancePctButtons();
      return;
    }
    void doResolve();
  }, publicConfig.debounceMs ?? 300);
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
  if (sponsorToggleApplies() && walletPubkey) {
    body.useSponsor = useSponsorPreference;
  }
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
  await refreshQuoteWalletBalances();
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

function formatTxErr(err) {
  if (err == null) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function fetchTxExecutionResult(connection, signature) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status) {
      const err = status.err;
      return {
        landed: true,
        succeeded: err == null,
        err: formatTxErr(err),
      };
    }
    if (attempt < 7) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return { landed: false, succeeded: null, err: null };
}

async function signAndSend(connection, built) {
  const tx = decodeTxBase64(built.transaction);

  let signature;
  if (walletProvider.signAndSendTransaction) {
    const result = await walletProvider.signAndSendTransaction(tx, {
      skipPreflight: false,
    });
    signature =
      typeof result === "string" ? result : result.signature?.toString?.() ?? String(result);
  } else {
    const signed = await walletProvider.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  }

  await connection.confirmTransaction(
    {
      signature,
      blockhash: built.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed"
  );

  const execution = await fetchTxExecutionResult(connection, signature);
  return { signature, execution };
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

function executionResultLabel(execution) {
  if (!execution?.landed) return { text: "Unknown", tone: "muted" };
  if (execution.succeeded) return { text: "Success", tone: "ok" };
  return { text: "Failed", tone: "error" };
}

function renderInspectorBanner(opts) {
  const banner = $("inspectorBanner");
  if (!opts) {
    banner.className = "inspector-banner hidden";
    banner.innerHTML = "";
    return;
  }

  const { kind, title, message, built, signature, execution } = opts;
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
  if (signature && (kind === "success" || kind === "error")) {
    const url = solscanTxUrl(signature);
    const result = executionResultLabel(execution);
    const errLine =
      execution?.succeeded === false && execution.err
        ? `<code class="error">${execution.err}</code>`
        : "";
    body = `
      <a class="banner-link" href="${url}" target="_blank" rel="noopener">View on Solscan →</a>
      <div class="banner-grid">
        <div>Result<code class="${result.tone}">${result.text}</code>${errLine}</div>
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

async function doSignSend() {
  if (!walletPubkey) {
    renderInspectorBanner({
      kind: "error",
      title: "Wallet required",
      message: "Connect wallet first.",
    });
    return;
  }

  if (isBlockhashExpired() || !lastBuilt) {
    await doQuote();
    if (!lastBuilt || isBlockhashExpired()) return;
  }

  lockRightPanel();

  const connection = new Connection(publicConfig.rpcUrl, "confirmed");

  for (let attempt = 1; attempt <= BLOCKHASH_RETRIES; attempt++) {
    if (attempt > 1) {
      await doQuote({ silent: true });
      if (!lastBuilt) return;
    }

    renderInspectorBanner({
      kind: "progress",
      title: "Awaiting signature",
      message: `${lastBuilt.transactionSizeBytes ?? "?"} B · approve in wallet`,
    });

    const valid = await isBlockhashValid(
      connection,
      lastBuilt.lastValidBlockHeight
    );
    if (!valid) {
      if (attempt < BLOCKHASH_RETRIES) continue;
      renderInspectorBanner({
        kind: "error",
        title: "Blockhash expired",
        message: "Enter a new amount to quote again.",
      });
      return;
    }

    try {
      const { signature, execution } = await signAndSend(connection, lastBuilt);
      stopBlockhashCountdown();
      const failedOnChain = execution.succeeded === false;
      const succeeded = execution.succeeded === true;
      renderInspectorBanner({
        kind: failedOnChain ? "error" : "success",
        title: failedOnChain
          ? "Transaction failed on-chain"
          : succeeded
            ? "Transaction succeeded"
            : "Transaction confirmed",
        built: lastBuilt,
        signature,
        execution,
      });
      renderTxInspector(
        lastBuilt.inspection,
        failedOnChain
          ? "Failed on-chain — inspect instructions below"
          : succeeded
            ? "Succeeded — inspect instructions below"
            : "Confirmed — inspect instructions below"
      );
      resetAfterSuccessfulSend();
      await refreshWalletState("tx-confirmed", { skipQuote: true });
      return;
    } catch (e) {
      if (isBlockhashSendError(e) && attempt < BLOCKHASH_RETRIES) continue;
      if (e.code === 4001 || String(e.message).includes("User rejected")) {
        renderInspectorBanner({
          kind: "cancelled",
          title: "Cancelled in wallet",
          message: "Transaction not sent. Preview remains below.",
        });
        renderTxInspector(
          lastBuilt.inspection,
          "Cancelled — inspect unsigned tx below"
        );
        unlockRightPanel();
        return;
      }
      logClientError("sign-send", e, {
        attempt,
        feePayer: lastBuilt?.feePayer,
        frameUsed: lastBuilt?.frameUsed,
      });
      renderInspectorBanner({
        kind: "error",
        title: "Send failed",
        message: e.message ?? String(e),
      });
      renderTxInspector(lastBuilt.inspection, "Send failed — inspect tx below");
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
  lastBuilt = null;
  lastQuoteExceedsBalance = false;
  stopBlockhashCountdown();
  updateSignSendBtn();
  if (mintA.value.trim()) await doResolve();
  else {
    resolveState = null;
    renderResolvePanel(null);
    updateBalancePctButtons();
    renderQuoteIdle();
  }
}

async function doResolve(opts = {}) {
  const { quiet = false, skipQuote = false } = opts;
  const mintA = $("mintA").value.trim();
  if (!mintA) {
    resolveState = null;
    renderResolvePanel(null);
    updateBalancePctButtons();
    return;
  }

  if (resolveInFlight) {
    resolvePending = true;
    return;
  }
  resolveInFlight = true;

  const mintB = $("mintB").value.trim();
  if (!quiet) {
    renderTokenPanel("tokenAPanel", { loading: true });
    if ($("mode").value === "swap" && mintB.length >= MIN_MINT_LEN) {
      renderTokenPanel("tokenBPanel", { loading: true });
    }
  }

  try {
    resolveState = await api("/api/token/resolve", {
      mintA,
      mintB: mintB || undefined,
      userPubkey: walletPubkey || undefined,
    });
    if (resolveState.wallet) {
      quoteWallet = {
        solRaw: resolveState.wallet.solRaw,
        solUi: resolveState.wallet.solUi,
        usdcRaw: resolveState.wallet.usdcRaw,
        usdcUi: resolveState.wallet.usdcUi,
      };
      renderQuoteWalletBalances(quoteWallet);
    }
    renderResolvePanel(resolveState);
    updateBalancePctButtons();
    if (!skipQuote) scheduleQuote();
  } catch (e) {
    logClientError("resolve", e, { mintA, mintB });
    resolveState = null;
    renderTokenPanel("tokenAPanel", { error: e.message });
    renderTokenPanel("tokenBPanel", null);
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
  setTradeSummaryState("ready");

  const mode = $("mode").value;
  const side = $("side").value;
  const slipPct = $("slippage").value || "1";
  const feeBps = publicConfig.serviceFeeBps;
  const feeHint = feeBps != null ? `${feeBps} bps` : "";

  const feeUi = formatQuoteAsset(q.serviceFeeRaw, q.serviceFeeLabel);
  const netUi = formatQuoteAsset(q.netQuoteRaw, q.serviceFeeLabel);
  const tokenADecimals = resolveState?.tokenA?.decimals ?? 6;
  const tokenBDecimals = resolveState?.tokenB?.decimals ?? 6;
  const labelA = mintShortLabel("mintA", "Token A");
  const labelB = mintShortLabel("mintB", "Token B");

  let payAmount;
  let payUnit;
  let receiveAmount;
  let receiveUnit;
  let minLine;
  const stats = [];

  if (mode === "swap") {
    payAmount = formatRawToUi(BigInt(q.inputRaw), tokenADecimals);
    payUnit = labelA;
    receiveAmount = q.expectedOutputUi;
    receiveUnit = labelB;
    const minUi = formatRawToUi(BigInt(q.minOutputRaw), tokenBDecimals);
    minLine = `Min receive ${minUi} ${labelB} · ${slipPct}% slippage`;
    stats.push(
      summaryStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
    stats.push(
      summaryStatRow("To hop 2 buy", `${netUi} ${q.serviceFeeLabel}`)
    );
  } else if (side === "buy") {
    payAmount = formatQuoteAsset(q.inputRaw, q.serviceFeeLabel);
    payUnit = q.serviceFeeLabel;
    receiveAmount = q.expectedOutputUi;
    receiveUnit = labelA;
    const minUi = formatRawToUi(BigInt(q.minOutputRaw), tokenADecimals);
    minLine = `Min receive ${minUi} ${labelA} · ${slipPct}% slippage`;
    stats.push(
      summaryStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
    stats.push(
      summaryStatRow("To Pump buy", `${netUi} ${q.serviceFeeLabel}`)
    );
  } else {
    payAmount = formatRawToUi(BigInt(q.inputRaw), tokenADecimals);
    payUnit = labelA;
    receiveAmount = netUi;
    receiveUnit = q.serviceFeeLabel;
    const minUi = formatQuoteAsset(q.minOutputRaw, q.serviceFeeLabel);
    minLine = `Min ~${minUi} ${q.serviceFeeLabel} gross · ${slipPct}% slippage`;
    stats.push(
      summaryStatRow(
        "Gross from Pump",
        `${q.expectedOutputUi} ${q.serviceFeeLabel}`
      )
    );
    stats.push(
      summaryStatRow(
        "Platform fee",
        `${feeUi} ${q.serviceFeeLabel}`,
        feeHint
      )
    );
  }

  $("summaryPayAmount").textContent = payAmount;
  $("summaryPayUnit").textContent = payUnit;
  $("summaryReceiveAmount").textContent = receiveAmount;
  $("summaryReceiveUnit").textContent = receiveUnit;
  $("summarySub").textContent = minLine;
  $("summarySub").className = "trade-summary-sub muted";

  $("summaryStats").innerHTML = stats.join("");
  $("summaryStats").classList.remove("hidden");

  const alerts = [];
  if (q.inputLimit) {
    lastQuoteExceedsBalance = q.inputLimit.exceedsBalance;
    const cls = q.inputLimit.exceedsBalance ? "warn" : "info";
    let text = `Max ${q.inputLimit.asset}: ${q.inputLimit.maxInputUi}`;
    if (q.inputLimit.hint) text += ` — ${q.inputLimit.hint}`;
    alerts.push(`<div class="trade-alert ${cls}">${text}</div>`);
  } else {
    lastQuoteExceedsBalance = false;
  }
  updateSignSendBtn();

  if (q.sponsorUi) {
    renderSponsorUi(q.sponsorUi, q.sponsor);
  }

  if (q.build?.transactionSizeBytes != null) {
    const closeNote =
      q.build.smartCloseApplied != null
        ? q.build.smartCloseApplied
          ? " · smart close"
          : " · no smart close"
        : "";
    alerts.push(
      `<div class="trade-alert info">Tx ${q.build.transactionSizeBytes} B${closeNote} · ready to sign</div>`
    );
  } else if (q.buildSkippedReason === "no_wallet") {
    alerts.push(
      `<div class="trade-alert info">Connect wallet to assemble transaction</div>`
    );
  }

  $("summaryAlerts").innerHTML = alerts.join("");

  $("summaryTechBody").innerHTML = [
    `Route: ${q.route.join(" → ")}`,
    `inputRaw: ${q.inputRaw} (${q.inputLabel})`,
    `minOutputRaw: ${q.minOutputRaw}`,
    `serviceFeeRaw: ${q.serviceFeeRaw} (${q.serviceFeeLabel})`,
    `netQuoteRaw: ${q.netQuoteRaw}`,
  ].join("<br>");
  $("summaryTech").classList.remove("hidden");
}

async function doQuote(opts = {}) {
  const { silent = false } = opts;
  const mintA = $("mintA").value.trim();
  const inputAmount = $("inputAmount").value.trim();
  if (!mintA || !inputAmount) return;

  if (!silent && rightPanelLocked) return;

  if (quoteAbort) quoteAbort.abort();
  quoteAbort = new AbortController();

  const body = tradeBodyBase();
  body.priorityTier = $("priorityTier").value;
  if (walletPubkey) body.userPubkey = walletPubkey;

  if (!silent) {
    renderQuoteLoading();
    lastQuoteSnapshot = null;
    lastQuoteExceedsBalance = false;
  }

  try {
    const res = await fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: quoteAbort.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    applyPrepareResponse(data, { silent });
  } catch (e) {
    if (e.name === "AbortError") return;
    logClientError("quote", e, body);
    if (silent) {
      lastBuilt = null;
      return;
    }
    renderQuoteError(e.message);
    lastBuilt = null;
    stopBlockhashCountdown();
    updateSignSendBtn();
  }
}

function onSponsorToggleChanged() {
  if (rightPanelLocked || lastSponsorUi?.readonly) return;
  useSponsorPreference = $("sponsorToggle").checked;
  scheduleQuote();
}

function resetSponsorPreference() {
  useSponsorPreference = false;
}

function onTradeInputChanged() {
  if (rightPanelLocked) {
    unlockRightPanel();
    renderQuoteIdle();
  }
  scheduleQuote();
}

function scheduleQuote() {
  if (rightPanelLocked) return;
  const mintA = $("mintA").value.trim();
  const inputAmount = $("inputAmount").value.trim();
  if (!mintA || !inputAmount) return;
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
    await refreshQuoteWalletBalances();
    if ($("mintA").value.trim()) await doResolve();
    else scheduleQuote();
  });
  provider?.on?.("disconnect", () => {
    walletProvider = null;
    walletPubkey = null;
    quoteWallet = null;
    updateWalletUi();
    stopBalanceRefreshTimer();
    updateBalancePctButtons();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && walletPubkey) {
      void refreshWalletState("visible");
    }
  });

  $("mode").addEventListener("change", () => {
    updateModeUi();
    resetSponsorPreference();
    doResolve();
  });
  $("side").addEventListener("change", () => {
    updateInputLabel();
    updateBalancePctButtons();
    resetSponsorPreference();
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
  $("inputAmount").addEventListener("input", onTradeInputChanged);
  $("slippage").addEventListener("input", scheduleQuote);
  $("priorityTier").addEventListener("change", scheduleQuote);
  $("sponsorToggle").addEventListener("change", onSponsorToggleChanged);
  document.querySelectorAll(".pct-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyBalancePercent(Number(btn.dataset.pct));
    });
  });
  $("refreshQuoteBtn").addEventListener("click", () => {
    if (rightPanelLocked) return;
    doQuote().catch((e) => logClientError("refresh-quote", e));
  });
  $("connectBtn").addEventListener("click", () => {
    connectWallet().catch((e) => {
      $("walletStatus").textContent = e.message;
      $("walletStatus").className = "wallet-status error";
    });
  });
  $("disconnectBtn").addEventListener("click", () => disconnectWallet());
  $("signSendBtn").addEventListener("click", () => {
    if ($("signSendBtn").textContent === "Quote & Build") {
      doQuote().catch((e) => logClientError("quote-build", e));
    } else {
      doSignSend().catch((e) => logClientError("sign-send", e));
    }
  });

  renderQuoteIdle();
  updateModeUi();
  updateWalletUi();
  updateBalancePctButtons();
  if (walletPubkey) {
    startBalanceRefreshTimer();
    void refreshQuoteWalletBalances();
    if ($("mintA").value.trim()) void doResolve();
  }
}

init();
