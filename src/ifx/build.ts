import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import type { AppConfig, PriorityTier } from "../config/types.js";
import { loadKeypairFromFile } from "../config/keypair.js";
import { appendConditionalCloseAta } from "../ifx/planner/close-ata.js";
import {
  appendSwapInstructions,
  sellMinQuoteForSwap,
} from "../ifx/planner/swap.js";
import {
  serviceFeeTransferIx,
  serviceFeeTransferIxAfterSolSell,
} from "../ifx/planner/service-fee.js";
import {
  appendSponsorAtaBootstrap,
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
  isNativeQuoteMint,
  sellV2Instruction,
  userBaseAta,
  userQuoteAta,
  wrapSolIxs,
} from "../pump/instructions.js";
import { resolveBootstrapAtaSpecs } from "../sponsor/bootstrap-specs.js";
import { buyAtaSpecs } from "../sponsor/ata-specs.js";
import {
  assertSponsorRepayCoverage,
  resolveSponsorPlan,
  type SponsorPlan,
} from "../sponsor/plan.js";
import {
  computeInputLimit,
  fetchWalletBalances,
} from "../wallet/balances.js";
import { assertTransactionSize } from "../util/transaction-size.js";
import { logError } from "../util/log-error.js";
import type { BuildTxRequest, BuildTxResponse, QuoteResponse, QuoteSnapshot } from "../types/api.js";

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
};

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
  });
}

async function finalizeTx(
  pump: PumpContext,
  config: AppConfig,
  user: PublicKey,
  tx: Transaction,
  framePubkey: string,
  sponsor: SponsorPlan
): Promise<BuildTxResponse> {
  const { blockhash, lastValidBlockHeight } =
    await pump.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const feePayer = sponsor.active ? sponsor.pubkey : user;
  tx.feePayer = feePayer;

  let partiallySignedBy: string[] | undefined;
  if (sponsor.active) {
    if (!config.sponsor.keypairPath) {
      throw new Error("sponsor.keypairPath required when sponsor is active");
    }
    tx.partialSign(loadKeypairFromFile(config.sponsor.keypairPath));
    partiallySignedBy = [sponsor.pubkey.toBase58()];
  }

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  assertTransactionSize(serialized);

  return {
    transaction: serialized.toString("base64"),
    recentBlockhash: blockhash,
    frameUsed: framePubkey,
    lastValidBlockHeight,
    feePayer: feePayer.toBase58(),
    signers: [user.toBase58()],
    partiallySignedBy,
  };
}

async function buildSwapTransaction(
  pump: PumpContext,
  config: AppConfig,
  req: BuildTradeParams,
  quote: QuoteResponse,
  sponsor: SponsorPlan
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

  if (sponsor.active && quote.serviceFeeLabel === "SOL") {
    assertSponsorRepayCoverage(
      sellMinQuote,
      BigInt(quote.serviceFeeRaw),
      sponsor.repayLamports
    );
  }

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
    repayBufferPercent: config.sponsor.repayBufferPercent,
    sponsor,
  });
  tx.add(...swapIxs);

  return finalizeTx(pump, config, user, tx, framePubkey, sponsor);
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

  const side = req.side ?? "buy";

  if (side === "buy") {
    const ataSpecs = buyAtaSpecs(accounts);
    const ifxIxs: TransactionInstruction[] = [];
    if (sponsor.active) {
      appendSponsorAtaBootstrap(scratch, ifxIxs, sponsor.pubkey, user, ataSpecs);
    } else {
      for (const spec of ataSpecs) {
        ifxIxs.push(
          idempotentAtaCreate(user, user, spec.mint, spec.tokenProgram)
        );
      }
    }
    tx.add(...ifxIxs);

    if (quote.serviceFeeLabel === "SOL" && feeRaw > 0n) {
      tx.add(
        serviceFeeTransferIx({
          quoteLabel: "SOL",
          feeRaw,
          user,
          userQuoteAta: quoteAtaPk,
          recipient: feeRecipient,
          quoteMint: accounts.quoteMint,
          quoteTokenProgram: accounts.quoteTokenProgram,
        })
      );
      tx.add(...wrapSolIxs(user, quoteAtaPk, BigInt(quote.netQuoteRaw)));
    } else if (feeRaw > 0n) {
      tx.add(
        serviceFeeTransferIx({
          quoteLabel: "USDC",
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

    const buyCloseIxs: TransactionInstruction[] = [];
    appendConditionalCloseAta(
      scratch,
      buyCloseIxs,
      quoteAtaPk,
      user,
      user,
      accounts.quoteTokenProgram
    );
    tx.add(...buyCloseIxs);
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
      if (quote.serviceFeeLabel === "SOL" && isNativeQuoteMint(accounts.quoteMint)) {
        tx.add(
          serviceFeeTransferIxAfterSolSell({
            feeRaw,
            user,
            userQuoteAta: quoteAtaPk,
            userWsolAta: quoteAtaPk,
            recipient: feeRecipient,
            quoteMint: accounts.quoteMint,
            quoteTokenProgram: accounts.quoteTokenProgram,
          })
        );
      } else {
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
    }

    const ifxIxs: TransactionInstruction[] = [];
    appendConditionalCloseAta(
      scratch,
      ifxIxs,
      baseAta,
      user,
      user,
      accounts.baseTokenProgram
    );
    if (sponsor.active && quote.serviceFeeLabel === "SOL") {
      assertSponsorRepayCoverage(
        BigInt(quote.minOutputRaw),
        feeRaw,
        sponsor.repayLamports
      );
      appendSponsorRepay(scratch, ifxIxs, user, sponsor.pubkey, {
        txFeeLamports: sponsor.txFeeLamports,
        repayBufferPercent: config.sponsor.repayBufferPercent,
      });
    }
    tx.add(...ifxIxs);
  }

  return finalizeTx(pump, config, user, tx, framePubkey, sponsor);
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
  const side = req.side ?? "buy";
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
    sponsorEnabled: config.sponsor.enabled,
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
  const sponsor = await runBuildPhase(
    "resolveSponsorPlan",
    () =>
      resolveSponsorPlan(pump.connection, config, {
        quoteLabel: quote.serviceFeeLabel,
        priorityTier: req.priorityTier,
        user,
        bootstrapSpecs,
      }),
    { ...buildCtx, sponsorEnabled: config.sponsor.enabled }
  );

  if (req.mode === "swap") {
    return runBuildPhase(
      "assembleSwapTx",
      () => buildSwapTransaction(pump, config, req, quote, sponsor),
      buildCtx
    );
  }
  return runBuildPhase(
    "assembleSingleHopTx",
    () => buildSingleHopTransaction(pump, config, req, quote, sponsor),
    { ...buildCtx, side }
  );
}
