> **Superseded by [`PRD.md`](./PRD.md)** for architecture, tech stack, and
> phasing (Bun/TypeScript, multi-user, Postgres+pgvector, Claude+OpenAI).
> Kept here for the product rationale and phase-level detail that still
> applies.

# Rova — Role Discovery + AI

**Rova** = continuous role discovery across company career pages/ATS systems, with AI
embedded at several points in the pipeline (discovery, enrichment, matching,
explanation) rather than just a keyword job board.

This document is the working plan. Background research and reference
implementation code (Greenhouse/Lever/Ashby adapters, schema sketch) live in
[`job_indexer_whole_chat.md`](./job_indexer_whole_chat.md) — this file turns
that into phases + an architecture decision.

---

## 1. Problem statement

Job boards (LinkedIn, Indeed) are indexes of *listings people chose to post
there*. The interesting roles are often only on a company's own careers page,
posted through an ATS (Greenhouse, Lever, Ashby, Workday, ...) and never
syndicated anywhere else. Finding them today means manually checking dozens of
company career pages on a recurring basis.

Rova's job: do that checking continuously, remember what changed, and use AI
to turn "here are 400 new postings" into "here are the 8 roles actually worth
your time, and why."

## 2. Core capabilities

| Capability | MVP | Later |
|---|---|---|
| Track companies across ATS providers | Greenhouse, Lever, Ashby | + Workday, generic HTML |
| Daily crawl + diff (added/changed/closed) | yes | intra-day for hot companies |
| Historical snapshots | yes | hiring-trend reporting |
| Full-text filtering | yes | — |
| Semantic search (pgvector) | — | yes |
| LLM ranking + explanation | — | yes |
| Daily digest (email/Slack) | plain filtered list | ranked + "why you're seeing this" |
| AI-assisted company/ATS discovery | — | yes (the hard scaling problem) |
| Multi-profile / multi-user | — | maybe |

---

## 3. Architecture brainstorm

### Option A — Cron + monolith
One Python process does crawl → normalize → store → embed → rank → alert,
triggered by cron. Simplest possible thing.

- **Pros:** fastest to ship, trivial to run locally, one thing to deploy.
- **Cons:** a broken embeddings call or LLM outage blocks tomorrow's crawl
  too; no isolation between "crawling reliably" (must never break) and
  "AI enrichment" (fine if it degrades). Doesn't scale past a few hundred
  companies before a single run takes too long.

### Option B — Staged pipeline, single deploy (recommended for MVP)
Same single deploy/cron trigger, but the stages are separated by the
database itself, not by code coupling:

```text
                    CRAWLER  (must be reliable)
                       │
                       ▼
              raw/normalized jobs → Postgres (source of truth)
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
       ENRICHMENT              SEARCH
   (embeddings, LLM tags)   (keyword + vector queries)
            │                     │
            └──────────┬──────────┘
                        ▼
                     RANKER  (LLM, shortlist only)
                        ▼
                     ALERTS  (digest)
```

- **Pros:** crawler never depends on the AI stages succeeding — tomorrow's
  jobs still get indexed even if the embedding provider is down. Each stage
  can run on its own schedule/retry policy. Still one repo, one Postgres, no
  queue infra.
- **Cons:** still batch, not real-time; a single slow stage can still delay
  the digest if run sequentially (mitigate by running enrichment as its own
  cron job a bit after the crawl, not inline).

### Option C — Event-driven / queue-based (scale-out)
Scheduler → queue (SQS/Redis) → worker pool per ATS type → Postgres, with a
change-events topic fanning out to enrichment/embedding/alerting workers
independently.

- **Pros:** scales to thousands of companies, per-job retries/backoff,
  real parallelism, near-real-time alerts possible.
- **Cons:** real infra to operate (queue, worker pool, dead-letter
  handling). Not worth it below ~500-1000 companies or before crawl time
  is actually a problem.

### Option D — Serverless
Lambda/Cloudflare Workers on a cron trigger + managed Postgres (Neon/Supabase)
+ pgvector.

- **Pros:** zero servers to manage, pay-per-run, cheap at low volume.
- **Cons:** execution time limits bite once you're crawling hundreds of
  companies in one invocation; harder local dev loop; still need to shard
  work across invocations eventually, which is most of Option C's
  complexity anyway.

