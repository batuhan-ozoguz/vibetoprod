#!/usr/bin/env node
// vibetoprod web demo: paste a GitHub repo, get the plan. Framework-less.
// Design constraints: tiny abuse surface (strict repo pattern, per-IP rate
// limit, bounded queue, hard timeout), result pages cached and shareable.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detect } from "../src/detect.mjs";
import { resolveTarget } from "../src/clone.mjs";
import { estimate } from "../src/costs.mjs";
import { report, esc } from "../src/report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ruleset = JSON.parse(readFileSync(join(root, "rules/ruleset.json"), "utf8"));
const pricing = JSON.parse(readFileSync(join(root, "costs/pricing.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const PORT = Number(process.env.PORT ?? 8080);
const REPO = /^[\w.-]{1,80}\/[\w.-]{1,100}$/;
const ANALYZE_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const RATE_LIMIT = 6; // analyses per IP per hour
const MAX_CONCURRENT = 2;

// --- tiny infra: cache, rate limit, queue --------------------------------
const cache = new Map(); // repo -> {html, at}
const hits = new Map();  // ip -> {n, at}
let running = 0;
const waiting = [];

function rateOk(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60 * 60 * 1000) { hits.set(ip, { n: 1, at: now }); return true; }
  if (h.n >= RATE_LIMIT) return false;
  h.n++; return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k);
  for (const [k, v] of hits) if (now - v.at > 2 * 60 * 60 * 1000) hits.delete(k);
}, 10 * 60 * 1000).unref();

function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++;
      try { resolve(await fn()); } catch (e) { reject(e); }
      finally { running--; waiting.shift()?.(); }
    };
    if (running < MAX_CONCURRENT) run(); else waiting.push(run);
  });
}

function analyze(repo) {
  return withSlot(() => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("analysis timed out")), ANALYZE_TIMEOUT_MS);
    try {
      const t = resolveTarget(repo);
      try {
        const result = detect(t.dir, ruleset);
        const costs = estimate(result, ruleset, pricing);
        resolve(report({
          repoLabel: t.label, result, costs,
          generatedAt: new Date().toISOString().slice(0, 10), version: pkg.version,
        }));
      } finally { t.cleanup(); }
    } catch (e) { reject(e); } finally { clearTimeout(timer); }
  }));
}

// --- pages ----------------------------------------------------------------
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:title" content="vibetoprod — repo in, production plan out">
<meta property="og:description" content="The services your vibe-coded app needs, what they cost per month, and the diagram — before you deploy anything.">
<meta property="og:image" content="https://vibetoprod.dev/social-preview.png">
<style>
  :root { --bg:#f6f8f4; --surface:#fff; --ink:#1c282c; --soft:#54666b; --line:#dbe2db; --accent:#0e6b5b }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e1517; --surface:#152023; --ink:#e3e9e5; --soft:#94a5a1; --line:#253539; --accent:#4bab91 } }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--ink); line-height:1.6; min-height:100vh;
         font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
         display:flex; align-items:center; justify-content:center; padding:24px }
  .card { max-width:600px; width:100% }
  .brand { color:var(--accent); font-weight:800; letter-spacing:.05em; font-size:1rem }
  h1 { font-size:2.1rem; line-height:1.15; margin:10px 0 12px; text-wrap:balance }
  h1 em { color:var(--accent); font-style:normal }
  p { color:var(--soft); margin-bottom:20px }
  form { display:flex; gap:10px; flex-wrap:wrap }
  input { flex:1; min-width:240px; font:inherit; padding:12px 14px; border-radius:10px;
          border:1px solid var(--line); background:var(--surface); color:var(--ink) }
  button { font:inherit; font-weight:600; padding:12px 22px; border-radius:10px; border:0;
           background:var(--accent); color:#fff; cursor:pointer }
  .hint { font-size:.85rem; margin-top:14px }
  .hint a { color:var(--accent) }
  .cli { margin-top:26px; background:var(--surface); border:1px solid var(--line);
         border-radius:10px; padding:12px 16px; font-family:ui-monospace,Menlo,monospace;
         font-size:.9rem; overflow-x:auto }
  .err { background:var(--surface); border:1px solid var(--line); border-left:3px solid #9e3826;
         border-radius:10px; padding:14px 18px; margin-bottom:18px }
  footer { margin-top:30px; font-size:.8rem; color:var(--soft) }
  footer a { color:var(--accent) }
</style></head><body><div class="card">${body}</div></body></html>`;

const home = (err = "") => page("vibetoprod", `
  <div class="brand">vibetoprod</div>
  <h1>Repo in. <em>Production plan</em> out.</h1>
  <p>The services your vibe-coded app needs, what they cost per month, and one
  clean architecture diagram — read-only, your code is never executed.</p>
  ${err ? `<div class="err">${esc(err)}</div>` : ""}
  <form action="/plan" method="get">
    <input name="repo" placeholder="owner/repo — e.g. vercel/next-learn" required
           pattern="[\\w.-]+/[\\w.-]+" autofocus>
    <button>Get my plan</button>
  </form>
  <div class="hint">Public GitHub repos only · ~30 seconds ·
    <a href="/plan?repo=ata360brasil/v0-ata-360-chatbot-ui">see an example plan</a></div>
  <div class="cli">$ npx vibetoprod your/repo &nbsp;# same thing, in your terminal — private repos too</div>
  <footer>Open source (MIT) — <a href="https://github.com/batuhan-ozoguz/vibetoprod" rel="noopener">github.com/batuhan-ozoguz/vibetoprod</a></footer>
`);

// --- server ---------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?")
    .toString().split(",")[0].trim();
  const send = (code, body, type = "text/html; charset=utf-8") => {
    res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff" });
    res.end(body);
  };

  if (url.pathname === "/healthz") return send(200, "ok", "text/plain");
  if (url.pathname === "/") return send(200, home());

  if (url.pathname === "/plan") {
    let repo = (url.searchParams.get("repo") ?? "").trim()
      .replace(/^https:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    if (!REPO.test(repo)) return send(400, home("That doesn't look like owner/repo. Try e.g. vercel/next-learn."));
    repo = repo.toLowerCase();

    const hit = cache.get(repo);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return send(200, hit.html);
    if (!rateOk(ip)) return send(429, home("Rate limit: 6 analyses per hour per IP. The CLI has no limits: npx vibetoprod your/repo"));

    try {
      const html = await analyze(repo);
      cache.set(repo, { html, at: Date.now() });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      console.log(`${new Date().toISOString()} ${ip} ok ${repo}`);
      return send(200, html);
    } catch (e) {
      console.log(`${new Date().toISOString()} ${ip} fail ${repo}: ${e.message}`);
      const msg = /clone failed/.test(e.message)
        ? "Couldn't clone that repo — is it public and spelled right?"
        : /timed out/.test(e.message)
          ? "Analysis timed out (repo too large for the web demo). Try the CLI: npx vibetoprod your/repo"
          : "Analysis failed. Try the CLI: npx vibetoprod your/repo";
      return send(422, home(msg));
    }
  }

  return send(404, home());
});

server.listen(PORT, () => console.log(`vibetoprod web on :${PORT}`));
