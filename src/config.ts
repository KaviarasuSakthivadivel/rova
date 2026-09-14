import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDINGS_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  SUMMARIZATION_PROVIDER: z.enum(["ollama", "claude"]).default("ollama"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3.2:3b"),
  // Unlike SUMMARIZATION_PROVIDER (default ollama — a one-sentence
  // summary is low-stakes), this defaults to claude: packet content goes
  // directly into real job applications, and quality matters a lot more
  // than for a summary. Switch explicitly to try local generation — see
  // src/applications/ollama.ts's structured-output caveat re: model size.
  PACKET_GENERATION_PROVIDER: z.enum(["claude", "ollama"]).default("claude"),
  RESEND_API_KEY: z.string().optional(),
  DIGEST_FROM_EMAIL: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  // Insurance against a client bug (e.g. a runaway polling loop
  // retriggering /generate), not user-facing rate-limiting — this is a
  // single-user tool, so the default is generous and should be invisible
  // in real use. See src/api/applications.ts.
  MAX_PACKET_GENERATIONS_PER_DAY: z.coerce.number().default(50),
  // Optional LLM-call tracing/auditing (src/observability/langfuse.ts) —
  // every call site no-ops when these aren't set, same as every other
  // optional integration in this project (Resend, OpenAI, Ollama).
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default("https://cloud.langfuse.com"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(Bun.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
