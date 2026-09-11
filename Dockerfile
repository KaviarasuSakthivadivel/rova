# ---- Build stage: compile the single executable ----
FROM oven/bun:1 AS build
WORKDIR /app

# Separate lockfile install from the rest so dependency layers cache
# across builds that only change application code.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---- Runtime stage: just the compiled binary + what it reads from disk ----
# glibc-based (not Alpine) — the binary above is compiled for glibc by
# default; switching to a musl target is a future size optimization, not
# needed for a working image. ca-certificates is required for outbound
# HTTPS (ATS crawl targets, Anthropic/OpenAI APIs).
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The compiled binary embeds all JS/TS code and the bundled frontend
# (HTML/CSS/JS, via the static `import indexHtml from "@/web/index.html"`
# in src/server.ts) — no node_modules needed at runtime. It does NOT embed
# migrations/: drizzle's migrator reads that directory from the filesystem
# at runtime, not through the static import graph, so it has to ship
# alongside the binary, not inside it.
COPY --from=build /app/dist/rova ./rova
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/companies.seed.csv ./scripts/companies.seed.csv

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["./rova"]
CMD ["serve"]
