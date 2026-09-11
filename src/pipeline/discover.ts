import { db } from "@/db/client";
import { companyDiscoveryCandidates } from "@/db/schema";
import { discoverViaHeuristics } from "@/discovery/heuristics";
import { DiscoveryNotConfiguredError, discoverViaLlm } from "@/discovery/llm";

export interface DiscoverOneResult {
  companyName: string;
  matched: boolean;
  source: "heuristic" | "llm" | "none";
  reason?: string;
}

/**
 * Heuristics first (cheap, no LLM) — only falls through to the LLM+web-
 * search path when no known ATS URL pattern resolves. Every result lands
 * in company_discovery_candidates pending review; never auto-promoted
 * into `companies`. See PLAN.md Phase 8.
 */
export async function discoverCompany(companyName: string, domain?: string): Promise<DiscoverOneResult> {
  const heuristicMatches = await discoverViaHeuristics(companyName);

  if (heuristicMatches.length > 0) {
    const best = heuristicMatches[0]!;
    await db.insert(companyDiscoveryCandidates).values({
      name: companyName,
      domain: domain ?? null,
      guessedAts: best.ats,
      guessedIdentifier: best.atsIdentifier,
      confidence: best.confidence.toString(),
      status: "pending",
    });
    return { companyName, matched: true, source: "heuristic" };
  }

  let llmResult: Awaited<ReturnType<typeof discoverViaLlm>> = null;
  let llmFailureReason: string | undefined;

  try {
    llmResult = await discoverViaLlm(companyName, domain);
  } catch (error) {
    if (error instanceof DiscoveryNotConfiguredError) {
      llmFailureReason = error.message;
    } else {
      llmFailureReason = error instanceof Error ? error.message : String(error);
      console.error(`[discover] failed for "${companyName}":`, llmFailureReason);
    }
  }

  // Always record an attempt — even a failed/unconfigured LLM lookup —
  // so it stays visible in the review queue and can be revisited (e.g.
  // once ANTHROPIC_API_KEY is configured) instead of silently vanishing.
  await db.insert(companyDiscoveryCandidates).values({
    name: companyName,
    domain: domain ?? null,
    guessedAts: llmResult?.ats ?? null,
    guessedIdentifier: llmResult?.atsIdentifier ?? null,
    confidence: llmResult ? llmResult.confidence.toString() : "0",
    status: "pending",
  });

  if (llmFailureReason) return { companyName, matched: false, source: "none", reason: llmFailureReason };

  const isSupported = llmResult && llmResult.ats !== "unknown" && llmResult.ats !== "other";
  return isSupported
    ? { companyName, matched: true, source: "llm" }
    : { companyName, matched: false, source: "llm", reason: "low confidence / unrecognized ATS" };
}

/** One company's failure must never abort the batch — same discipline as
 * the crawler and digest pipelines. */
export async function runDiscovery(names: string[]): Promise<DiscoverOneResult[]> {
  const results: DiscoverOneResult[] = [];

  for (const rawName of names) {
    const companyName = rawName.trim();
    if (!companyName) continue;

    const result = await discoverCompany(companyName);
    results.push(result);
    console.log(
      `[discover] ${result.companyName}: matched=${result.matched} source=${result.source} ${result.reason ?? ""}`.trim(),
    );
  }

  return results;
}
