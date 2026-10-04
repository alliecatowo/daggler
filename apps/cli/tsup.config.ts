import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: [/@daggler\//, "picocolors", "yaml"],
  clean: true,
  define: { __DAGGLER_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire } from 'node:module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});
