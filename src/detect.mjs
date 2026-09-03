// vibetoprod detection engine: apply a ruleset to a repo checkout.
// Pure read-only analysis — repo content is never executed.
import { readdirSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { join, basename, relative } from "node:path";

const MAX_FILE_BYTES = 200 * 1024; // hostile-repo cap: never read more than this per file

function readCapped(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const size = Math.min(fstatSync(fd).size, MAX_FILE_BYTES);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const ENV_EXAMPLE = /^\.env\..*(example|sample|template)$|^\.env\.(example|sample|template)$/;
const SRC_DIRS = ["src", "app", "lib", "server", "api", "supabase", "functions"];

export function detect(repoDir, ruleset) {
  const rules = ruleset.rules;

  // file tree — symlinks skipped so a hostile repo cannot point us outside the checkout
  const files = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) files.push(relative(repoDir, full));
    }
  })(repoDir);

  // every package.json in the tree — vibe-coded repos hide backends in server//backend/
  const deps = {}; // name -> manifest path (first seen)
  for (const f of files.filter((f) => basename(f) === "package.json")) {
    try {
      const j = JSON.parse(readCapped(join(repoDir, f)));
      for (const name of Object.keys({ ...j.dependencies, ...j.devDependencies }))
        deps[name] ??= f;
    } catch {}
  }

  // env var NAMES from example env files (never real .env — names matter, values don't)
  const envKeys = new Set();
  for (const f of files.filter((f) => ENV_EXAMPLE.test(basename(f)))) {
    for (const line of readCapped(join(repoDir, f)).split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/);
      if (m) envKeys.add(m[1]);
    }
  }

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

  const codeFiles = files.filter(
    (f) => CODE_EXT.test(f) && SRC_DIRS.includes(f.split("/")[0])
  );

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
      if (files.includes(file)) {
        try {
          const j = JSON.parse(readCapped(join(repoDir, file)));
          if (key in j) signals.push({ rule_id: rule.id, evidence: `${file} has "${key}"` });
        } catch {}
      }
    } else if (type === "code-pattern") {
      const re = new RegExp(patterns[0]);
      const hit = codeFiles.find((f) => re.test(readCapped(join(repoDir, f))));
      if (hit) signals.push({ rule_id: rule.id, evidence: hit });
    }
  }

  // hosting exclusivity: one primary recommendation, rest demoted to secondary
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
  const hostingHits = signals.filter((s) => byId[s.rule_id].implies === "hosting");
  hostingHits.sort((a, b) => (byId[b.rule_id].priority ?? 5) - (byId[a.rule_id].priority ?? 5));
  const hostingPrimary = hostingHits[0]?.rule_id ?? null;

  const kept = signals.filter(
    (s) => byId[s.rule_id].implies !== "hosting" || s.rule_id === hostingPrimary
  );
  return {
    signals_hit: kept,
    needs: [...new Set(kept.map((s) => byId[s.rule_id].implies))],
    hosting_primary: hostingPrimary,
    secondary_hosting: hostingHits.slice(1).map((s) => s.rule_id),
  };
}
