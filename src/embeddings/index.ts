import { env } from "@/config";
import * as ollama from "./ollama";
import * as openai from "./openai";

export { EmbeddingsNotConfiguredError } from "./errors";

function provider() {
  return env.EMBEDDINGS_PROVIDER === "ollama" ? ollama : openai;
}

export function embedTexts(texts: string[]): Promise<number[][]> {
  return provider().embedTexts(texts);
}

export function embedText(text: string): Promise<number[]> {
  return provider().embedText(text);
}
