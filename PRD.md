# Rova — Product Requirements Document

> Supersedes [`PLAN.md`](./PLAN.md) as the source of truth for architecture and
> phasing. `PLAN.md` and [`job_indexer_whole_chat.md`](./job_indexer_whole_chat.md)
> are kept for the product rationale, ATS research, and reference code —
> most of which still applies, just retargeted from Python to Bun/TypeScript
> and from single-user to multi-user.

## 1. Product summary

**Rova** continuously discovers open roles directly from company career
pages/ATS systems (not job boards), tracks how they change over time, and
uses AI to turn "here are 400 new postings" into "here are the 8 roles
actually worth your time, and why" — personalized per user.

**Problem it solves:** the best roles are often only on a company's own
careers page, posted through an ATS (Greenhouse, Lever, Ashby, Workday, ...)
and never syndicated to LinkedIn/Indeed. Finding them today means manually
checking dozens of company career pages on a recurring basis.

## 2. Goals / non-goals

**Goals (MVP):**
- Crawl a curated list of companies across Greenhouse/Lever/Ashby daily,
  diff against yesterday, keep full history.
- Let multiple users sign up, each with their own candidate profile and
  saved/dismissed jobs.
- Deterministic search/filtering on day one; semantic (pgvector) search and
  LLM ranking + explanation as the AI layer on top.
- Daily digest per user (email, later Slack).
- Ship as a **single Bun executable**, then a **Docker image** built from
  that executable.

**Non-goals (for now):**
- Crawling LinkedIn/Indeed or any board that isn't a direct ATS source.
- Auto-discovering companies at scale (Phase 8, explicitly deferred).
- Applying to jobs on the user's behalf.
- Real-time/sub-daily alerts (batch/daily is fine until proven otherwise).

## 3. Users

Multi-user from the start (per your direction — avoids an auth/profile
migration later):

- **End user**: signs up, writes/edits a candidate profile (free text +
  structured preferences: locations, remote, seniority, comp floor), gets a
  daily digest, can browse/search all tracked jobs, save/dismiss individual
  postings.
- **Admin** (you, initially): manages the tracked company list, watches
  crawl health, reviews AI-discovered company candidates (Phase 8+).

Company/job data is a **shared corpus** — all users search the same crawled
jobs. Profiles, preferences, saved/dismissed jobs, and digests are
**per-user**.

## 4. Tech stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Native TS execution, built-in test runner, built-in Postgres driver, `bun build --compile` → single executable, fast bundler for the frontend — one toolchain for everything. |
| Language | TypeScript everywhere | One language across API, worker, and frontend; shared types/Zod schemas between backend and UI. |
| API framework | **Hono** | Tiny, fast, runs natively on `Bun.serve`, first-class middleware for sessions/auth/CORS/validation, compiles cleanly in `bun build --compile` (pure JS, no native deps). |
| Database | **Postgres 16 + pgvector** | Matches the original research; full-text (`tsvector`) and vector search in one engine; `pgvector/pgvector:pg16` Docker image for local/prod. |
| DB driver / ORM | **Drizzle ORM** over Bun's native `Bun.sql` Postgres client (fallback: `postgres.js`, also pure JS) | Type-safe schema + migrations (`drizzle-kit`), no native bindings to fight with when compiling to a single binary. |
| Auth | Hand-rolled session auth: `Bun.password` (argon2id) for hashing, signed httpOnly cookies, `sessions` table for revocation | Simple, no framework dependency, fits a small multi-user app; OAuth (Google) can be added later without a rewrite. |
| Frontend | **React + TypeScript**, bundled via Bun's native fullstack dev server (HTML imports) | Bun bundles/transpiles/hot-reloads React directly from an `index.html` entry — no separate Vite/webpack toolchain, and the built assets embed into the same compiled binary. |
| Styling | Tailwind CSS | Fast to build a data-dense dashboard UI with, minimal custom CSS. |
| Data fetching | TanStack Query + `fetch` against the Hono API | Caching/revalidation for the SPA without a heavier framework. |
| Validation | Zod | Shared request/response schemas between Hono routes and the React client. |
| Scheduler | **croner** (pure-JS cron) inside a long-running `worker` process | No native deps (compiles fine), simple `cron`-string API, runs crawl/enrich/rank/digest stages on independent schedules per the staged-pipeline design below. |
| Email | Resend (or SMTP fallback) + React Email for templates | React Email reuses the same React/TS stack to author digest templates. |
| LLM (ranking/explanation) | **Anthropic (Claude)** | Structured output for `{score, strong_matches, missing_requirements, reasons}`; used only on an already-narrowed shortlist per the cost guardrail below. |
| Embeddings | **OpenAI `text-embedding-3-*`** | Anthropic has no embeddings API; OpenAI's embedding models are the standard pairing. |
| Resume parsing | `unpdf` (PDF) | Zero-dependency pdf.js wrapper, no native/canvas requirement — verified to compile cleanly under `bun build --compile`. Plain `.txt` handled directly. |
| Testing | `bun test` (built-in) | Fixture-based adapter tests (recorded Greenhouse/Lever/Ashby payloads), no live API calls in CI. |
| Packaging | `bun build --compile` → single binary with subcommands, then a minimal Dockerfile copying just that binary | Matches your stated goal: single executable first, Docker wrapping it second. |

