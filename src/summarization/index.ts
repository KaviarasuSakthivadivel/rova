import { env } from "@/config";
import * as claude from "./claude";
import * as ollama from "./ollama";
import type { SummarizeJobInput } from "./prompt";

export { SummarizationNotConfiguredError } from "./errors";
export type { SummarizeJobInput } from "./prompt";

export function summarizeJob(input: SummarizeJobInput): Promise<string> {
  const provider = env.SUMMARIZATION_PROVIDER === "claude" ? claude : ollama;
  return provider.summarizeJob(input);
}
