import { env } from "@/config";
import * as claude from "./claude";
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
  return env.PACKET_GENERATION_PROVIDER === "ollama" ? ollama : claude;
}

export function generateResumeAndCoverLetter(...args: Parameters<typeof claude.generateResumeAndCoverLetter>) {
  return provider().generateResumeAndCoverLetter(...args);
}

export function generateAnswers(...args: Parameters<typeof claude.generateAnswers>) {
  return provider().generateAnswers(...args);
}
