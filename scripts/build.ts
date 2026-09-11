#!/usr/bin/env bun
import tailwind from "bun-plugin-tailwind";

/**
 * `bunfig.toml`'s [serve.static] plugins only apply to Bun.serve()'s
 * lazy dev-server route bundling — `bun build --compile` (CLI) does NOT
 * read that config, so the Tailwind plugin has to be registered here via
 * the JS Bun.build() API instead, which supports `compile: true` as a
 * drop-in equivalent to the CLI flag.
 */
const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  // `compile.outfile` (not the top-level `outfile`) controls the compiled
  // binary's output path — the top-level one is silently ignored in
  // compile mode and Bun writes `./<entrypoint-basename>` instead.
  compile: { outfile: "./dist/rova" },
  plugins: [tailwind],
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log("built ./dist/rova");
