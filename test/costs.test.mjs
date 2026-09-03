// Cost model lock: platform grouping (Supabase billed once for db+auth+storage),
// totals arithmetic, assumptions present, unpriced platforms flagged not priced.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estimate } from "../src/costs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ruleset = JSON.parse(readFileSync(join(root, "rules/ruleset.json"), "utf8"));
const pricing = JSON.parse(readFileSync(join(root, "costs/pricing.json"), "utf8"));

const detectResult = {
  signals_hit: [
    { rule_id: "hosting-nextjs", evidence: "package.json: next" },
    { rule_id: "supabase-db", evidence: "package.json: @supabase/supabase-js" },
    { rule_id: "supabase-auth", evidence: "package.json: @supabase/supabase-js" },
    { rule_id: "supabase-storage", evidence: "package.json: @supabase/supabase-js" },
    { rule_id: "ai-env-anthropic", evidence: "env example declares ANTHROPIC_API_KEY" },
    { rule_id: "payments-env-stripe", evidence: "env example declares STRIPE_SECRET_KEY" },
  ],
};

test("groups per platform, prices once, sums totals", () => {
  const out = estimate(detectResult, ruleset, pricing);
  const supabase = out.items.filter((i) => i.platform === "Supabase");
  assert.strictEqual(supabase.length, 1, "Supabase must be one line item");
  assert.deepStrictEqual(supabase[0].needs, ["auth", "database", "storage"]);

  const launchMax = out.items.reduce((s, i) => s + (i.tiers?.launch[1] ?? 0), 0);
  assert.deepStrictEqual(out.totals.launch[1], launchMax, "totals must equal item sum");
  assert(out.totals.hobby[0] === 0, "hobby floor should be 0 for this stack");
  assert(out.totals.launch[1] >= 25 + 20 + 30, "launch ceiling covers Supabase+Vercel+AI");

  assert(out.as_of && out.disclaimer && out.tier_assumptions.launch, "assumptions must ship");
  for (const it of out.items) assert(it.note, `item ${it.platform} missing note`);
  assert.deepStrictEqual(out.unpriced, [], "this stack is fully priced");
});

test("unknown platform degrades to unpriced, never invents numbers", () => {
  const rulesetPlus = { rules: [...ruleset.rules, {
    id: "x-unknown", signal: { type: "dependency", match: ["x"] }, implies: "search",
    platforms: { recommended: "SomeNewSaaS", alternatives: [], aws_equivalent: "-" },
    confidence: "high", source: "test",
  }] };
  const out = estimate(
    { signals_hit: [{ rule_id: "x-unknown", evidence: "package.json: x" }] },
    rulesetPlus, pricing
  );
  assert.strictEqual(out.items[0].tiers, null);
  assert.deepStrictEqual(out.unpriced, ["SomeNewSaaS"]);
  assert.deepStrictEqual(out.totals.launch, [0, 0]);
});
