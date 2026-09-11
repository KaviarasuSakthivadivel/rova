-- Runs once, automatically, on first container init (docker-entrypoint-initdb.d).
-- Drizzle migrations assume this extension already exists (jobs.embedding /
-- candidate_profiles.embedding are `vector` columns).
CREATE EXTENSION IF NOT EXISTS vector;
