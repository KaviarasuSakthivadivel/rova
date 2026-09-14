import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { env } from "@/config";

// Side-effect module, imported once at the very top of src/main.ts before
// any command branch — LLM calls happen from `serve`, `worker`, and
// several short-lived one-shot commands (`crawl`, `digest`, `rank`, ...),
// so this has to be in place before ANY of them can run, not just serve.
//
// v5 SDK (OTEL-based), not the `langfuse` npm package (v3, legacy
// /api/public/ingestion) — confirmed live against this project's
// self-hosted Langfuse v4 instance (docker-compose.langfuse.yml) that the
// legacy SDK's events were silently rejected: v4 runs in "events_only
// mode" and only accepts OTLP-based ingestion. See
// https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4.
let spanProcessor: LangfuseSpanProcessor | null = null;

if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
  spanProcessor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    // This project's dev server restarts on every source-file save
    // (`bun --watch`), and several of its CLI commands (crawl/digest/
    // rank/...) are short-lived processes that call process.exit(0) right
    // after their last LLM call — batched export risks losing the last
    // few spans to either. One HTTP call per span costs little at this
    // project's real call volume.
    exportMode: "immediate",
  });

  const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
  sdk.start();
}

// Awaited by main.ts before every process.exit — exportMode "immediate"
// still fires each export as a background HTTP call that a synchronous
// process.exit() would otherwise cut off mid-flight for the short-lived
// CLI commands. No-op (resolves immediately) when Langfuse isn't
// configured.
export async function flushObservability(): Promise<void> {
  if (!spanProcessor) return;
  try {
    await spanProcessor.forceFlush();
  } catch (error) {
    console.warn("[observability] failed to flush pending Langfuse spans:", error);
  }
}
