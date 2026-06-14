import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import { loadKeypairFromFile } from "../config/keypair.js";
import {
  appendSwapInstructions,
  sellMinQuoteForSwap,
} from "../ifx/planner/swap.js";
import {
  buildSmartCloseInstructions,
  type CloseAtaCandidate,
} from "../ifx/planner/close-ata.js";
import { serviceFeeTransferIx } from "../ifx/planner/service-fee.js";
import {
  appendSponsorRepay,
} from "../ifx/planner/sponsor.js";
import { scratchForBuild } from "../ifx/frames.js";
import { loadTokenBuildAccounts } from "../pump/accounts.js";
import type { PumpContext } from "../pump/context.js";
import { quoteTrade } from "../pump/quote.js";
import { resolveTokens } from "../pump/resolve.js";
import {
  buyExactQuoteInV2Instruction,
  idempotentAtaCreate,
  sellV2Instruction,
  userBaseAta,
  userQuoteAta,
} from "../pump/instructions.js";
import { resolveBootstrapAtaSpecs } from "../sponsor/bootstrap-specs.js";
import { buyAtaSpecs } from "../sponsor/ata-specs.js";
import {
  inactiveSponsorPlan,
  type SponsorPlan,
} from "../sponsor/plan.js";
import { resolveSponsorDecision } from "../sponsor/ui-state.js";
import {
  computeInputLimit,
  fetchWalletBalances,
} from "../wallet/balances.js";
import { inspectVersionedTransaction } from "../util/tx-inspect.js";
import {
  assertTransactionSize,
  fitsTransactionSize,
  isTxCompileSizeError,
  TX_TOO_LARGE_HINT,
} from "../util/transaction-size.js";
import { logError } from "../util/log-error.js";
import { getAddressLookupTables } from "../solana/alt.js";
import {
  blockhashContextToExpiry,
  fetchBlockhashContext,
  type BlockhashContext,
} from "../solana/blockhash.js";
import type {
  BuildTxRequest,
  BuildTxResponse,
  QuoteRequest,
  QuoteResponse,
  QuoteSnapshot,
} from "../types/api.js";
import { errorMessage } from "../util/log-error.js";
import { effectiveTradeSide } from "../pump/trade-side.js";

async function runBuildPhase<T>(
  phase: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logError(`tx/build:${phase}`, err, context);
    throw err;
  }
}

