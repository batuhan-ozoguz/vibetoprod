#!/usr/bin/env node
// vibetoprod detector: apply rules/ruleset.json to one repo checkout.
// usage: node tools/detect.mjs <repo-dir> [ruleset.json]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, relative, dirname } from "node:path";

const repoDir = process.argv[2];
const rulesetPath =
  process.argv[3] ?? join(dirname(new URL(import.meta.url).pathname), "../rules/ruleset.json");
if (!repoDir) {
  console.error("usage: node tools/detect.mjs <repo-dir> [ruleset.json]");
  process.exit(2);
}
const ruleset = JSON.parse(readFileSync(rulesetPath, "utf8"));
const rules = ruleset.rules;

// --- gather repo facts ------------------------------------------------------
const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(relative(repoDir, full));
  }
})(repoDir);

// every package.json in the tree — vibe-coded repos hide backends in server//backend/
const deps = {}; // name -> manifest path (first seen)
for (const f of files.filter((f) => basename(f) === "package.json")) {
  try {
    const j = JSON.parse(readFileSync(join(repoDir, f), "utf8"));
    for (const name of Object.keys({ ...j.dependencies, ...j.devDependencies }))
      deps[name] ??= f;
  } catch {}
}

// env var NAMES from example env files (never real .env — values don't matter, names do)
const envKeys = new Set();
const envExample = /^\.env\..*(example|sample|template)$|^\.env\.(example|sample|template)$/;
for (const f of files.filter((f) => envExample.test(basename(f)))) {
  for (const line of readFileSync(join(repoDir, f), "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/);
    if (m) envKeys.add(m[1]);
  }
}

// --- rule matching ----------------------------------------------------------
// dependency match is EXACT package name; a pattern ending in "/" matches a
// scoped-package prefix ("@ai-sdk/"). Spike lesson: prefix matching made
// next-themes light up the next rule — never loosen this again.
function depMatch(patterns) {
  const hits = [];
  for (const name of Object.keys(deps))
    for (const p of patterns)
      if (name === p || (p.endsWith("/") && name.startsWith(p)))
        hits.push(`${deps[name]}: ${name}`);
  return hits;
}

const srcDirs = ["src", "app", "lib", "server", "api", "supabase", "functions"]
  .map((d) => join(repoDir, d))
  .filter(existsSync);

const signals = [];
for (const rule of rules) {
  const { type, match } = rule.signal;
  const patterns = Array.isArray(match) ? match : [match];
  if (type === "dependency") {
    const hits = depMatch(patterns);
    if (hits.length) signals.push({ rule_id: rule.id, evidence: hits.join(", ") });
  } else if (type === "file") {
    const hit = files.find((f) => patterns.includes(f) || patterns.includes(basename(f)));
    if (hit) signals.push({ rule_id: rule.id, evidence: hit });
  } else if (type === "env-key") {
    const hit = patterns.find((k) => envKeys.has(k));
    if (hit) signals.push({ rule_id: rule.id, evidence: `env example declares ${hit}` });
  } else if (type === "config-key") {
    const [file, key] = String(patterns[0]).split(":").map((s) => s.trim());
    const p = join(repoDir, file);
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (key in j) signals.push({ rule_id: rule.id, evidence: `${file} has "${key}"` });
      } catch {}
    }
  } else if (type === "code-pattern") {
    if (!srcDirs.length) continue;
    try {
      const out = execFileSync(
        "grep", ["-rlE", "--include=*.{js,jsx,ts,tsx,mjs,cjs}", patterns[0], ...srcDirs],
        { encoding: "utf8" }
      );
      const hit = out.split("\n").find(Boolean);
      if (hit) signals.push({ rule_id: rule.id, evidence: relative(repoDir, hit) });
    } catch {} // grep exits 1 on no match
  }
}

// hosting exclusivity: one primary recommendation, rest demoted to secondary
const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
const hostingHits = signals.filter((s) => byId[s.rule_id].implies === "hosting");
hostingHits.sort((a, b) => (byId[b.rule_id].priority ?? 5) - (byId[a.rule_id].priority ?? 5));
const hostingPrimary = hostingHits[0]?.rule_id ?? null;
const secondaryHosting = hostingHits.slice(1).map((s) => s.rule_id);

const kept = signals.filter(
  (s) => byId[s.rule_id].implies !== "hosting" || s.rule_id === hostingPrimary
);
const needs = [...new Set(kept.map((s) => byId[s.rule_id].implies))];

console.log(JSON.stringify(
  { repo: basename(repoDir), signals_hit: kept, needs,
    hosting_primary: hostingPrimary, secondary_hosting: secondaryHosting }, null, 2
));
