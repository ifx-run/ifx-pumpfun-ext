import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { loadConfig, isPriorityTier } from "./config/load.js";
import { createConnection } from "./solana/connection.js";
import { buildTradeTransaction } from "./ifx/build.js";
import { PumpContext } from "./pump/context.js";
import { resolveTokens } from "./pump/resolve.js";
import { quoteTrade } from "./pump/quote.js";
import { errorMessage, logRouteError } from "./util/log-error.js";

const resolveBody = z.object({
  mintA: z.string().min(32),
  mintB: z.string().min(32).optional(),
  userPubkey: z.string().optional(),
});

const quoteBody = z.object({
  mode: z.enum(["trade", "swap"]),
  side: z.enum(["buy", "sell"]).optional(),
  mintA: z.string().min(32),
  mintB: z.string().min(32).optional(),
  inputAmount: z.string().min(1),
  slippageBps: z.number().int().min(0).max(5000).optional(),
  userPubkey: z.string().optional(),
});

const quoteSnapshotBody = z
  .object({
    inputRaw: z.string(),
    inputLabel: z.string(),
    minOutputRaw: z.string(),
    serviceFeeRaw: z.string(),
    serviceFeeLabel: z.enum(["SOL", "USDC"]),
    netQuoteRaw: z.string(),
    ixKind: z.enum(["buy_exact_quote_in_v2", "sell_v2", "swap_a_b"]),
  })
  .optional();

const buildBody = quoteBody.extend({
  userPubkey: z.string().min(32),
  priorityTier: z.enum(["low", "medium", "high"]).optional(),
  quoteSnapshot: quoteSnapshotBody,
});

export async function buildApp() {
  const config = loadConfig();
  const connection = createConnection(config);
  const pump = new PumpContext(connection, config);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const publicDir = pathResolve(
    fileURLToPath(new URL("../public", import.meta.url))
  );
  await app.register(fastifyStatic, { root: publicDir });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config/public", async () => ({
    debounceMs: config.quote.debounceMs,
    defaultSlippageBps: config.quote.defaultSlippageBps,
    serviceFeeBps: config.serviceFee.bps,
    serviceFeeRecipientPubkey: config.serviceFee.pubkey,
    sponsorEnabled: config.sponsor.enabled,
    sponsorPubkey: config.sponsor.pubkey,
    publicFrameCount: config.ifx.publicFrames.length,
    priorityTiers: ["low", "medium", "high"],
    defaultPriorityTier: config.priorityFee.defaultTier,
    rpcUrl: config.solana.rpcUrl,
  }));

  app.post("/api/token/resolve", async (req, reply) => {
    const parsed = resolveBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      return await resolveTokens(
        pump,
        config,
        parsed.data.mintA,
        parsed.data.mintB,
        parsed.data.userPubkey
      );
    } catch (e) {
      logRouteError(req.log, "POST /api/token/resolve", e, {
        mintA: parsed.data.mintA,
        mintB: parsed.data.mintB,
      });
      return reply.code(400).send({ error: errorMessage(e) });
    }
  });

  app.post("/api/quote", async (req, reply) => {
    const parsed = quoteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (parsed.data.mode === "trade" && !parsed.data.side) {
      return reply.code(400).send({ error: "side required when mode=trade" });
    }
    try {
      return await quoteTrade(pump, config, {
        ...parsed.data,
        slippageBps:
          parsed.data.slippageBps ?? config.quote.defaultSlippageBps,
      });
    } catch (e) {
      logRouteError(req.log, "POST /api/quote", e, parsed.data);
      return reply.code(400).send({ error: errorMessage(e) });
    }
  });

  app.post("/api/tx/build", async (req, reply) => {
    const parsed = buildBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (parsed.data.mode === "trade" && !parsed.data.side) {
      return reply.code(400).send({ error: "side required when mode=trade" });
    }
    const tier = parsed.data.priorityTier ?? config.priorityFee.defaultTier;
    if (!isPriorityTier(tier)) {
      return reply.code(400).send({ error: "invalid priorityTier" });
    }
    try {
      return await buildTradeTransaction(pump, config, {
        ...parsed.data,
        slippageBps:
          parsed.data.slippageBps ?? config.quote.defaultSlippageBps,
        priorityTier: tier,
      });
    } catch (e) {
      logRouteError(req.log, "POST /api/tx/build", e, {
        mode: parsed.data.mode,
        side: parsed.data.side,
        mintA: parsed.data.mintA,
        mintB: parsed.data.mintB,
        userPubkey: parsed.data.userPubkey,
        priorityTier: tier,
        ixKind: parsed.data.quoteSnapshot?.ixKind,
      });
      return reply.code(400).send({ error: errorMessage(e) });
    }
  });

  return { app, config };
}

export async function startServer() {
  const { app, config } = await buildApp();
  await app.listen({ host: config.server.host, port: config.server.port });
  return app;
}

// Direct run
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
