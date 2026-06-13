export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

/** stderr — for modules without Fastify request logger (e.g. build pipeline). */
export function logError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>
): void {
  console.error(`[${label}]`, errorMessage(err));
  if (context && Object.keys(context).length > 0) {
    console.error(`[${label}] context`, context);
  }
  const stack = errorStack(err);
  if (stack) console.error(stack);
}

type ErrorLogger = {
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

/** Fastify req.log / app.log */
export function logRouteError(
  log: ErrorLogger,
  route: string,
  err: unknown,
  context?: Record<string, unknown>
): void {
  log.error(
    {
      err,
      stack: errorStack(err),
      route,
      ...context,
    },
    `[${route}] ${errorMessage(err)}`
  );
}
