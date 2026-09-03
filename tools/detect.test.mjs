#!/usr/bin/env node
// Smallest check that fails if detection semantics regress:
// next-themes must NOT read as Next.js, firebase must imply auth+db+storage,
// env-key + hosting priority must work.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert";

const here = dirname(new URL(import.meta.url).pathname);
const repo = mkdtempSync(join(tmpdir(), "v2p-test-"));
writeFileSync(join(repo, "package.json"), JSON.stringify({
  dependencies: { "next-themes": "^0.3.0", vite: "^5.0.0", firebase: "^10.0.0", "@ai-sdk/groq": "^1.0.0" },
}));
writeFileSync(join(repo, ".env.example"), "ANTHROPIC_API_KEY=\nDB_URL=\n");
mkdirSync(join(repo, "server"));
writeFileSync(join(repo, "server", "package.json"), JSON.stringify({ dependencies: { express: "^4.19.0" } }));

const out = JSON.parse(execFileSync("node", [join(here, "detect.mjs"), repo], { encoding: "utf8" }));
rmSync(repo, { recursive: true, force: true });

const ids = out.signals_hit.map((s) => s.rule_id);
assert(!ids.includes("hosting-nextjs"), "next-themes must not trigger the next rule");
assert.strictEqual(out.hosting_primary, "hosting-vite", "vite should be primary hosting");
for (const n of ["auth", "database", "storage", "ai-api", "server"])
  assert(out.needs.includes(n), `missing need: ${n} (got ${out.needs})`);
console.log("ok — detect.mjs semantics hold:", out.needs.sort().join(", "));