### Decision
**Start with Option B.** It's the same amount of work as Option A but the
stage boundaries (crawler / enrichment / search / ranker / alerts) are drawn
from day one, so migrating to Option C later is "add a queue between
existing stages," not a rewrite. Revisit Option C only when either (a)
company count pushes past ~500-1000 or (b) same-day/near-real-time alerts
become a real requirement.

### Where AI actually plugs in

```text
  Company/ATS         Enrichment           Search              Ranker            Alerts
  Discovery      →    (per job)      →    (per query)     →   (shortlist)   →   (digest)
  ───────────         ──────────           ──────           ────────           ───────
  LLM + search to      LLM extracts        embeddings for     LLM scores        LLM writes
  find careers URL     skills/seniority    semantic          top ~100 vs        the "why
  + detect ATS type    when ATS doesn't    similarity vs      profile,          you're
  (Phase 8)            supply them         profile            structured out    seeing this"
```

Guardrail that applies everywhere AI touches the pipeline: **never run an
LLM over the full corpus.** Every AI stage operates on a shortlist that's
already been narrowed by cheap deterministic filters (SQL) and/or vector
search. This keeps cost bounded and predictable as the corpus grows.

---

## 4. Data model

Core tables (detailed DDL already sketched in the reference chat log):

```text
companies              — id, name, slug, ats, ats_identifier, careers_url, active
jobs                   — current state per posting; source+external_id unique;
                          content_hash + first_seen_at/last_seen_at/status drive
                          change detection without trusting provider timestamps
job_snapshots          — one row per detected change, for history/trend queries
crawl_runs             — per-company-per-run observability (counts, errors)
```

Additions for Rova beyond the MVP sketch:

```text
company_discovery_candidates   — Phase 8: name/domain → guessed ATS + confidence,
                                  pending human review before promotion to `companies`
candidate_profiles              — Phase 6+: supports more than one profile later
                                   (text profile + embedding + match preferences)
```

`jobs.embedding vector(1536)` and the `ivfflat` index are added in Phase 5,
not before — an unused vector column/index is just overhead until embeddings
are actually being written and queried.

---

## 5. Detailed phased implementation plan

Each phase has explicit exit criteria — don't start the next phase until the
current one's criteria hold against real data, not fixtures.

### Phase 0 — Project scaffold (0.5–1 day)
- Repo layout: `app/{sources,pipeline}`, `migrations/`, `scripts/`,
  `tests/`, `docker-compose.yml`
- `docker-compose.yml`: Postgres 16 with `pgvector` + `pgcrypto` extensions
- Base deps: `fastapi httpx sqlalchemy psycopg[binary] alembic
  pydantic-settings tenacity beautifulsoup4 lxml python-dateutil`
- **Exit:** `docker compose up` + `alembic upgrade head` gives an empty,
  correctly-extensioned database.

### Phase 1 — Schema + seed companies (1–2 days)
- Alembic migration for `companies`, `jobs`, `job_snapshots`, `crawl_runs`
  and the indexes (skip the vector index for now — Phase 5)
- `scripts/seed_companies.py` + a CSV of ~50 real companies split across
  Greenhouse/Lever/Ashby
- **Exit:** `companies` table has ~50 rows, spot-checked by hand against
  the real career pages.

### Phase 2 — ATS adapters + normalization (2–3 days)
- `JobSource` ABC + `NormalizedJob` dataclass (single shape every adapter
  returns, so ingestion never branches on provider)
- `GreenhouseSource`, `LeverSource`, `AshbySource` — reference
  implementations already drafted in the chat log
- `pipeline/normalize.py`: `html_to_text`, `content_hash`
- Unit tests against **recorded fixture payloads** per provider (don't hit
  live APIs in tests)
- **Exit:** for 10+ real board tokens across all three ATS, adapters
  return clean `NormalizedJob` lists with no HTML leaking into `description`.

### Phase 3 — Ingestion + change detection (2–3 days)
- `upsert_job`: insert new / snapshot-then-update changed / touch
  `last_seen_at` on unchanged, keyed off `content_hash`
- Closed-job detection: collect `seen_ids` per crawl, bulk `UPDATE ...
  status='CLOSED' WHERE external_id NOT IN seen_ids` (temp table if the
  seen-set is large — avoid a giant literal `NOT IN`)
