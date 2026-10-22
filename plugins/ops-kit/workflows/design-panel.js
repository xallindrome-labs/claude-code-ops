export const meta = {
  name: 'design-panel',
  description: 'Several independent designs for one question, scored by a judge panel, merged into one recommendation',
  whenToUse: 'When a design or strategy choice has a wide solution space and one attempt iterated would anchor on its first idea.',
  phases: [
    { title: 'Generate', detail: 'N independent proposals, each from a different angle' },
    { title: 'Judge', detail: 'three judges with different criteria score every proposal' },
    { title: 'Synthesize', detail: 'pick the winner, graft the best ideas from the others' },
  ],
}

// args: {
//   question: string                 what to design or decide (required)
//   constraints?: string[]           hard constraints (budget, stack, deadline, rules)
//   context?: string                 background; agents can also read local files
//   angles?: string[]                override the default angles (one proposal per angle)
//   cwd?: string                     directory agents may read for context
//   models?: { generate?: string, judge?: string } | null    synthesis always inherits the session model
// }
if (!args?.question) throw new Error('design-panel needs args.question')
const question = args.question
const constraints = args?.constraints ?? []
const models = args?.models === null ? {} : { generate: 'sonnet', judge: 'sonnet', ...(args?.models ?? {}) }
const m = s => (models[s] ? { model: models[s] } : {})

// ---- cost lines: counts only. Agent counts show the size of a run; tokens and dollars are not estimated here. ----
const NAME = 'design-panel'
let launched = 0
let failed = 0
const byPhase = {}
const run = async (prompt, opts) => {
  launched++
  const p = opts?.phase ?? 'other'
  byPhase[p] = (byPhase[p] ?? 0) + 1
  const r = await agent(prompt, opts)
  if (r === null || r === undefined) failed++
  return r
}
const receipt = () => ({ launched, failed, byPhase: { ...byPhase } })
const MODEL_NOTE = 'bulk stages use ' + (Object.values(models).filter(Boolean).length ? [...new Set(Object.values(models).filter(Boolean))].join('/') : 'the session model') + '; the final summary uses the session model'
const planLine = (size, knob) => 'PLAN ' + NAME + ': ' + size + '. ' + MODEL_NOTE + '. Smallest knob: ' + knob + '. Agent counts show size, not cost; tokens and dollars are not estimated here.'
const doneLine = extra => 'DONE ' + NAME + ': ' + launched + ' agents launched' + (failed ? ', ' + failed + ' returned nothing' : '') + '. ' + (extra ? extra + ' ' : '') + 'Tokens are not measured here; see your session usage.'

const DEFAULT_ANGLES = [
  'Simplest thing that could work: the smallest change that meets the constraints, even if it is not elegant.',
  'Risk-first: design around the thing most likely to go wrong or be irreversible, and make that safe.',
  'User-first: start from the person who lives with the result every day and work backwards.',
  'Long-term: assume this lives for years and will be changed by someone else; optimize for maintainability.',
  'Cheapest in money and time: minimise spend and effort, accept limits.',
]
const angles = args?.angles?.length ? args.angles : DEFAULT_ANGLES
if (angles.length < 2) throw new Error('need at least 2 angles')

// Size is exact: one designer per angle, 3 judges, 1 synthesis.
const PLAN_SIZE = angles.length + 4
log(planLine(PLAN_SIZE + ' agents (exact: ' + angles.length + ' designers, 3 judges, 1 synthesis)', 'args.angles (fewer angles = fewer designers)'))
if (args?.dryRun === true) return { dryRun: true, plan: { agents: PLAN_SIZE, min: PLAN_SIZE, max: PLAN_SIZE } }