function priorityIxs(config: AppConfig, tier: PriorityTier): TransactionInstruction[] {
  const { microLamports, computeUnitLimit } = config.priorityFee[tier];
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

export type BuildTradeParams = BuildTxRequest & {
  priorityTier: PriorityTier;
  blockhashCtx?: BlockhashContext;
};

function quoteSnapshotFromResponse(q: QuoteResponse): QuoteSnapshot {
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

function quoteFromSnapshot(snapshot: QuoteSnapshot): QuoteResponse {
  return {
    inputRaw: snapshot.inputRaw,
    inputLabel: snapshot.inputLabel,
    expectedOutputRaw: snapshot.minOutputRaw,
    expectedOutputUi: "",
    minOutputRaw: snapshot.minOutputRaw,
    serviceFeeRaw: snapshot.serviceFeeRaw,
    serviceFeeLabel: snapshot.serviceFeeLabel,
    netQuoteRaw: snapshot.netQuoteRaw,
    route: [],
    ixKind: snapshot.ixKind,
  };
}

async function resolveQuoteForBuild(
  pump: PumpContext,
  config: AppConfig,
  req: BuildTradeParams
): Promise<QuoteResponse> {
  if (req.quoteSnapshot) {
    return quoteFromSnapshot(req.quoteSnapshot);
  }
  return quoteTrade(pump, config, {
    mode: req.mode,
    side: req.side,
    mintA: req.mintA,
    mintB: req.mintB,
    inputAmount: req.inputAmount,
    slippageBps: req.slippageBps ?? config.quote.defaultSlippageBps,
    userPubkey: req.userPubkey,
    priorityTier: req.priorityTier,
    useSponsor: req.useSponsor,
  });
}

async function finalizeTx(
  pump: PumpContext,
  config: AppConfig,
  user: PublicKey,
  tx: Transaction,
  framePubkey: string,
  sponsor: SponsorPlan,
  smartCloseIxs: TransactionInstruction[] = [],
  blockhashCtx?: BlockhashContext
): Promise<BuildTxResponse> {
  const ctx =
    blockhashCtx ?? (await fetchBlockhashContext(pump.connection));
  const { blockhash, lastValidBlockHeight } = ctx;

  const feePayer = sponsor.active ? sponsor.pubkey : user;

  const lookupTables = await getAddressLookupTables(
    pump.connection,
    config.solana.addressLookupTables,
    config.rpcCacheTtlMs
  );

  const compile = (instructions: TransactionInstruction[]) => {
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
    const versionedTx = new VersionedTransaction(message);
    if (sponsor.active) {
      if (!config.sponsor.keypairPath) {
        throw new Error("sponsor.keypairPath required when sponsor is active");
      }
      versionedTx.sign([loadKeypairFromFile(config.sponsor.keypairPath)]);
    }
    const serialized = versionedTx.serialize();
    return { versionedTx, serialized };
  };

  const tryCompile = (
    instructions: TransactionInstruction[]
  ): { versionedTx: VersionedTransaction; serialized: Uint8Array } | null => {
    try {
      return compile(instructions);
    } catch (err) {
      if (isTxCompileSizeError(err)) return null;
      throw err;
    }
  };

  let instructions = tx.instructions;
  let smartCloseApplied = false;

  if (smartCloseIxs.length > 0) {
    const withClose = [...instructions, ...smartCloseIxs];
    const attempt = tryCompile(withClose);
    if (attempt && fitsTransactionSize(attempt.serialized)) {
      instructions = withClose;
      smartCloseApplied = true;
    }
  }

  const compiled = tryCompile(instructions);
  if (!compiled) {
    throw new Error(TX_TOO_LARGE_HINT);
  }
  const { serialized, versionedTx } = compiled;
  assertTransactionSize(serialized);

  let partiallySignedBy: string[] | undefined;
  if (sponsor.active) {
    partiallySignedBy = [sponsor.pubkey.toBase58()];
  }

  const inspection = inspectVersionedTransaction(versionedTx, lookupTables, {
    ifxProgramId: config.ifx.programId,
    frameUsed: framePubkey,
    feePayer: feePayer.toBase58(),
    smartCloseApplied,
    transactionSizeBytes: serialized.length,
    addressLookupTableAddresses: config.solana.addressLookupTables,
  });

  return {
    transaction: Buffer.from(serialized).toString("base64"),
    transactionVersion: 0,
    recentBlockhash: blockhash,
    frameUsed: framePubkey,
    lastValidBlockHeight,
    feePayer: feePayer.toBase58(),
    signers: [user.toBase58()],
    partiallySignedBy,
    addressLookupTables: config.solana.addressLookupTables,
    smartCloseApplied,
    transactionSizeBytes: serialized.length,
    inspection,
  };
}

async function buildSwapTransaction(
  pump: PumpContext,
  config: AppConfig,
  req: BuildTradeParams,
  quote: QuoteResponse
): Promise<BuildTxResponse> {
  if (!req.mintB) throw new Error("mintB required for swap mode");

  const resolved = await resolveTokens(pump, config, req.mintA, req.mintB);
  if (!resolved.swapEligible) {
    throw new Error(resolved.swapIneligibleReason ?? "swap not eligible");
  }

  const user = new PublicKey(req.userPubkey);
  const slippageBps = req.slippageBps ?? config.quote.defaultSlippageBps;
  const [accountsA, accountsB] = await Promise.all([
    loadTokenBuildAccounts(pump, config, req.mintA),
    loadTokenBuildAccounts(pump, config, req.mintB),
  ]);

  const quoteDeltaEst =
    BigInt(quote.serviceFeeRaw) + BigInt(quote.netQuoteRaw);
  const sellMinQuote = sellMinQuoteForSwap(quoteDeltaEst, slippageBps);

  const { scratch, framePubkey } = scratchForBuild(
    config.ifx.publicFrames,
    config.ifx.programId
  );
  const tx = new Transaction();
  tx.add(...priorityIxs(config, req.priorityTier));
  tx.add(scratch.ixReset());

  const swapIxs: TransactionInstruction[] = [];
  await appendSwapInstructions(swapIxs, {
    scratch,
    user,
    accountsA,
    accountsB,
    quoteLabel: quote.serviceFeeLabel,
    baseAmountIn: BigInt(quote.inputRaw),
    sellMinQuoteOut: sellMinQuote,
    hop2MinBaseOut: BigInt(quote.minOutputRaw),
    feeRecipient: new PublicKey(config.serviceFee.pubkey),
    serviceFeeBps: config.serviceFee.bps,
  });
  tx.add(...swapIxs);

  const baseAAta = userBaseAta(
    accountsA.mint,
    user,
    accountsA.baseTokenProgram
  );
  const closeCandidates: CloseAtaCandidate[] = [
    {
      tokenAccount: baseAAta,
      rentDestination: user,
      owner: user,
      tokenProgram: accountsA.baseTokenProgram,
    },
  ];
  if (quote.serviceFeeLabel !== "SOL") {
    const quoteAtaPk = userQuoteAta(
      user,
      accountsA.quoteMint,
      accountsA.quoteTokenProgram
    );
    closeCandidates.push({
      tokenAccount: quoteAtaPk,
      rentDestination: user,
      owner: user,
      tokenProgram: accountsA.quoteTokenProgram,
    });
  }
  const smartCloseIxs = buildSmartCloseInstructions(scratch, closeCandidates);

  return finalizeTx(
    pump,
    config,
    user,
    tx,
    framePubkey,
    inactiveSponsorPlan(config),
    smartCloseIxs,
    req.blockhashCtx
  );
}

async function buildSingleHopTransaction(
  pump: PumpContext,
  config: AppConfig,
  req: BuildTradeParams,
  quote: QuoteResponse,
  sponsor: SponsorPlan
): Promise<BuildTxResponse> {
  const user = new PublicKey(req.userPubkey);
  const accounts = await loadTokenBuildAccounts(pump, config, req.mintA);
  const feeRecipient = new PublicKey(config.serviceFee.pubkey);
  const feeRaw = BigInt(quote.serviceFeeRaw);
  const { scratch, framePubkey } = scratchForBuild(
    config.ifx.publicFrames,
    config.ifx.programId
  );

  const tx = new Transaction();
  tx.add(...priorityIxs(config, req.priorityTier));
  tx.add(scratch.ixReset());

  const baseAta = userBaseAta(
    accounts.mint,
    user,
    accounts.baseTokenProgram
  );
  const quoteAtaPk = userQuoteAta(
    user,
    accounts.quoteMint,
    accounts.quoteTokenProgram
  );

  const side = effectiveTradeSide(req.mode, req.side);

  if (side === "buy") {
    for (const spec of buyAtaSpecs(accounts)) {
      tx.add(idempotentAtaCreate(user, user, spec.mint, spec.tokenProgram));
    }

    if (feeRaw > 0n) {
      tx.add(
        serviceFeeTransferIx({
          quoteLabel: quote.serviceFeeLabel,
          feeRaw,
          user,
          userQuoteAta: quoteAtaPk,
          recipient: feeRecipient,
          quoteMint: accounts.quoteMint,
          quoteTokenProgram: accounts.quoteTokenProgram,
        })
      );
    }

    tx.add(
      await buyExactQuoteInV2Instruction({
        global: accounts.global,
        bondingCurve: accounts.bondingCurve,
        mint: accounts.mint,
        user,
        baseTokenProgram: accounts.baseTokenProgram,
        quoteMint: accounts.quoteMint,
        quoteTokenProgram: accounts.quoteTokenProgram,
        spendableQuoteIn: BigInt(quote.netQuoteRaw),
        minTokensOut: BigInt(quote.minOutputRaw),
        associatedBaseUser: baseAta,
      })
    );
  } else {
    tx.add(
      await sellV2Instruction({
        global: accounts.global,
        bondingCurve: accounts.bondingCurve,
        mint: accounts.mint,
        user,
        baseTokenProgram: accounts.baseTokenProgram,
        quoteMint: accounts.quoteMint,
        quoteTokenProgram: accounts.quoteTokenProgram,
        baseAmountIn: BigInt(quote.inputRaw),
        minQuoteOut: BigInt(quote.minOutputRaw),
      })
    );

    if (feeRaw > 0n) {
      tx.add(
        serviceFeeTransferIx({
          quoteLabel: quote.serviceFeeLabel,
          feeRaw,
          user,
          userQuoteAta: quoteAtaPk,
          recipient: feeRecipient,
          quoteMint: accounts.quoteMint,
          quoteTokenProgram: accounts.quoteTokenProgram,
        })
      );
    }

    if (sponsor.active && quote.serviceFeeLabel === "SOL") {
      if (
        BigInt(quote.minOutputRaw) - feeRaw <
        sponsor.repayLamports
      ) {
        throw new Error(
          "Insufficient SOL for transaction gas and rent — wallet balance is too low and trade proceeds cannot cover fees"
        );
      }
      const sponsorIxs: TransactionInstruction[] = [];
      appendSponsorRepay(scratch, sponsorIxs, user, sponsor.pubkey, {
        txFeeLamports: sponsor.txFeeLamports,
        repayBufferPercent: config.sponsor.repayBufferPercent,
      });
      tx.add(...sponsorIxs);
    }

    const smartCloseIxs = buildSmartCloseInstructions(scratch, [
      {
        tokenAccount: baseAta,
        rentDestination: user,
        owner: user,
        tokenProgram: accounts.baseTokenProgram,
      },
    ]);
    return finalizeTx(
      pump,
      config,
      user,
      tx,
      framePubkey,
      sponsor,
      smartCloseIxs,
      req.blockhashCtx
    );
  }

  return finalizeTx(
    pump,
    config,
    user,
    tx,
    framePubkey,
    sponsor,
    [],
    req.blockhashCtx
  );
}

export async function buildTradeTransaction(
  pump: PumpContext,
  config: AppConfig,
  req: BuildTradeParams
): Promise<BuildTxResponse> {
  const buildCtx = {
    mode: req.mode,
    side: req.side,
    mintA: req.mintA,
    mintB: req.mintB,
    userPubkey: req.userPubkey,
    priorityTier: req.priorityTier,
    ixKind: req.quoteSnapshot?.ixKind,
  };

  const quote = await runBuildPhase(
    "resolveQuote",
    () => resolveQuoteForBuild(pump, config, req),
    buildCtx
  );

  const user = new PublicKey(req.userPubkey);
  const side = effectiveTradeSide(req.mode, req.side);
  const needsBase = req.mode === "swap" || side === "sell";
  const resolved = await runBuildPhase(
    "resolveTokens",
    () => resolveTokens(pump, config, req.mintA, req.mintB),
    buildCtx
  );
  const wallet = await runBuildPhase(
    "fetchWalletBalances",
    () =>
      fetchWalletBalances(
        pump.connection,
        config,
        user,
        needsBase ? resolved.tokenA : undefined
      ),
    buildCtx
  );
  const limit = computeInputLimit({
    mode: req.mode,
    side,
    tokenA: resolved.tokenA,
    inputRaw: BigInt(quote.inputRaw),
    wallet,
  });
  if (limit.exceedsBalance) {
    throw new Error(limit.hint ?? "input exceeds wallet balance");
  }

  const bootstrapSpecs = await runBuildPhase(
    "resolveBootstrapAtaSpecs",
    () =>
      resolveBootstrapAtaSpecs(pump, config, {
        mode: req.mode,
        side: req.side,
        mintA: req.mintA,
        mintB: req.mintB,
      }),
    buildCtx
  );

  const slippageBps = req.slippageBps ?? config.quote.defaultSlippageBps;
  let sponsor: SponsorPlan = inactiveSponsorPlan(config);
  if (req.mode === "trade" && side === "sell") {
    if (req.userPubkey) {
      const decision = await runBuildPhase(
        "resolveSponsorDecision",
        () =>
          resolveSponsorDecision(pump.connection, config, {
            mode: req.mode,
            side,
            quote,
            slippageBps,
            priorityTier: req.priorityTier,
            user,
            walletSolRaw: BigInt(wallet.solRaw),
            bootstrapSpecs,
            useSponsorRequest: req.useSponsor,
          }),
        { ...buildCtx, useSponsor: req.useSponsor }
      );
      sponsor = decision.plan;
    }
  }

  if (req.mode === "swap") {
    if (req.useSponsor) {
      throw new Error(
        "Sponsored gas is not available for swaps — you pay gas and rent"
      );
    }
    return runBuildPhase(
      "assembleSwapTx",
      () => buildSwapTransaction(pump, config, req, quote),
      buildCtx
    );
  }
  return runBuildPhase(
    "assembleSingleHopTx",
    () => buildSingleHopTransaction(pump, config, req, quote, sponsor),
    { ...buildCtx, side }
  );
}

export type PrepareTradeParams = QuoteRequest & {
  priorityTier?: PriorityTier;
};

/** Quote + unsigned tx build in one round trip; blockhash fetched alongside quote. */
export async function prepareTrade(
  pump: PumpContext,
  config: AppConfig,
  req: PrepareTradeParams
): Promise<QuoteResponse> {
  const slippageBps = req.slippageBps ?? config.quote.defaultSlippageBps;
  const quoteReq: QuoteRequest = { ...req, slippageBps };

  const [blockhashCtx, quote] = await Promise.all([
    fetchBlockhashContext(pump.connection),
    quoteTrade(pump, config, quoteReq),
  ]);

  const blockhash = blockhashContextToExpiry(blockhashCtx);
  const base: QuoteResponse = { ...quote, blockhash };

  if (!req.userPubkey) {
    return { ...base, build: null, buildSkippedReason: "no_wallet" };
  }

  if (quote.inputLimit?.exceedsBalance) {
    return { ...base, build: null, buildSkippedReason: "exceeds_balance" };
  }

  const priorityTier = (req.priorityTier ??
    config.priorityFee.defaultTier) as PriorityTier;

  try {
    const build = await buildTradeTransaction(pump, config, {
      mode: req.mode,
      side: req.side,
      mintA: req.mintA,
      mintB: req.mintB,
      inputAmount: req.inputAmount,
      slippageBps,
      userPubkey: req.userPubkey,
      priorityTier,
      useSponsor: req.useSponsor,
      quoteSnapshot: quoteSnapshotFromResponse(quote),
      blockhashCtx,
    });
    return { ...base, build, buildSkippedReason: null };
  } catch (err) {
    return {
      ...base,
      build: null,
      buildSkippedReason: "build_error",
      buildError: errorMessage(err),
    };
  }
}
