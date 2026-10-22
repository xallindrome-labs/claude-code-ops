// Generates one SVG flow diagram per workflow into diagrams/. Run: node scripts/gen-diagrams.mjs
// Dependency-free. Colours adapt to light and dark mode through prefers-color-scheme.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'diagrams');
fs.mkdirSync(OUT, { recursive: true });

// kind: 'agent' (a model call), 'cheap' (runs on a cheaper model), 'human' (you), 'result'
const FLOWS = {
  'release-readiness': {
    title: 'release-readiness',
    subtitle: 'Is this repo safe to make public? Read-only; it never pushes or publishes.',
    columns: [
      { title: 'Scan', note: '6 checks in parallel', boxes: [['Secrets', 'cheap'], ['Hygiene (paths, emails, names)', 'cheap'], ['License + dependencies', 'cheap'], ['README + SECURITY + CONTRIBUTING', 'cheap'], ['Pack + clean install', 'cheap'], ['Weight + junk files', 'cheap']] },
      { title: 'Verify', note: 'one skeptic per finding', boxes: [['Re-run the check, try to refute it', 'cheap']] },
      { title: 'Verdict', note: 'top model', boxes: [['READY / NOT READY', 'result'], ['Blockers, warnings, what did not run', 'agent']] },
    ],
  },
  'review-changes': {
    title: 'review-changes',
    subtitle: 'Code review where every finding must survive three skeptics.',
    columns: [
      { title: 'Scope', note: 'find the diff + intent', boxes: [['What changed and why', 'cheap']] },
      { title: 'Review', note: '6 dimensions in parallel', boxes: [['Correctness', 'cheap'], ['Security', 'cheap'], ['Error handling', 'cheap'], ['Tests', 'cheap'], ['Performance', 'cheap'], ['Maintainability', 'cheap']] },
      { title: 'Verify', note: '3 skeptics per finding', boxes: [['Reproduce it', 'cheap'], ['Is it already guarded?', 'cheap'], ['Is the severity honest?', 'cheap']] },
      { title: 'Report', note: 'majority must fail to refute', boxes: [['Ranked, verified findings', 'result']] },
    ],
  },
  'plan-my-project': {
    title: 'plan-my-project',
    subtitle: 'Idea to executable plan files, with you deciding in the middle.',
    columns: [
      { title: 'Frame', note: 'stage 1: research', boxes: [['Angles + open decisions', 'agent']] },
      { title: 'Research', note: 'one per angle', boxes: [['Prior art', 'cheap'], ['Feasibility + cost', 'cheap'], ['Users + demand', 'cheap'], ['Risks + rules', 'cheap']] },
      { title: 'Brief', note: 'decisions with recommendations', boxes: [['Decision brief', 'result']] },
      { title: 'You', note: 'the human step', boxes: [['/grilling: answer every decision', 'human']] },
      { title: 'Outline', note: 'stage 2: plans', boxes: [['Which plan files', 'agent']] },
      { title: 'Draft', note: 'one writer per plan', boxes: [['Plan 1', 'cheap'], ['Plan 2', 'cheap'], ['Plan N', 'cheap']] },
      { title: 'Critique', note: 'gaps are repaired', boxes: [['Check plans against your decisions', 'agent'], ['Repair flagged files', 'cheap']] },
    ],
  },
  'leak-finder': {
    title: 'leak-finder',
    subtitle: 'Where does a small business lose leads and time? Public pages only, evidence for every claim.',
    columns: [
      { title: 'Inspect', note: 'per site, 6 areas in parallel', boxes: [['Lead capture', 'cheap'], ['Booking path', 'cheap'], ['Follow-up', 'cheap'], ['Reputation', 'cheap'], ['Manual work', 'cheap'], ['Basics', 'cheap']] },
      { title: 'Verify', note: 'merge, then check the top few', boxes: [['Merge duplicate leaks', 'cheap'], ['Re-open the page for the top 8; does it still hold?', 'cheap']] },
      { title: 'Report', note: 'per site', boxes: [['Top 3 leaks', 'result'], ['Quick wins', 'agent'], ['Questions for the diagnostic call', 'agent']] },
    ],
  },
  'design-panel': {
    title: 'design-panel',
    subtitle: 'Several independent designs, scored by judges, merged into one recommendation.',
    columns: [
      { title: 'Generate', note: 'independent, 5 angles', boxes: [['Simplest thing', 'cheap'], ['Risk-first', 'cheap'], ['User-first', 'cheap'], ['Long-term', 'cheap'], ['Cheapest', 'cheap']] },
      { title: 'Judge', note: 'every judge sees every design', boxes: [['Feasibility', 'cheap'], ['Risk', 'cheap'], ['Fit', 'cheap']] },
      { title: 'Synthesize', note: 'top model', boxes: [['Winner + best ideas from the rest', 'result'], ['Rejected, open questions, first steps', 'agent']] },
    ],
  },
};

