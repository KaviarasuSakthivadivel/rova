-- Deferred until now (Phase 6) rather than added at initial schema time —
-- an index over an empty/unenriched table is pure overhead. See PLAN.md §4.

-- Full-text keyword search backing the deterministic ILIKE-less path if
-- it's ever swapped for to_tsvector matching, and available to ad-hoc
-- queries/admin tooling in the meantime.
CREATE INDEX IF NOT EXISTS idx_jobs_title_fts ON jobs USING GIN (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_jobs_description_fts ON jobs USING GIN (to_tsvector('english', coalesce(description, '')));

-- Approximate nearest-neighbor search for semantic matching (src/api/jobs.ts
-- `semantic=true`). ivfflat's recall depends on `lists` being tuned to
-- roughly sqrt(row count) — 100 is a reasonable starting point for the
-- thousands-of-jobs scale this MVP targets; revisit once real volume is
-- known (PLAN.md Phase 9 territory if this ever needs partitioning).
CREATE INDEX IF NOT EXISTS idx_jobs_embedding ON jobs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
