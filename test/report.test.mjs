// Report safety lock: repo-derived strings are escaped, and the page loads
// nothing from the network — no remote scripts, stylesheets, images or fonts.
import { test } from "node:test";
import assert from "node:assert";
import { report, esc } from "../src/report.mjs";

const hostile = {
  repoLabel: 'evil/repo"><script>alert(1)</script>',
  result: { signals_hit: [{ rule_id: "x", evidence: "package.json: <img src=x onerror=alert(1)>" }], needs: ["hosting"] },
  costs: {
    as_of: "2026-09", disclaimer: "d <b>x</b>",
    tier_assumptions: { hobby: "h", launch: "l", growing: "g" },
    items: [{
      platform: "Vercel<script>", needs: ["hosting"],
      tiers: { hobby: [0, 0], launch: [0, 20], growing: [20, 40] },
      free_tier: "free \"tier\"", note: "note'", source: "https://vercel.com/pricing",
      evidence: ["package.json: <img src=x onerror=alert(1)>"],
    }],
    totals: { hobby: [0, 0], launch: [0, 20], growing: [20, 40] },
    unpriced: [],
  },
  generatedAt: "2026-09-03",
  version: "0.1.0",
};

test("repo-derived strings are escaped", () => {
  const html = report(hostile);
  assert(!html.includes("<script>alert"), "script tag must be escaped");
  assert(!html.includes("<img src=x"), "img injection must be escaped");
  assert(html.includes("&lt;script&gt;"), "escaped form must be present");
});

test("zero outbound requests", () => {
  const html = report(hostile);
  assert(!/<script[^>]+src=/.test(html), "no remote scripts");
  assert(!/<link\s/.test(html), "no external stylesheets/fonts");
  assert(!/url\(https?:/.test(html), "no remote css resources");
  assert(!/<img\s/.test(html), "no images at all");
  assert(html.includes("<svg"), "diagram must be inline svg");
});

test("empty result renders the static-app message", () => {
  const html = report({ ...hostile, result: { signals_hit: [], needs: [] },
    costs: { ...hostile.costs, items: [], totals: { hobby: [0, 0], launch: [0, 0], growing: [0, 0] }, unpriced: [] } });
  assert(html.includes("static, client-only app"));
});

test("esc covers the html special set", () => {
  assert.strictEqual(esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});
