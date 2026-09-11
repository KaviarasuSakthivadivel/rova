import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config";

export class DiscoveryNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export interface DiscoveryResult {
  careersUrl: string | null;
  ats: "greenhouse" | "lever" | "ashby" | "other" | "unknown";
  atsIdentifier: string | null;
  confidence: number; // 0-1
  notes: string;
}

const SYSTEM_PROMPT = `You identify a company's careers page and which applicant tracking system (ATS) it uses.
Use web search to confirm — do not guess from memory alone. Common ATS URL patterns:
- Greenhouse: boards.greenhouse.io/{token} (sometimes proxied through a custom domain)
- Lever: jobs.lever.co/{site}
- Ashby: jobs.ashbyhq.com/{name}
If you can't confidently identify the ATS after searching, say ats: "unknown" rather than guessing —
a wrong high-confidence guess is worse than an honest "unknown" here, since these go into a queue
a human reviews before anything is trusted.

Respond with ONLY a single JSON object on your final line, no other text, no markdown fences, matching
exactly this shape:
{"careersUrl": string or null, "ats": "greenhouse" | "lever" | "ashby" | "other" | "unknown", "atsIdentifier": string or null, "confidence": number between 0 and 1, "notes": string}`;

// Not cached as a module singleton — the SDK resolves `fetch` once at
// construction time, so a cached client would keep using whichever
// `fetch` was global the first time this ran. See src/ranking/claude.ts
// for the same pattern/reasoning.
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new DiscoveryNotConfiguredError();
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function isDiscoveryResult(value: unknown): value is DiscoveryResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.careersUrl === "string" || v.careersUrl === null) &&
    typeof v.ats === "string" &&
    ["greenhouse", "lever", "ashby", "other", "unknown"].includes(v.ats) &&
    (typeof v.atsIdentifier === "string" || v.atsIdentifier === null) &&
    typeof v.confidence === "number" &&
    typeof v.notes === "string"
  );
}

/**
 * LLM fallback for companies the heuristic URL-pattern pass couldn't
 * confirm. Uses the web_search server tool (runs entirely server-side —
 * no client-side tool loop to manage) so the model searches for the real
 * careers page instead of guessing from training data.
 *
 * Deliberately NOT using output_config.format here (the structured-output
 * path src/ranking/claude.ts uses): its interaction with server-tool use
 * (which can add tool_use/tool_result content blocks before the final
 * answer) isn't documented, so this asks for JSON via the system prompt
 * instead and parses the final text block defensively.
 */
export async function discoverViaLlm(companyName: string, domain?: string): Promise<DiscoveryResult | null> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    messages: [
      {
        role: "user",
        content: `Company: ${companyName}${domain ? `\nDomain: ${domain}` : ""}\n\nFind the careers page and identify the ATS.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`[discovery] Claude declined to research "${companyName}" (refusal)`);
    return null;
  }

  const textBlocks = response.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText || lastText.type !== "text") {
    console.warn(`[discovery] no text block in Claude's response for "${companyName}"`);
    return null;
  }

  // The model may wrap JSON in prose or fences despite instructions —
  // extract the last {...} block defensively rather than trust the whole
  // text is bare JSON.
  const jsonMatch = lastText.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[discovery] no JSON found in Claude's response for "${companyName}"`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn(`[discovery] Claude's response wasn't valid JSON for "${companyName}"`);
    return null;
  }

  if (!isDiscoveryResult(parsed)) {
    console.warn(`[discovery] Claude's response didn't match the expected shape for "${companyName}"`);
    return null;
  }

  return parsed;
}
