// bun-types (node_modules/bun-types/extensions.d.ts) declares ambient module
// types for .html/.txt/.toml/etc. asset imports, but not .svg — this covers
// `import path from "*.svg" with { type: "file" }` (src/server.ts's favicon
// route), which resolves to the file's on-disk/embedded path as a string.
declare module "*.svg" {
  var path: string;
  export = path;
}