- `crawl_runs` bookkeeping: started/finished, jobs_seen/added/updated/closed,
  error capture per company (one company's failure must not abort the run)
- `scripts/crawl.py` entrypoint, run manually first, cron later
- **Exit:** running the crawl twice back-to-back on unchanged companies
  produces zero snapshots and `UNCHANGED` for every job; manually editing a
  test posting produces exactly one snapshot; removing a posting flips it to
  `CLOSED` with a `closed_at` timestamp.

### Phase 4 — Baseline product: search + digest v1 (1–2 days)
- No AI yet — this phase proves the pipeline is useful on its own
- Deterministic SQL: "new in last 24h", `ILIKE` keyword filters
- Digest v1: plain filtered list of new jobs → email or Slack webhook
- **Exit:** you receive a real digest email/Slack message driven by a real
  overnight cron run, not a manual script invocation.

### Phase 5 — Semantic search (2–3 days)
- Add `jobs.embedding vector(1536)` + `ivfflat` index (only now)
- Embedding generation as its **own** batch job over new/changed rows,
  decoupled from the crawler per the Option B architecture — a failed
  embedding run must never block Phase 3's crawl
- Candidate-profile embedding + cosine-similarity query for top-N
- **Exit:** a profile without the literal keyword "Kafka" still surfaces a
  "Streaming Platform Engineer" posting in the top 50.

### Phase 6 — LLM ranking + explainable digest (2–3 days)
- Funnel: SQL filter → vector top-100 → LLM scores the shortlist only
- Structured LLM output: `score`, `strong_matches`, `missing_requirements`,
  `reasons`
- Digest v2: top 5–10 ranked jobs, each with "why you're seeing this"
- Cost guardrail: cache scores by `content_hash` so an unchanged job is
  never re-scored; hard cap on LLM calls per run; log $ spent per run
- **Exit:** digest output matches the target mock quality from the research
  chat, and cost-per-run is logged and bounded.

### Phase 7 — Reliability & observability (1–2 days; can overlap earlier phases)
- `tenacity` retry/backoff per adapter call
- Small CLI/dashboard reading `crawl_runs` to show recent run health
- Alert on crawl *failures*, separate from the job-match digest
- **Exit:** killing network access to one company's ATS mid-run still lets
  every other company complete, and the failure is visible without grepping
  logs.

### Phase 8 — Company/ATS discovery (open-ended, 3–5+ days)
This is the piece flagged in the research as the actual hard part of
scaling past a hand-maintained company list.
- Heuristics first: known URL patterns (`jobs.lever.co/{slug}`,
  `boards.greenhouse.io/{slug}`, `jobs.ashbyhq.com/{slug}`), domain → ATS
  fingerprinting
- LLM fallback only for ambiguous cases: given a company name/domain, find
  the careers URL and classify the ATS
- `company_discovery_candidates` table with a confidence score + manual
  review/approval step before promotion into `companies` — never
  auto-promote unreviewed guesses
- **Exit:** feeding a list of 100 company names auto-resolves the clear
  majority correctly, with the rest queued for a 30-second manual review
  each rather than manual research from scratch.

### Phase 9 — Scale-out infra (only when needed)
- Trigger: company count or crawl duration makes the single cron run too
  slow, or same-day alerting becomes a real requirement
- Migrate to Option C (queue + worker pool per ATS type)
- Add generic-HTML and Workday adapters
- **Exit:** crawl SLA holds as company count grows past ~500–1000.

### Phase 10 — Product polish (ongoing)
- Minimal web UI for browsing/searching + adjusting the profile
- Multi-profile support
- Hiring-trend reporting ("Company X added 37 engineering roles this
  month") — enabled for free by the snapshot history kept since Phase 3

---

## 6. Tech stack

```text
Python 3.12, FastAPI, httpx, SQLAlchemy 2, PostgreSQL 16 + pgvector,
Alembic, Docker, cron (queue/workers only from Phase 9 on)
```

Kept intentionally boring through Phase 7 — no Celery, no Elasticsearch, no
S3 — every one of those is a Phase 9+ decision to make only when the
simpler thing actually breaks.

## 7. Open questions

- **Hosting:** self-hosted Docker vs. managed Postgres (Neon/Supabase) —
  affects when pgvector/extensions are available and how backups work.
- **LLM provider/budget:** which model for ranking (Phase 6) and discovery
  (Phase 8), and what's the acceptable $/day once the shortlist sizes are
  known.
- **Delivery channel:** email vs. Slack vs. a minimal web UI as the
  Phase 4 digest target — affects what "MVP done" looks like.
- **Single-user tool vs. eventual multi-profile product** — affects whether
  `candidate_profiles` is worth building in Phase 6 or is over-engineering
  for a v1 that only needs one hardcoded profile.