const BW = 176, BH = 42, GAP_Y = 10, COLW = 214, PAD = 24, HEAD = 74, GROUP_PAD = 10;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const wrap = (s, n) => {
  const words = s.split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
};

for (const [name, f] of Object.entries(FLOWS)) {
  const colH = c => c.boxes.length * BH + (c.boxes.length - 1) * GAP_Y + 2 * GROUP_PAD;
  const maxH = Math.max(...f.columns.map(colH));
  const W = PAD * 2 + f.columns.length * COLW - (COLW - BW - 2 * GROUP_PAD);
  const H = HEAD + 34 + maxH + PAD + 22;
  let body = '';
  f.columns.forEach((c, i) => {
    const x = PAD + i * COLW;
    const h = colH(c);
    const top = HEAD + 34 + (maxH - h) / 2;
    body += `<text class="ct" x="${x}" y="${HEAD + 8}">${esc(c.title)}</text><text class="cn" x="${x}" y="${HEAD + 25}">${esc(c.note)}</text>`;
    body += `<rect class="grp" x="${x}" y="${top}" width="${BW + 2 * GROUP_PAD}" height="${h}" rx="10"/>`;
    c.boxes.forEach(([label, kind], j) => {
      const by = top + GROUP_PAD + j * (BH + GAP_Y);
      const lines = wrap(label, 24);
      body += `<rect class="b ${kind}" x="${x + GROUP_PAD}" y="${by}" width="${BW}" height="${BH}" rx="7"/>`;
      lines.slice(0, 2).forEach((ln, k) => {
        const ty = by + BH / 2 + (lines.length > 1 ? (k === 0 ? -4 : 11) : 5);
        body += `<text class="bt" x="${x + GROUP_PAD + BW / 2}" y="${ty}" text-anchor="middle">${esc(ln)}</text>`;
      });
    });
    if (i < f.columns.length - 1) {
      const ax = x + BW + 2 * GROUP_PAD + 4, ay = HEAD + 34 + maxH / 2;
      body += `<path class="arrow" d="M${ax} ${ay} h${COLW - BW - 2 * GROUP_PAD - 12}"/><path class="head" d="M${ax + COLW - BW - 2 * GROUP_PAD - 12} ${ay - 4} l6 4 l-6 4z"/>`;
    }
  });
  const legendY = H - 14;
  const legend = [['cheap', 'cheaper model (Sonnet)'], ['agent', 'session model'], ['result', 'output'], ['human', 'you']];
  let lx = PAD;
  let legendSvg = '';
  for (const [k, t] of legend) { legendSvg += `<rect class="b ${k}" x="${lx}" y="${legendY - 9}" width="12" height="12" rx="3"/><text class="cn" x="${lx + 18}" y="${legendY + 1}">${t}</text>`; lx += 18 + t.length * 6.6 + 18; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(f.title)} workflow diagram">
<title>${esc(f.title)}</title>
<style>
:root{--bg:#ffffff;--fg:#1f2328;--mut:#59636e;--grp:#f3f5f8;--line:#c3cad3;--cheap:#dbeafe;--cheapL:#93b4e6;--agent:#ede9fe;--agentL:#b3a3ef;--result:#dcfce7;--resultL:#86d19e;--human:#ffedd5;--humanL:#f0b27a}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e6e8eb;--mut:#9aa4af;--grp:#171a21;--line:#3a414c;--cheap:#1c2b46;--cheapL:#3f6aa8;--agent:#2a2347;--agentL:#6a58b5;--result:#16341f;--resultL:#3f8b58;--human:#3d2a14;--humanL:#b97a3a}}
text{font:13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;fill:var(--fg)}
.t{font-weight:700;font-size:18px}.sub{fill:var(--mut);font-size:13px}.ct{font-weight:700;font-size:14px}.cn{fill:var(--mut);font-size:12px}.bt{font-size:12.5px}
.grp{fill:var(--grp);stroke:var(--line)}.b{stroke-width:1.2}
.b.cheap{fill:var(--cheap);stroke:var(--cheapL)}.b.agent{fill:var(--agent);stroke:var(--agentL)}.b.result{fill:var(--result);stroke:var(--resultL)}.b.human{fill:var(--human);stroke:var(--humanL)}
.arrow{stroke:var(--mut);stroke-width:1.6;fill:none}.head{fill:var(--mut)}
</style>
<rect width="${W}" height="${H}" rx="10" fill="var(--bg)"/>
<text class="t" x="${PAD}" y="30">${esc(f.title)}</text><text class="sub" x="${PAD}" y="50">${esc(f.subtitle)}</text>
${body}
${legendSvg}
</svg>`;
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  console.log(`${name}.svg ${W}x${H}`);
}
