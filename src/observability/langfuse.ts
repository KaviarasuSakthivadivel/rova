import { startObservation } from "@langfuse/tracing";
import { env } from "@/config";

const configured = !!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);

export interface LogGenerationInput {
  /** Which call site — e.g. "rank-job", "summarize-job", "generate-resume",
   * "generate-answers", "discover-company". */
  name: string;
  provider: "claude" | "ollama" | "codex";
  model: string;
  input: unknown;
  output: unknown;
  inputTokens?: number;
  outputTokens?: number;
  /** Set when the call failed/returned nothing usable — logged as an
   * ERROR-level observation instead of DEFAULT, still never throws. */
  error?: string;
}

/**
 * Fire-and-forget tracing — a no-op whenever Langfuse isn't configured
 * (no keys set), and never allowed to fail or slow down the actual LLM
 * call it's describing. This is purely an audit trail; it must never be
 * a dependency the rest of the pipeline can break on.
 *
 * Each call is a complete, already-finished generation (input/output/
 * usage/error are all known upfront here, not observed live), so this
 * starts and immediately ends one observation rather than wrapping
 * in-progress work — see src/observability/instrumentation.ts for the
 * OTEL SDK setup this relies on (must be initialized first).
 */
export function logGeneration(data: LogGenerationInput): void {
  if (!configured) return;

  try {
    const generation = startObservation(
      data.name,
      {
        model: data.model,
        modelParameters: { provider: data.provider },
        input: data.input,
        output: data.output,
        usageDetails: data.inputTokens !== undefined ? { input: data.inputTokens, output: data.outputTokens ?? 0 } : undefined,
        level: data.error ? "ERROR" : "DEFAULT",
        statusMessage: data.error,
      },
      { asType: "generation" },
    );
    generation.end();
  } catch (error) {
    console.warn("[observability] failed to log a generation to Langfuse:", error);
  }
}
