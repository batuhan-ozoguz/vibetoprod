// Detection semantics lock: next-themes must NOT read as Next.js, firebase
// implies auth+db+storage, env-key + hosting priority + sub-manifest scan work,
// and a hostile symlink cannot pull outside files into the analysis.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ruleset = JSON.parse(readFileSync(join(root, "rules/ruleset.json"), "utf8"));

function fixture(build) {
  const dir = mkdtempSync(join(tmpdir(), "v2p-test-"));
  build(dir);
  const out = detect(dir, ruleset);
  rmSync(dir, { recursive: true, force: true });
  return out;
}

test("semantics: exact deps, firebase stack, env keys, hosting priority, sub-manifests", () => {
  const out = fixture((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      dependencies: { "next-themes": "^0.3.0", vite: "^5.0.0", firebase: "^10.0.0", "@ai-sdk/groq": "^1.0.0" },
    }));
    writeFileSync(join(dir, ".env.example"), "ANTHROPIC_API_KEY=\nDB_URL=\n");
    mkdirSync(join(dir, "server"));
    writeFileSync(join(dir, "server", "package.json"), JSON.stringify({ dependencies: { express: "^4.19.0" } }));
  });
  const ids = out.signals_hit.map((s) => s.rule_id);
  assert(!ids.includes("hosting-nextjs"), "next-themes must not trigger the next rule");
  assert.strictEqual(out.hosting_primary, "hosting-vite");
  for (const n of ["auth", "database", "storage", "ai-api", "server"])
    assert(out.needs.includes(n), `missing need: ${n} (got ${out.needs})`);
});

test("hardening: symlinked env example outside the repo is not read", () => {
  const outside = mkdtempSync(join(tmpdir(), "v2p-outside-"));
  writeFileSync(join(outside, "secrets.env"), "OPENAI_API_KEY=sk-real\n");
  const out = fixture((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    symlinkSync(join(outside, "secrets.env"), join(dir, ".env.example"));
  });
  rmSync(outside, { recursive: true, force: true });
  assert.deepStrictEqual(out.needs, [], "symlink must be skipped, no ai-api signal");
});

test("clean static app produces no invented needs", () => {
  const out = fixture((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { vite: "^5.0.0" } }));
  });
  assert.deepStrictEqual(out.needs, ["hosting"]);
});
