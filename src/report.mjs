// vibetoprod HTML report: one self-contained page — plan, hub-spoke SVG
// diagram, cost table. No CDN, no fonts, no outbound requests of any kind.
// Every repo-derived string passes esc() on the way in.

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const CAT = {
  hosting: "#3771b8", server: "#5561c9", database: "#2e8b6a", auth: "#b07f24",
  storage: "#8961b8", cache: "#c07138", queue: "#c07138", email: "#b8547a",
  "ai-api": "#2a8f9c", payments: "#4a9147", "web3-rpc": "#7a55c9",
  realtime: "#c25580", search: "#7d9134", cron: "#6b7a85", analytics: "#6b7a85",
};

function diagram(repoLabel, items) {
  const short = repoLabel.split("/").pop() || repoLabel;
  const hubLabel = short.length > 22 ? short.slice(0, 21) + "…" : short;
  const spokes = items.map((it) => ({
    label: it.platform,
    needs: it.needs.join(" · "),
    color: CAT[it.needs[0]] ?? "#6b7a85",
  }));
  const W = 900, H = Math.max(360, 150 + spokes.length * 40);
  const cx = W / 2, cy = H / 2, rx = 320, ry = H / 2 - 60;
  const nodeW = 190, nodeH = 52, hubW = 200, hubH = 64;

  let svg = "";
  const pos = spokes.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(spokes.length, 1);
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  // edges under nodes
  for (const p of pos) svg += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" class="edge"/>`;
  // hub
  svg += `<g><rect x="${cx - hubW / 2}" y="${cy - hubH / 2}" width="${hubW}" height="${hubH}" rx="10" class="hub"/>`
    + `<text x="${cx}" y="${cy - 6}" class="hub-name">${esc(hubLabel)}</text>`
    + `<text x="${cx}" y="${cy + 16}" class="hub-sub">your app</text></g>`;
  // spoke nodes
  spokes.forEach((s, i) => {
    const { x, y } = pos[i];
    svg += `<g><rect x="${x - nodeW / 2}" y="${y - nodeH / 2}" width="${nodeW}" height="${nodeH}" rx="8" class="node" style="stroke:${s.color}"/>`
      + `<text x="${x}" y="${y - 4}" class="node-name">${esc(s.label)}</text>`
      + `<text x="${x}" y="${y + 15}" class="node-needs" style="fill:${s.color}">${esc(s.needs)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="architecture plan diagram">${svg}</svg>`;
}

const usd = ([lo, hi]) => (lo === hi ? `$${lo}` : `$${lo}–${hi}`);

export function report({ repoLabel, result, costs, generatedAt, version }) {
  const items = costs.items;
  const rows = items.map((it) => `
    <tr>
      <td><strong>${esc(it.platform)}</strong><div class="needs">${it.needs.map(esc).join(" · ")}</div></td>
      <td>${it.tiers ? usd(it.tiers.hobby) : "—"}</td>
      <td>${it.tiers ? usd(it.tiers.launch) : "—"}</td>
      <td>${it.tiers ? usd(it.tiers.growing) : "<em>not priced</em>"}</td>
      <td class="note">${esc(it.note)}${it.free_tier ? `<div class="free">free tier: ${esc(it.free_tier)}</div>` : ""}</td>
    </tr>`).join("");

  const totals = Object.entries(costs.totals).map(([tier, range]) =>
    `<tr class="total"><td>total · ${esc(tier)}<div class="needs">${esc(costs.tier_assumptions[tier])}</div></td>` +
    (tier === "hobby" ? `<td>${usd(range)}</td><td></td><td></td>` :
     tier === "launch" ? `<td></td><td>${usd(range)}</td><td></td>` :
     `<td></td><td></td><td>${usd(range)}</td>`) + `<td></td></tr>`).join("");

  const evidence = items.map((it) => `
    <div class="ev"><strong>${esc(it.platform)}</strong>
      <ul>${it.evidence.map((e) => `<li><code>${esc(e)}</code></li>`).join("")}</ul>
      ${it.source ? `<a href="${esc(it.source)}" rel="noopener">pricing source</a>` : ""}
    </div>`).join("");

  const empty = !result.signals_hit.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(repoLabel)} — production plan</title>
<style>
  :root {
    --bg:#f6f8f4; --surface:#ffffff; --ink:#1c282c; --soft:#54666b;
    --line:#dbe2db; --accent:#0e6b5b;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e1517; --surface:#152023; --ink:#e3e9e5; --soft:#94a5a1;
            --line:#253539; --accent:#4bab91; }
  }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--ink); line-height:1.6;
         font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:960px; margin:0 auto; padding:40px 20px 64px }
  .brand { color:var(--accent); font-weight:700; letter-spacing:.04em; font-size:.85rem;
           text-transform:uppercase }
  h1 { font-size:1.9rem; line-height:1.2; margin:6px 0 4px; overflow-wrap:anywhere }
  .meta { color:var(--soft); font-size:.9rem }
  .trust { margin-top:8px; font-size:.85rem; color:var(--accent) }
  section { margin-top:36px }
  h2 { font-size:1.15rem; margin-bottom:12px }
  svg { width:100%; height:auto; background:var(--surface); border:1px solid var(--line);
        border-radius:12px }
  .edge { stroke:var(--line); stroke-width:1.5 }
  .hub { fill:var(--accent); }
  .hub-name { fill:#fff; font-weight:700; font-size:15px; text-anchor:middle }
  .hub-sub { fill:#ffffffb0; font-size:11px; text-anchor:middle; letter-spacing:.08em }
  .node { fill:var(--surface); stroke-width:1.6 }
  .node-name { fill:var(--ink); font-weight:600; font-size:13px; text-anchor:middle }
  .node-needs { font-size:11px; text-anchor:middle; letter-spacing:.03em }
  .tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius:12px;
               background:var(--surface) }
  table { border-collapse:collapse; width:100%; min-width:640px; font-size:.9rem }
  th,td { text-align:left; padding:10px 14px; border-top:1px solid var(--line);
          vertical-align:top }
  thead th { border-top:0; font-size:.72rem; text-transform:uppercase;
             letter-spacing:.08em; color:var(--soft) }
  td { font-variant-numeric:tabular-nums }
  .needs { font-size:.78rem; color:var(--soft) }
  .note { font-size:.82rem; color:var(--soft); min-width:220px }
  .free { margin-top:2px; color:var(--accent) }
  .total td { font-weight:700; background:color-mix(in srgb, var(--accent) 6%, var(--surface)) }
  .ev { background:var(--surface); border:1px solid var(--line); border-radius:10px;
        padding:12px 16px; margin-bottom:10px; font-size:.88rem }
  .ev ul { margin:4px 0 6px 20px }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em;
         overflow-wrap:anywhere }
  a { color:var(--accent) }
  .empty { background:var(--surface); border:1px solid var(--line); border-radius:12px;
           padding:24px; }
  footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--line);
           font-size:.8rem; color:var(--soft) }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">vibetoprod</div>
    <h1>${esc(repoLabel)}</h1>
    <div class="meta">production plan · generated ${esc(generatedAt)} · vibetoprod ${esc(version)}</div>
    <div class="trust">read-only analysis — your code was never executed</div>
  </header>

  ${empty ? `<section><div class="empty">No service needs detected — this looks like a static, client-only app.
  Hosting on any static host (Cloudflare Pages, Vercel) should be enough, usually at $0/month.</div></section>` : `
  <section>
    <h2>What your app needs</h2>
    ${diagram(repoLabel, items)}
  </section>

  <section>
    <h2>What it costs per month</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Platform</th><th>Hobby</th><th>Launch</th><th>Growing</th><th>Notes</th></tr></thead>
        <tbody>${rows}${totals}</tbody>
      </table>
    </div>
    <p class="meta" style="margin-top:8px">prices verified ${esc(costs.as_of)} · ${esc(costs.disclaimer)}</p>
  </section>

  <section>
    <h2>Why — the evidence</h2>
    ${evidence}
  </section>`}

  <footer>
    Generated by <a href="https://github.com/batuhan-ozoguz/vibetoprod" rel="noopener">vibetoprod</a> —
    repo in, production plan out. Recommendations are a starting point, not gospel;
    the evidence above shows exactly why each one fired.
  </footer>
</div>
</body>
</html>`;
}
