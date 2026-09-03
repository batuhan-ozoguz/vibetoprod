#!/usr/bin/env node
// Pre-release corpus regression: run detection against every corpus repo at
// its pinned SHA and diff against docs/corpus-baseline.json.
// Manual tool — never runs in CI (33 live clones). Usage:
//   node scripts/corpus-check.mjs            # compare against baseline
//   node scripts/corpus-check.mjs --update   # rewrite the baseline
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(readFileSync(join(root, "docs/corpus.json"), "utf8"));
const ruleset = JSON.parse(readFileSync(join(root, "rules/ruleset.json"), "utf8"));
const baselinePath = join(root, "docs/corpus-baseline.json");
const update = process.argv.includes("--update");

const results = {};
for (const r of corpus.repos) {
  if (!r.pinned_sha) { console.error(`skip (no pin): ${r.full_name}`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "v2p-corpus-"));
  try {
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "-c", "core.symlinks=false", "fetch", "--depth", "1", "--no-tags", "-q",
      `https://github.com/${r.full_name}.git`, r.pinned_sha], { stdio: "pipe", timeout: 120_000 });
    execFileSync("git", ["-C", dir, "-c", "core.symlinks=false", "checkout", "-q", "FETCH_HEAD"], { stdio: "pipe" });
    const out = detect(dir, ruleset);
    results[r.full_name] = {
      needs: out.needs.sort(),
      rules: out.signals_hit.map((s) => s.rule_id).sort(),
      hosting: out.hosting_primary,
    };
    console.error(`ok: ${r.full_name} → ${out.needs.join(",") || "(none)"}`);
  } catch (e) {
    console.error(`FETCH FAILED: ${r.full_name}: ${String(e.message).slice(0, 80)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (update || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({ pinned: corpus.pinned, results }, null, 2) + "\n");
  console.error(`baseline written: ${baselinePath} (${Object.keys(results).length} repos)`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).results;
let diffs = 0;
for (const [repo, now] of Object.entries(results)) {
  const was = baseline[repo];
  if (!was) { console.log(`NEW: ${repo}`); diffs++; continue; }
  if (JSON.stringify(was) !== JSON.stringify(now)) {
    console.log(`DIFF: ${repo}\n  was: ${JSON.stringify(was)}\n  now: ${JSON.stringify(now)}`);
    diffs++;
  }
}
console.log(diffs ? `${diffs} regressions/diffs` : "corpus regression clean");
process.exit(diffs ? 1 : 0);
