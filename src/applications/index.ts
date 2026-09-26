import { env } from "@/config";
import * as claude from "./claude";
import * as codex from "./codex";
import * as ollama from "./ollama";

export { PacketGenerationNotConfiguredError } from "./errors";
export type {
  GenerateAnswersInput,
  GenerateAnswersResult,
  GenerateResumeInput,
  GenerateResumeResult,
  ResumeAndCoverLetter,
} from "./prompt";

function provider() {
  if (env.PACKET_GENERATION_PROVIDER === "ollama") return ollama;
  if (env.PACKET_GENERATION_PROVIDER === "codex") return codex;
  return claude;
}

export function generateResumeAndCoverLetter(...args: Parameters<typeof claude.generateResumeAndCoverLetter>) {
  return provider().generateResumeAndCoverLetter(...args);
}

export function generateAnswers(...args: Parameters<typeof claude.generateAnswers>) {
  return provider().generateAnswers(...args);
}
