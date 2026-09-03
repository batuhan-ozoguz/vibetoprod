#!/usr/bin/env node
// vibetoprod — from vibe to production.
// usage: vibetoprod <local-path | github-url | owner/repo> [--json] [--html <file>]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detect } from "../src/detect.mjs";
import { resolveTarget } from "../src/clone.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let target, json = false, htmlOut = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") json = true;
  else if (args[i] === "--html") htmlOut = args[++i];
  else if (args[i] === "--help" || args[i] === "-h") target = null;
  else if (!target) target = args[i];
}
if (!target) {
  console.log(`
  vibetoprod — repo in, production plan out.

  usage:
    vibetoprod <local-path | github-url | owner/repo>
    flags: --json           machine-readable output
           --html <file>    write the full plan report (diagram + costs)

  Analysis is read-only: your code is never executed.
  https://vibetoprod.dev
`);
  process.exit(target === null && args.length ? 0 : 2);
}

const ruleset = JSON.parse(readFileSync(join(root, "rules/ruleset.json"), "utf8"));

let resolved;
try {
  resolved = resolveTarget(target);
} catch (e) {
  console.error(`vibetoprod: ${e.message}`);
  process.exit(1);
}

let result;
try {
  result = detect(resolved.dir, ruleset);
} finally {
  resolved.cleanup();
}
result.repo = resolved.label;

if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (htmlOut) {
  console.error("vibetoprod: --html lands with the report renderer (T4); use --json for now");
  process.exit(1);
}

// human summary
const byId = Object.fromEntries(ruleset.rules.map((r) => [r.id, r]));
console.log(`\n  vibetoprod — production plan for ${resolved.label}\n`);
if (!result.signals_hit.length) {
  console.log("  no service needs detected — this looks like a static, client-only app.");
  console.log("  hosting on any static host (Cloudflare Pages, Vercel) should be enough.\n");
  process.exit(0);
}
const byNeed = {};
for (const s of result.signals_hit) {
  const r = byId[s.rule_id];
  (byNeed[r.implies] ??= []).push({ rule: r, evidence: s.evidence });
}
for (const [need, hits] of Object.entries(byNeed)) {
  const top = hits[0];
  console.log(`  ${need.padEnd(10)} → ${top.rule.platforms.recommended}`);
  for (const h of hits) console.log(`             · ${h.evidence}`);
}
console.log(`\n  ${result.signals_hit.length} signals, ${result.needs.length} needs. --json for details.\n`);