## 5. System architecture

Same staged-pipeline reasoning as the original research (Option B: "cron +
monolith, but stages separated by the database, not by code coupling") —
translated to two Bun processes built from one binary:

```text
                    rova serve                        rova worker
              (Hono API + React SPA)          (croner-scheduled stages)
                       │                                  │
                       │                     ┌────────────┼─────────────┬───────────┐
                       │                     ▼            ▼             ▼           ▼
                       │                 CRAWLER     ENRICHMENT      RANKER      DIGEST
                       │              (ATS adapters)  (embeddings)  (Claude,    (email/
                       │                     │              │        per-user   Slack)
                       │                     ▼              ▼      shortlist)      │
                       └──────────────►  Postgres + pgvector (source of truth) ◄────┘
```

- `rova serve` is the only process end users touch (web UI + API).
- `rova worker` runs the pipeline on independent schedules — a broken
  embeddings/LLM call blocks tomorrow's *ranking*, never tomorrow's *crawl*.
- Both are the **same compiled binary**, invoked with a different
  subcommand — no separate build artifacts to keep in sync.
- One-shot subcommands (`rova crawl`, `rova enrich`, `rova rank`,
  `rova digest`, `rova migrate`, `rova seed`) exist too, for manual runs,
  debugging, and as a host-cron alternative to the built-in scheduler.

**Guardrail carried over from the original research:** never run an LLM
over the full corpus. Every AI stage runs on a shortlist already narrowed
by SQL filters and/or vector similarity — this bounds cost and keeps it
predictable as the corpus and user count grow. With multiple users, ranking
cost scales per-user-per-shortlist, so this matters more, not less — cache
Claude scores by `(profile_id, job.content_hash)` so an unchanged job is
never re-scored for a user who already saw it.

## 6. Data model

```text
users                    — id, email, password_hash, created_at
sessions                 — id, user_id, expires_at, created_at

companies                — id, name, slug, ats, ats_identifier, careers_url, active
jobs                      — current state per posting; (source, external_id) unique;
                            content_hash + first_seen_at/last_seen_at/status drive
                            change detection without trusting provider timestamps;
                            embedding vector(1536) added in the semantic-search phase
job_snapshots             — one row per detected change, for history/trend queries
crawl_runs                — per-company-per-run observability (counts, errors)

candidate_profiles        — id, user_id, profile_text, resume_text (extracted from
                            an uploaded PDF/.txt — see POST /api/profile/resume),
                            embedding vector(1536) (embeds profile_text + resume_text
                            combined), preferences jsonb (locations, remote_ok,
                            seniority, comp_floor), created_at, updated_at
user_job_actions          — id, user_id, job_id, action (saved/dismissed/applied),
                            created_at — also suppresses dismissed jobs from
                            future digests
digest_deliveries         — id, user_id, profile_id, sent_at, channel, job_ids[]
                            — dedupes what's already been surfaced to a user

company_discovery_candidates — Phase 8: name/domain → guessed ATS + confidence,
                                pending admin review before promotion to `companies`
```

`companies` / `jobs` / `job_snapshots` / `crawl_runs` are unchanged from the
original research — they're correct independent of language or multi-user.
The new tables (`users`, `sessions`, `candidate_profiles` scoped to
`user_id`, `user_job_actions`, `digest_deliveries`) are what multi-user adds
on top.

## 7. API surface (sketch)

```text
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/profile
PUT    /api/profile              (profile_text + resume_text + preferences; re-embeds on save)
POST   /api/profile/resume       (upload a PDF/.txt, returns extracted text for review)

GET    /api/jobs?q=&semantic=&location=&seniority=...
GET    /api/jobs/:id
POST   /api/jobs/:id/action      ({ action: "saved" | "dismissed" })

GET    /api/digest               (history of past digests for the current user)
POST   /api/digest/send-test     (manually trigger a digest send, for debugging)

GET    /api/companies            (admin: tracked company list + crawl health)
GET    /api/companies/candidates (admin, Phase 8: discovery review queue)
```

## 8. Component breakdown

1. **Auth & users** — signup/login/logout, session middleware, profile CRUD.
2. **Crawler & adapters** — `JobSource` interface + `GreenhouseSource` /
   `LeverSource` / `AshbySource` (ported 1:1 from the reference Python in
   `job_indexer_whole_chat.md` — same public APIs, same normalized-job
   shape, just TS types instead of dataclasses).
3. **Ingestion & change detection** — upsert-or-snapshot by `content_hash`,
   closed-job detection via seen-ID diffing.
4. **Enrichment** — embedding generation for new/changed jobs, decoupled
   from the crawl.
5. **Search** — SQL full-text + pgvector cosine similarity.
6. **Ranker** — per-user: SQL filter → vector top-N → Claude scores the
   shortlist → structured `{score, why, missing}`.
7. **Digest & alerts** — per-user digest assembly + delivery (email first,
   Slack webhook later), backed by `digest_deliveries` for dedup.
8. **Web UI** — auth screens, job search/browse, profile editor, digest
   history, saved/dismissed jobs; admin views for company/crawl health.
9. **Scheduler/worker** — croner jobs orchestrating stages 2–7 on
   independent schedules.
10. **Company/ATS discovery** (Phase 8, later) — heuristics + LLM fallback
    + admin review queue before promotion into `companies`.
11. **Observability** — `crawl_runs`-backed health view, structured logs,
    failure alerting separate from the job-match digest.

## 9. Packaging & deployment

1. **Dev:** `bun install` → `docker compose up -d postgres` (pgvector
   image) → `bun run db:migrate` → `bun run dev` (serve) + `bun run
   dev:worker`.
2. **Single executable:** `bun build ./src/main.ts --compile --outfile
   rova` — frontend assets bundle in at build time via the HTML-import
   entry point, so the resulting binary needs nothing but a reachable
   Postgres to run. Distributable to any machine without Bun installed.
3. **Docker (next step, per your ask):** two-stage Dockerfile —
   `oven/bun` image compiles the binary, then a slim runtime image
   (`debian-slim` or distroless) copies just that binary as the
   entrypoint. `docker-compose.yml` wires `postgres` (pgvector image),
   `web` (`rova serve`), and `worker` (`rova worker`).

Keeping all dependencies pure-JS/TS (Hono, Drizzle, Zod, croner, Bun's
built-in Postgres driver) avoids the native-addon problems that break
`bun build --compile` — this is a hard constraint on future dependency
choices, not just a preference.

## 10. Phased roadmap

Same phase-by-phase discipline as the original plan — each phase has an
exit criterion, don't start the next until it holds against real data.

| Phase | Scope | Notes vs. original plan |
|---|---|---|
| 0 | Bun project scaffold, Docker Compose Postgres+pgvector, Drizzle config | New: also scaffold `users`/`sessions` from day one. |
| 1 | Schema + seed ~50 companies | Unchanged. |
| 2 | ATS adapters (Greenhouse/Lever/Ashby) + normalization | Port reference Python adapters to TS `JobSource` implementations; fixture-based `bun test`. |
| 3 | Ingestion + change detection + `crawl_runs` | Unchanged in design. |
| 4 | Auth (signup/login) + profile CRUD + baseline search UI | **New vs. original**: auth ships in the MVP, not deferred. |
| 5 | Digest v1 (deterministic, plain filtered list) → email | Unchanged in design. |
| 6 | Semantic search (pgvector) | Unchanged. |
| 7 | LLM ranking + explainable digest v2 (Claude) | Cost guardrail now keyed per-user; cache by `(profile_id, content_hash)`. |
| 8 | Reliability & observability | Unchanged. |
| 9 | Company/ATS discovery + admin review queue | Unchanged. |
| 10 | Scale-out infra (queue/worker pool) — only when needed | Unchanged; trigger stays company count or same-day-alert requirements. |
| 11 | Dockerize (`rova serve` + `rova worker` + Postgres compose) | New: explicit phase for your stated Docker goal, sits after the binary is solid. |

## 11. Open questions

- **Company list curation:** who adds companies pre-Phase-9 (admin UI vs.
  editing a seed CSV) — small enough to defer past Phase 4.
- **Slack per-user:** per-user incoming webhook URL stored on the profile,
  or a single shared workspace app with OAuth — affects Phase 5/Phase-later
  scope.
- **Hosting for Postgres in production:** self-hosted (same Docker Compose
  as local) vs. managed (Neon/Supabase, both pgvector-capable) — affects
  backup story once this leaves your laptop.
- **Rate limits / abuse** once multi-user: even at small scale, a
  `candidate_profiles`-per-user re-embed-on-every-save and Claude-ranking
  cost both scale with user count — worth a per-user cap before any public
  signup.