const DESIGN = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    pros: { type: 'array', items: { type: 'string' } },
    cons: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    effort: { type: 'string', description: 'rough effort and cost, honestly hedged' },
  },
  required: ['name', 'summary', 'steps', 'pros', 'cons', 'risks', 'effort'],
}
const SCORES = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 10 }, why: { type: 'string' }, bestIdea: { type: 'string', description: 'the single idea in this proposal worth keeping even if it loses' } },
        required: ['name', 'score', 'why', 'bestIdea'],
      },
    },
  },
  required: ['scores'],
}
const DECISION = {
  type: 'object',
  properties: {
    recommendation: { type: 'string' },
    winner: { type: 'string' },
    grafted: { type: 'array', items: { type: 'string' }, description: 'ideas taken from runners-up, with which proposal each came from' },
    rejected: { type: 'array', items: { type: 'string' }, description: 'proposals not chosen and why' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    firstSteps: { type: 'array', items: { type: 'string' } },
    markdown: { type: 'string' },
  },
  required: ['recommendation', 'winner', 'grafted', 'rejected', 'openQuestions', 'firstSteps', 'markdown'],
}

const BASE = `Question: ${question}\n${constraints.length ? `Hard constraints: ${constraints.join('; ')}\n` : ''}${args?.context ? `Context: ${args.context}\n` : ''}` +
  `${args?.cwd ? `You may read files under ${args.cwd} for context. ` : ''}Do not edit anything.`

phase('Generate')
const designs = (await parallel(angles.map((angle, i) => () => run(
  `${BASE}\n\nYou are one of ${angles.length} independent designers. You cannot see the others. Your assigned angle:\n${angle}\n\n` +
  'Propose ONE concrete design that respects every hard constraint. Name it, summarize it, list ordered steps, honest pros, cons and risks, and a hedged effort estimate. ' +
  'Do not hedge your way into a design that does everything.',
  { label: `design:${i + 1}`, phase: 'Generate', schema: DESIGN, ...m('generate') })))).filter(Boolean)
if (designs.length < 2) return { error: 'fewer than 2 designs were produced', designs, receipt: receipt() }
if (designs.length < angles.length) log(`${angles.length - designs.length} designer(s) failed; judging ${designs.length}`)
// Names must be unique so scores line up with proposals.
const seen = new Set()
designs.forEach((d, i) => { if (seen.has(d.name)) d.name = `${d.name} (${i + 1})`; seen.add(d.name) })

phase('Judge')
const CRITERIA = [
  'FEASIBILITY: can this really be built or done with the stated constraints and in the stated time?',
  'RISK: how bad and how reversible are the failure modes? Penalize irreversible or hidden risk.',
  'FIT: how well does it serve the actual goal and the people affected, per unit of cost?',
]
// Barrier is genuine here: every judge must see every proposal.
const judged = (await parallel(CRITERIA.map(c => () => run(
  `${BASE}\n\nYou are a judge. Score each proposal from 1 to 10 on ONE criterion only.\nCriterion: ${c}\n\nProposals:\n${JSON.stringify(designs, null, 1)}\n\n` +
  'Score every proposal by its exact name. Use the full range; do not give everything the same score. For each, name the single best idea worth keeping.',
  { label: `judge:${c.split(':')[0].toLowerCase()}`, phase: 'Judge', schema: SCORES, ...m('judge') })))).filter(Boolean)
if (!judged.length) return { error: 'no judge answered', designs, receipt: receipt() }

const totals = designs.map(d => {
  const s = judged.flatMap(j => j.scores.filter(x => x.name === d.name))
  return { name: d.name, total: s.reduce((a, x) => a + x.score, 0), judges: s.length, scores: s }
}).sort((a, b) => b.total - a.total)

phase('Synthesize')
const decision = await run(
  `${BASE}\n\nProposals:\n${JSON.stringify(designs, null, 1)}\n\nJudge scores (sum across ${judged.length} judges, highest first):\n${JSON.stringify(totals, null, 1)}\n\n` +
  'Choose the recommendation. Start from the highest-scoring proposal, but you may pick another if the scores hide a real problem (say why). ' +
  'Graft the best ideas from runners-up where they fit the constraints, naming where each came from. Say what was rejected and why, the open questions, and the first three concrete steps. ' +
  'The markdown field is the full decision document.',
  { label: 'synthesize', phase: 'Synthesize', schema: DECISION })

log(doneLine())
return { decision, ranking: totals.map(t => ({ name: t.name, total: t.total, judges: t.judges })), designs, receipt: receipt() }
