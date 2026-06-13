import { Connection, Transaction } from "@solana/web3.js";

const $ = (id) => document.getElementById(id);

let publicConfig = {
  debounceMs: 300,
  defaultSlippageBps: 100,
  rpcUrl: "https://api.mainnet-beta.solana.com",
};
let resolveState = null;
let quoteAbort = null;
let lastQuoteSnapshot = null;
let lastQuoteExceedsBalance = false;
let walletProvider = null;
let walletPubkey = null;

const BLOCKHASH_RETRIES = 3;

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
  return Transaction.from(bytes);
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
  scheduleQuote();
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

function explorerTxUrl(signature) {
  const rpc = publicConfig.rpcUrl ?? "";
  if (rpc.includes("devnet")) {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  if (rpc.includes("testnet")) {
    return `https://explorer.solana.com/tx/${signature}?cluster=testnet`;
  }
  return `https://explorer.solana.com/tx/${signature}`;
}

function renderBuildProgress(message, className = "muted") {
  const out = $("buildOut");
  out.textContent = message;
  out.className = `quote-out ${className}`;
}

function renderBuildResult(built, signature) {
  const out = $("buildOut");
  out.className = "quote-out";
  out.innerHTML = `
    <div class="ok">Sent: <a href="${explorerTxUrl(signature)}" target="_blank" rel="noopener">${signature.slice(0, 16)}…</a></div>
    <div>Frame: ${built.frameUsed ?? "—"}</div>
    <div>Fee payer: ${built.feePayer ?? walletPubkey}</div>
    ${
      built.partiallySignedBy?.length
        ? `<div>Sponsor co-signed: ${built.partiallySignedBy.map(shortPubkey).join(", ")}</div>`
        : ""
    }
  `;
}

async function doBuildSign() {
  if (!walletPubkey) {
    renderBuildProgress("Connect wallet first.", "error");
    return;
  }
  if (!lastQuoteSnapshot) {
    renderBuildProgress("Quote first — build uses frozen quote amounts.", "error");
    return;
  }

  const trade = tradeBodyBase();
  if (!trade.mintA || !trade.inputAmount) {
    renderBuildProgress("Need mint A and input amount.", "error");
    return;
  }

  const connection = new Connection(publicConfig.rpcUrl, "confirmed");
  const buildBody = { ...trade, userPubkey: walletPubkey };

  for (let attempt = 1; attempt <= BLOCKHASH_RETRIES; attempt++) {
    renderBuildProgress(
      attempt > 1
        ? `Blockhash expired — rebuilding (${attempt}/${BLOCKHASH_RETRIES})…`
        : "Building transaction…"
    );

    let built;
    try {
      built = await buildTransaction(buildBody);
    } catch (e) {
      logClientError("build", e, { buildBody, attempt, quoteSnapshot: lastQuoteSnapshot });
      renderBuildProgress(e.message, "error");
      return;
    }

    const valid = await isBlockhashValid(connection, built.lastValidBlockHeight);
    if (!valid) {
      if (attempt < BLOCKHASH_RETRIES) continue;
      renderBuildProgress("Blockhash expired. Try again.", "error");
      return;
    }

    renderBuildProgress("Approve in wallet…");
    try {
      const signature = await signAndSend(connection, built);
      renderBuildResult(built, signature);
      return;
    } catch (e) {
      if (isBlockhashSendError(e) && attempt < BLOCKHASH_RETRIES) continue;
      if (e.code === 4001 || String(e.message).includes("User rejected")) {
        renderBuildProgress("Transaction cancelled.", "muted");
        return;
      }
      logClientError("sign-send", e, {
        attempt,
        feePayer: built?.feePayer,
        frameUsed: built?.frameUsed,
        txBytes: built?.transaction?.length,
      });
      renderBuildProgress(e.message ?? String(e), "error");
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

async function doResolve() {
  const mintA = $("mintA").value.trim();
  if (!mintA) return;
  const mintB = $("mintB").value.trim();
  const out = $("resolveOut");
  out.textContent = "Resolving…";
  out.className = "resolve-out muted";
  try {
    resolveState = await api("/api/token/resolve", {
      mintA,
      mintB: mintB || undefined,
      userPubkey: walletPubkey || undefined,
    });
    const a = resolveState.tokenA;
    let html = `<div class="ok">A: quote ${a.quoteLabel} · ${a.decimals} decimals</div>`;
    if (resolveState.wallet) {
      const w = resolveState.wallet;
      html += `<div class="muted">Wallet: ${w.solUi} SOL · ${w.usdcUi} USDC`;
      if (w.baseA) html += ` · ${w.baseA.ui} base A`;
      html += "</div>";
    }
    if (resolveState.tokenB) {
      const b = resolveState.tokenB;
      html += `<div>${resolveState.swapEligible ? "✓" : "✗"} B: quote ${b.quoteLabel}`;
      if (!resolveState.swapEligible) {
        html += ` — ${resolveState.swapIneligibleReason}`;
      }
      html += "</div>";
    }
    out.innerHTML = html;
    out.className = "resolve-out";
    scheduleQuote();
  } catch (e) {
    logClientError("resolve", e, { mintA, mintB });
    resolveState = null;
    out.textContent = e.message;
    out.className = "resolve-out error";
  }
}

function renderQuote(q) {
  const el = $("quoteOut");
  el.className = "quote-out";
  let sponsorLine = "";
  if (q.sponsor) {
    sponsorLine = `<div>Sponsor repay (est.): ~${q.sponsor.estimatedLamports} lamports</div>`;
  }
  let walletLine = "";
  if (q.wallet) {
    walletLine = `<div class="muted">Balance: ${q.wallet.solUi} SOL · ${q.wallet.usdcUi} USDC`;
    if (q.wallet.baseA) walletLine += ` · ${q.wallet.baseA.ui} base A`;
    walletLine += "</div>";
  }
  let limitLine = "";
  if (q.inputLimit) {
    const cls = q.inputLimit.exceedsBalance ? "error" : "muted";
    limitLine = `<div class="${cls}">Max input (${q.inputLimit.asset}): ${q.inputLimit.maxInputUi}`;
    if (q.inputLimit.hint) limitLine += ` — ${q.inputLimit.hint}`;
    limitLine += "</div>";
  }
  lastQuoteExceedsBalance = q.inputLimit?.exceedsBalance ?? false;
  updateBuildBtn();
  el.innerHTML = `
    <div><strong>Expected out:</strong> ${q.expectedOutputUi}</div>
    <div>Min out (raw): ${q.minOutputRaw}</div>
    <div>Service fee: ${q.serviceFeeRaw} ${q.serviceFeeLabel}</div>
    <div>Net quote → Pump: ${q.netQuoteRaw}</div>
    ${walletLine}
    ${limitLine}
    ${sponsorLine}
    <div class="muted">Route: ${q.route.join(" → ")}</div>
    <div class="muted">inputRaw: ${q.inputRaw} (frozen for build)</div>
  `;
}

async function doQuote() {
  const mintA = $("mintA").value.trim();
  const inputAmount = $("inputAmount").value.trim();
  if (!mintA || !inputAmount) return;

  if (quoteAbort) quoteAbort.abort();
  quoteAbort = new AbortController();

  const body = tradeBodyBase();
  if (walletPubkey) body.userPubkey = walletPubkey;

  const out = $("quoteOut");
  out.textContent = "Quoting…";
  out.className = "quote-out muted";
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
    updateBuildBtn();
  } catch (e) {
    if (e.name === "AbortError") return;
    logClientError("quote", e, body);
    out.textContent = e.message;
    out.className = "quote-out error";
  }
}

let debounceTimer;
function scheduleQuote() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doQuote, publicConfig.debounceMs ?? 300);
}

async function init() {
  try {
    const res = await fetch("/api/config/public");
    publicConfig = await res.json();
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
  provider?.on?.("connect", (pk) => {
    walletProvider = provider;
    walletPubkey = pk?.toString?.() ?? provider.publicKey?.toString?.();
    updateWalletUi();
    scheduleQuote();
  });
  provider?.on?.("disconnect", () => {
    walletProvider = null;
    walletPubkey = null;
    updateWalletUi();
  });

  $("mode").addEventListener("change", () => {
    updateModeUi();
    doResolve();
  });
  $("side").addEventListener("change", updateInputLabel);
  $("mintA").addEventListener("change", doResolve);
  $("mintB").addEventListener("change", doResolve);
  $("inputAmount").addEventListener("input", scheduleQuote);
  $("slippage").addEventListener("input", scheduleQuote);
  $("quoteBtn").addEventListener("click", doQuote);
  $("connectBtn").addEventListener("click", () => {
    connectWallet().catch((e) => {
      $("walletStatus").textContent = e.message;
      $("walletStatus").className = "wallet-status error";
    });
  });
  $("disconnectBtn").addEventListener("click", () => disconnectWallet());
  $("buildSignBtn").addEventListener("click", doBuildSign);

  updateModeUi();
  updateWalletUi();
}

init();
