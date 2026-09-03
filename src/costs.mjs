// vibetoprod cost model: turn detected needs into per-platform monthly line
// items with published assumptions. Grouping is per platform, not per need —
// one Supabase subscription covers db+auth+storage, and must be billed once.
export function estimate(result, ruleset, pricing) {
  const byId = Object.fromEntries(ruleset.rules.map((r) => [r.id, r]));
  const groups = {}; // canonical -> { names:Set, needs:Set, evidence:[] }
  for (const s of result.signals_hit) {
    const rule = byId[s.rule_id];
    const rec = rule.platforms.recommended;
    const canonical = pricing.aliases[rec] ?? null;
    const key = canonical ?? `unknown:${rec}`;
    const g = (groups[key] ??= { canonical, names: new Set(), needs: new Set(), evidence: [] });
    g.names.add(rec);
    g.needs.add(rule.implies);
    g.evidence.push(s.evidence);
  }

  const items = [];
  for (const [key, g] of Object.entries(groups)) {
    const entry = g.canonical ? pricing.platforms[g.canonical] : null;
    items.push({
      platform: entry?.name ?? [...g.names][0],
      needs: [...g.needs].sort(),
      tiers: entry?.tiers ?? null,
      free_tier: entry?.free_tier ?? null,
      note: entry?.note ?? "pricing not verified — check the platform's site",
      source: entry?.source ?? null,
      evidence: [...new Set(g.evidence)],
    });
  }
  // priced items first, cheapest launch-tier first — the report reads top-down
  items.sort((a, b) => {
    if (!a.tiers !== !b.tiers) return a.tiers ? -1 : 1;
    return (a.tiers?.launch[1] ?? 0) - (b.tiers?.launch[1] ?? 0);
  });

  const totals = {};
  for (const tier of Object.keys(pricing.tiers)) {
    totals[tier] = items.reduce(
      ([lo, hi], it) => it.tiers ? [lo + it.tiers[tier][0], hi + it.tiers[tier][1]] : [lo, hi],
      [0, 0]
    );
  }

  return {
    as_of: pricing.as_of,
    disclaimer: pricing.disclaimer,
    tier_assumptions: pricing.tiers,
    items,
    totals,
    unpriced: items.filter((it) => !it.tiers).map((it) => it.platform),
  };
}
