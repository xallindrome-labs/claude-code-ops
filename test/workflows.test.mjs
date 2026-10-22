// Tests the workflow scripts' orchestration logic with stubbed agents (no model calls, no tokens).
// It checks: meta is a pure literal and matches the file name, phase titles match, forbidden
// globals are absent, required args are enforced, and each script runs end to end against
// schema-shaped fake agent results, including when some agents fail (return null).
// Run: node --test test/workflows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'ops-kit', 'workflows');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ---- load + static checks ----

function load(name) {
  const src = fs.readFileSync(path.join(DIR, `${name}.js`), 'utf8');
  assert.ok(src.startsWith('export const meta = {'), `${name}: first statement must be "export const meta = {"`);
  // Find the end of the meta literal by brace matching (strings in meta contain no braces).
  let depth = 0, end = -1;
  for (let i = src.indexOf('{'); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const literal = src.slice(src.indexOf('{'), end);
  assert.ok(!/[`$]|\bfunction\b|=>/.test(literal), `${name}: meta must be a pure literal`);
  const meta = new Function(`return (${literal})`)();
  const body = src.slice(end).replace(/^\s*\n/, '');
  return { src, meta, body };
}

const NAMES = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();

test('all five workflows are present', () => {
  assert.deepEqual(NAMES, ['design-panel', 'leak-finder', 'plan-my-project', 'release-readiness', 'review-changes']);
});

for (const name of NAMES) {
  test(`${name}: static checks`, () => {
    const { src, meta, body } = load(name);
    assert.equal(meta.name, name, 'meta.name must equal the file name');
    assert.ok(meta.description && meta.description.length < 160);
    assert.ok(Array.isArray(meta.phases) && meta.phases.length >= 2);
    assert.ok(!/Date\.now|Math\.random|new Date\(\)/.test(body), 'Date.now/Math.random/new Date() break resume');
    assert.ok(!/\bimport\s*\(|^import /m.test(body), 'imports are not allowed');
    // phase titles used in the script must exist in meta.phases
    const titles = new Set(meta.phases.map(p => p.title));
    for (const [, t] of body.matchAll(/phase\('([^']+)'\)/g)) assert.ok(titles.has(t), `phase('${t}') missing from meta.phases`);
    for (const [, t] of body.matchAll(/phase:\s*'([^']+)'/g)) assert.ok(titles.has(t), `opts.phase '${t}' missing from meta.phases`);
    for (const t of titles) assert.ok(src.includes(`'${t}'`), `meta phase '${t}' is never used`);
    // must parse as an async function body
    new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', body);
  });
}

// ---- stub runtime ----

function fromSchema(schema, ctx = {}, key = '') {
  if (!schema) return null;
  if (schema.enum) return schema.enum[ctx.enumIndex?.[key] ?? 0];
  switch (schema.type) {
    case 'string': return ctx.strings?.[key] ?? `${key || 'text'}`;
    case 'integer': case 'number': return schema.minimum ?? 1;
    case 'boolean': return ctx.bools?.[key] ?? false;
    case 'array': return Array.from({ length: ctx.arrayLen?.[key] ?? 1 }, () => fromSchema(schema.items, ctx, key));
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = fromSchema(v, ctx, k);
      return out;
    }
    default: return null;
  }
}

function runtime({ ctx = {}, failLabels = [], overrides = {} } = {}) {
  const calls = [];
  const logs = [];
  const phases = [];
  const agent = async (prompt, opts = {}) => {
    assert.equal(typeof prompt, 'string');
    const label = opts.label ?? '';
    calls.push({ label, opts, prompt });
    if (failLabels.some(f => label.startsWith(f))) return null;
    for (const [prefix, fn] of Object.entries(overrides)) if (label.startsWith(prefix)) return fn(opts, prompt);
    return opts.schema ? fromSchema(opts.schema, ctx) : 'text';
  };
  const parallel = async thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)));
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let prev = item;
    try { for (const s of stages) prev = await s(prev, item, i); return prev; } catch { return null; }
  }));
  return {
    calls, logs, phases,
    globals: {
      agent, parallel, pipeline,
      phase: t => phases.push(t), log: m => logs.push(m),
      budget: { total: null, spent: () => 0, remaining: () => Infinity },
      workflow: async () => { throw new Error('not stubbed'); },
    },
  };
}

async function run(name, args, opts) {
  const { body } = load(name);
  const rt = runtime(opts);
  const g = rt.globals;
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', body);
  const result = await fn(g.agent, g.parallel, g.pipeline, g.phase, g.log, args, g.budget, g.workflow);
  return { result, ...rt };
}
const rejects = (name, args) => assert.rejects(() => run(name, args), /needs|required|must/);

// ---- release-readiness ----

test('release-readiness: requires args.repo', () => rejects('release-readiness', {}));

test('release-readiness: NOT READY path runs scan, verify, verdict', async () => {
  const { result, calls } = await run('release-readiness', { repo: '/tmp/r', forbidden: ['acme'], license: 'MIT' }, {
    ctx: { enumIndex: { verdict: 1 }, bools: { ran: true, real: true } },
  });
  assert.equal(calls.filter(c => c.label.startsWith('scan:')).length, 6);
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 6); // default severity "blocker"
  assert.equal(calls.at(-1).label, 'verdict');
  assert.equal(result.verdict, 'NOT READY');
  assert.ok(calls.every(c => /READ-ONLY|Write the release-readiness report/.test(c.prompt)), 'every agent is told to be read-only or only writes the report');
  assert.ok(calls.find(c => c.label === 'scan:hygiene').prompt.includes('"acme"'), 'forbidden terms reach the hygiene scan');
});

test('release-readiness: refuted findings are dropped and survive agent failures', async () => {
  const { result, logs } = await run('release-readiness', { repo: '/tmp/r' }, {
    ctx: { bools: { ran: true, real: false } },
    failLabels: ['scan:docs'],
  });
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.refuted.length > 0);
  assert.ok(logs.some(l => /failed/.test(l)), 'a failed scan agent is logged, not silent');
});

// ---- review-changes ----

const reviewCtx = { arrayLen: { files: 2 }, strings: { howToSeeTheChange: 'git diff' } };

test('review-changes: findings survive when skeptics cannot refute', async () => {
  const { result, calls } = await run('review-changes', { target: 'branch:x' }, { ctx: { ...reviewCtx, bools: { refuted: false } } });
  assert.equal(calls.filter(c => c.label.startsWith('review:')).length, 6);
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 18); // 6 dimensions x 1 finding x 3 skeptics
  assert.equal(result.survivors.length, 6);
  assert.equal(result.refutedCount, 0);
});

test('review-changes: findings die when skeptics refute', async () => {
  const { result } = await run('review-changes', { dimensions: ['security', 'tests'] }, { ctx: { ...reviewCtx, bools: { refuted: true } } });
  assert.equal(result.survivors.length, 0);
  assert.equal(result.refutedCount, 2);
});

test('review-changes: majority rule with 1 of 3 refuting survives, 2 of 3 does not', async () => {
  let n = 0;
  const a = await run('review-changes', { dimensions: ['security'] }, {
    ctx: reviewCtx,
    overrides: { 'verify:': (opts) => fromSchema(opts.schema, { bools: { refuted: ++n === 1 } }) },
  });
  assert.equal(a.result.survivors.length, 1);
  n = 0;
  const b = await run('review-changes', { dimensions: ['security'] }, {
    ctx: reviewCtx,
    overrides: { 'verify:': (opts) => fromSchema(opts.schema, { bools: { refuted: ++n <= 2 } }) },
  });
  assert.equal(b.result.survivors.length, 0);
});

test('review-changes: logs findings beyond the cap instead of dropping silently', async () => {
  const { logs } = await run('review-changes', { dimensions: ['security'], maxPerDimension: 1 }, {
    ctx: { ...reviewCtx, arrayLen: { files: 2, findings: 3 } },
  });
  assert.ok(logs.some(l => /not verified/.test(l)));
});

test('review-changes: no change found returns an error object', async () => {
  const { result } = await run('review-changes', {}, { ctx: { arrayLen: { files: 0 } } });
  assert.match(result.error, /No change found/);
});

// ---- plan-my-project ----

test('plan-my-project: validates stage and args', async () => {
  await rejects('plan-my-project', {});
  await rejects('plan-my-project', { stage: 'research' });
  await rejects('plan-my-project', { stage: 'plans', idea: 'x' });
});

test('plan-my-project: research stage fans out and returns a brief', async () => {
  const { result, calls } = await run('plan-my-project', { stage: 'research', idea: 'a thing', angles: 4 }, {
    ctx: { arrayLen: { angles: 6 }, strings: { markdown: '# brief' } },
  });
  assert.equal(calls.filter(c => c.label.startsWith('research:')).length, 4, 'capped at args.angles');
  assert.equal(result.brief, '# brief');
  assert.match(result.next, /grilling/);
  assert.ok(calls.every(c => !/write the plan file/i.test(c.prompt)), 'research stage writes no plan files');
});

test('plan-my-project: plans stage drafts, critiques and repairs only flagged files', async () => {
  const { result, calls } = await run('plan-my-project', { stage: 'plans', idea: 'x', brief: 'b', decisions: 'd', outDir: '/tmp/plans' }, {
    ctx: { arrayLen: { plans: 3, gaps: 1 }, strings: { file: '01-a.md' } },
  });
  assert.equal(calls.filter(c => c.label.startsWith('draft:')).length, 3);
  assert.equal(calls.filter(c => c.label.startsWith('repair:')).length, 1);
  assert.deepEqual(result.repaired, ['01-a.md']);
  assert.ok(calls.filter(c => c.label.startsWith('draft:')).every(c => c.prompt.includes('Write ONLY the file /tmp/plans/')));
});

// ---- leak-finder ----

test('leak-finder: requires sites', () => rejects('leak-finder', {}));

test('leak-finder: inspects every area per site, verifies medium/high, reports per site', async () => {
  const sites = [{ name: 'A', url: 'https://a.example' }, { name: 'B', url: 'https://b.example' }];
  const { result, calls } = await run('leak-finder', { sites }, { ctx: { bools: { holdsUp: true } } });
  assert.equal(calls.filter(c => c.label.startsWith('inspect:')).length, 12);
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 12); // default impact "high"
  assert.equal(calls.filter(c => c.label.startsWith('report:')).length, 2);
  assert.equal(result.sites.length, 2);
  assert.ok(calls.filter(c => c.label.startsWith('inspect:')).every(c => /Never log in, never submit/.test(c.prompt)), 'safety rules in every inspector prompt');
});

test('leak-finder: leaks that do not hold up are excluded from the report input', async () => {
  const { result, calls } = await run('leak-finder', { sites: [{ name: 'A', url: 'https://a.example' }], areas: ['lead-capture'] }, { ctx: { bools: { holdsUp: false } } });
  assert.equal(result.sites[0].confirmed.length, 0);
  assert.equal(result.sites[0].refuted.length, 1);
  assert.ok(calls.at(-1).prompt.includes('Refuted on re-check (do not report)'));
});

// ---- design-panel ----

test('design-panel: requires a question', () => rejects('design-panel', {}));

test('design-panel: generates, judges at a barrier, ranks unique names, synthesizes', async () => {
  const { result, calls } = await run('design-panel', { question: 'how?', constraints: ['cheap'] });
  assert.equal(calls.filter(c => c.label.startsWith('design:')).length, 5);
  assert.equal(calls.filter(c => c.label.startsWith('judge:')).length, 3);
  assert.equal(calls.at(-1).label, 'synthesize');
  assert.equal(new Set(result.ranking.map(r => r.name)).size, 5, 'duplicate design names are made unique');
  assert.ok(calls.filter(c => c.label.startsWith('judge:')).every(c => c.prompt.includes('Proposals:')));
});

test('design-panel: stops cleanly when too few designs are produced', async () => {
  const { result } = await run('design-panel', { question: 'q' }, { failLabels: ['design:2', 'design:3', 'design:4', 'design:5'] });
  assert.match(result.error, /fewer than 2/);
});

// ---- cost lines, dry runs and receipts ----

const DRY_ARGS = {
  'release-readiness': { repo: '/tmp/r' },
  'review-changes': { dimensions: ['security', 'tests'], maxPerDimension: 2 },
  'plan-my-project': { stage: 'research', idea: 'x', angles: 3 },
  'leak-finder': { sites: [{ name: 'A', url: 'https://a.example' }], verifyCap: 4 },
  'design-panel': { question: 'q' },
};
const FULL_ARGS = {
  'release-readiness': { repo: '/tmp/r' },
  'review-changes': { dimensions: ['security', 'tests'], maxPerDimension: 2 },
  'plan-my-project': { stage: 'research', idea: 'x', angles: 3 },
  'leak-finder': { sites: [{ name: 'A', url: 'https://a.example' }], verifyCap: 4 },
  'design-panel': { question: 'q' },
};
const FULL_CTX = { arrayLen: { files: 1, angles: 3 }, bools: { holdsUp: true, ran: true, real: true } };

for (const name of Object.keys(DRY_ARGS)) {
  test(`${name}: only the counting wrapper calls agent()`, () => {
    const { body } = load(name);
    const code = body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.equal((code.match(/\bagent\(/g) ?? []).length, 1, 'exactly one agent( call: the wrapper');
  });

  test(`${name}: dryRun logs PLAN first and spawns no agents`, async () => {
    const { result, calls, logs } = await run(name, { ...DRY_ARGS[name], dryRun: true });
    assert.equal(calls.length, 0, 'no agent calls in a dry run');
    assert.equal(result.dryRun, true);
    assert.match(logs[0], new RegExp(`^PLAN ${name}:`));
    assert.match(logs[0], /not estimated/);
    assert.ok(!/\$\s?\d|\d\s?(k|M)?\s?tokens/i.test(logs[0]), 'PLAN must not contain token or dollar figures');
  });

  test(`${name}: real run logs PLAN first, DONE last, and the receipt matches the agents launched`, async () => {
    const { result, calls, logs } = await run(name, FULL_ARGS[name], { ctx: { ...FULL_CTX, strings: { howToSeeTheChange: 'git diff' } } });
    assert.match(logs[0], new RegExp(`^PLAN ${name}:`));
    assert.match(logs.at(-1), new RegExp(`^DONE ${name}: ${calls.length} agents launched`));
    assert.equal(result.receipt.launched, calls.length);
    assert.ok(!/\$\s?\d|\d\s?(k|M)?\s?tokens/i.test(logs.at(-1)), 'DONE must not contain token or dollar figures');
  });
}

test('plan floor and ceiling are consistent with what actually runs', async () => {
  const dry = await run('review-changes', { dimensions: ['security', 'tests'], maxPerDimension: 2, dryRun: true });
  const full = await run('review-changes', { dimensions: ['security', 'tests'], maxPerDimension: 2 }, { ctx: { ...FULL_CTX, arrayLen: { files: 1, findings: 5 }, strings: { howToSeeTheChange: 'git diff' } } });
  assert.ok(full.calls.length >= dry.result.plan.min && full.calls.length <= dry.result.plan.max, `${full.calls.length} not in ${dry.result.plan.min}..${dry.result.plan.max}`);
  const dp = await run('design-panel', { question: 'q', dryRun: true });
  const dpFull = await run('design-panel', { question: 'q' });
  assert.equal(dpFull.calls.length, dp.result.plan.agents, 'design-panel size is exact');
});

// ---- leak-finder: browser rule, dedupe, verify cap ----

test('leak-finder: inspectors and verifiers are told not to use shared browser tools', async () => {
  const { calls } = await run('leak-finder', FULL_ARGS['leak-finder'], { ctx: FULL_CTX });
  const web = calls.filter(c => /^(inspect|verify):/.test(c.label));
  assert.ok(web.length > 0 && web.every(c => /never use browser or computer-use tools/.test(c.prompt)));
});

test('plan-my-project: researchers are told not to use shared browser tools', async () => {
  const { calls } = await run('plan-my-project', FULL_ARGS['plan-my-project'], { ctx: FULL_CTX });
  const r = calls.filter(c => c.label.startsWith('research:'));
  assert.ok(r.length > 0 && r.every(c => /do not use browser or computer-use tools/.test(c.prompt)));
});

test('leak-finder: duplicate leaks are merged before verification', async () => {
  // 6 areas each report 1 leak; the dedupe agent says leaks 0-3 are one problem.
  const { result, calls, logs } = await run('leak-finder', { sites: [{ name: 'A', url: 'https://a.example' }] }, {
    ctx: { bools: { holdsUp: true } },
    overrides: {
      // each inspector reports under its own area name, so the merged leak can list all of them
      'inspect:': opts => ({ ...fromSchema(opts.schema, {}), area: opts.label.split(':')[2] }),
      'dedupe:': () => ({ groups: [{ members: [0, 1, 2, 3] }] }),
    },
  });
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 3, '1 merged + 2 unique leaks verified, not 6');
  assert.ok(logs.some(l => /6 observations merged into 3 distinct leaks/.test(l)));
  assert.equal(result.sites[0].distinct, 3);
  assert.equal(result.sites[0].confirmed[0].areas.length, 4, 'the merged leak remembers every area that reported it');
});

test('leak-finder: a bad dedupe answer is ignored, not trusted', async () => {
  const { result } = await run('leak-finder', { sites: [{ name: 'A', url: 'https://a.example' }] }, {
    ctx: { bools: { holdsUp: true } },
    overrides: { 'dedupe:': () => ({ groups: [{ members: [99, -1, 1.5] }] }) },
  });
  assert.equal(result.sites[0].distinct, 6, 'out-of-range or non-integer indexes merge nothing');
});

test('leak-finder: verifyCap limits re-checks and the rest is reported as not re-checked', async () => {
  const { result, calls, logs } = await run('leak-finder', { sites: [{ name: 'A', url: 'https://a.example' }], verifyCap: 2 }, { ctx: { bools: { holdsUp: true } } });
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 2);
  assert.equal(result.sites[0].notRechecked.length, 4);
  assert.ok(logs.some(l => /4 leak\(s\) not re-checked/.test(l)));
  assert.match(calls.find(c => c.label.startsWith('report:')).prompt, /NOT re-checked/);
});

test('leak-finder: verifier corrections reach the report prompt', async () => {
  const { calls } = await run('leak-finder', { sites: [{ name: 'A', url: 'https://a.example' }], areas: ['lead-capture'] }, {
    ctx: { bools: { holdsUp: true } },
    overrides: { 'verify:': (opts) => ({ holdsUp: true, reason: 'ok', correction: 'THE CORRECTED WORDING' }) },
  });
  assert.ok(calls.find(c => c.label.startsWith('report:')).prompt.includes('THE CORRECTED WORDING'));
});
