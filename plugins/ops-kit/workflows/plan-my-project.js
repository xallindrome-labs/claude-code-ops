export const meta = {
  name: 'plan-my-project',
  description: 'Turn an idea into executable plan files: research fan-out, then a decision brief, then (after you decide) the plans',
  whenToUse: 'When you have a project idea and want it researched and planned before building. Run stage "research", answer the decisions with /grilling, then run stage "plans".',
  phases: [
    { title: 'Frame', detail: 'split the idea into research angles and open decisions' },
    { title: 'Research', detail: 'one cheap researcher per angle, in parallel' },
    { title: 'Brief', detail: 'one decision brief with recommended answers' },
    { title: 'Outline', detail: 'decide which plan files to write' },
    { title: 'Draft', detail: 'one writer per plan file' },
    { title: 'Critique', detail: 'a completeness critic checks the plans against your decisions' },
  ],
}

// A workflow cannot ask you questions while it runs, so this is two runs with a human step between them.
//
// Stage 1: args = { stage: 'research', idea: string, context?: string, constraints?: string[], angles?: number, models?: {research?: string} | null }
//   Returns a decision brief (markdown) listing every decision with options and a recommended answer.
//   Next: run the /grilling skill on that brief until you have answered every decision.
//
// Stage 2: args = { stage: 'plans', idea: string, brief: string, decisions: string, outDir: string, models?: {...} | null }
//   `decisions` is your confirmed answers (paste the outcome of the grilling). Writes plan files under outDir.
const stage = args?.stage
if (stage !== 'research' && stage !== 'plans') throw new Error('args.stage must be "research" or "plans"')
if (!args?.idea) throw new Error('args.idea is required')
const idea = args.idea
const models = args?.models === null ? {} : { research: 'sonnet', draft: 'sonnet', ...(args?.models ?? {}) }
const m = s => (models[s] ? { model: models[s] } : {})

// ---- cost lines: counts only. Agent counts show the size of a run; tokens and dollars are not estimated here. ----
const NAME = 'plan-my-project'
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

const FRAME = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    angles: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, question: { type: 'string' }, whereToLook: { type: 'string' } },
        required: ['name', 'question'],
      },
    },
    decisions: { type: 'array', items: { type: 'string' }, description: 'decisions the user will have to make' },
  },
  required: ['goal', 'angles', 'decisions'],
}

const FACTS = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          source: { type: 'string', description: 'URL or file path' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['fact', 'source', 'confidence'],
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
  required: ['angle', 'findings', 'unknowns'],
}

const BRIEF = { type: 'object', properties: { markdown: { type: 'string' }, decisionCount: { type: 'integer' } }, required: ['markdown'] }

if (stage === 'research') {
  const nAngles = Math.min(Math.max(args?.angles ?? 5, 2), 8)
  const size = nAngles + 2 // 1 frame + one researcher per angle + 1 brief
  log(planLine(size + ' agents (exact: 1 frame, ' + nAngles + ' researchers, 1 brief)', 'args.angles'))
  if (args?.dryRun === true) return { dryRun: true, plan: { stage, min: size, max: size } }
  phase('Frame')
  const frame = await run(
    `Project idea: ${idea}\n${args?.context ? `Context: ${args.context}\n` : ''}${args?.constraints?.length ? `Constraints: ${args.constraints.join('; ')}\n` : ''}\n` +
    `Break this into ${nAngles} research angles (for example: prior art and competitors, feasibility and cost, users and demand, legal/licensing or compliance, technical approach, risks) ` +
    'chosen to fit THIS idea. For each, give the question to answer and where to look (web, local files, docs). Also list the decisions the owner will have to make. ' +
    'You may read local files for context but do not edit anything.',
    { label: 'frame', phase: 'Frame', schema: FRAME })
  if (!frame) return { error: 'framing failed', receipt: receipt() }
  const angles = frame.angles.slice(0, nAngles)
  if (frame.angles.length > angles.length) log(`Framing proposed ${frame.angles.length} angles; researching the first ${angles.length}`)

  phase('Research')
  const facts = (await parallel(angles.map(a => () => run(
    `Research this angle for a project. Be factual and brief.\nProject: ${idea}\nAngle: ${a.name}\nQuestion: ${a.question}\nWhere to look: ${a.whereToLook ?? 'web and local files'}\n` +
    'Every fact needs a source (URL or file path) and an honest confidence. List what you could not find under unknowns. Never invent a source. Do not edit any files. Use WebSearch/WebFetch or read local files; do not use browser or computer-use tools, which are shared with the other researchers running at the same time.',
    { label: `research:${a.name}`, phase: 'Research', schema: FACTS, ...m('research') })))).filter(Boolean)
  if (facts.length < angles.length) log(`WARNING: ${angles.length - facts.length} research angle(s) failed and are missing from the brief`)

  phase('Brief')
  const brief = await run(
    `Write a decision brief for the owner of this project.\nProject: ${idea}\nGoal: ${frame.goal}\n` +
    `Decisions to settle: ${JSON.stringify(frame.decisions)}\nResearch (facts with sources):\n${JSON.stringify(facts, null, 1)}\n\n` +
    'Format: first a 3-line summary. Then a numbered list of decisions. For each: the question, the realistic options, your recommended answer worded so that "yes" accepts it, ' +
    'and the facts (with source) that support it. Group decisions so that later ones that depend on earlier ones come later. ' +
    'Finish with "Unknowns that research could not settle" and "Risks". Do not present low-confidence facts as settled.',
    { label: 'brief', phase: 'Brief', schema: BRIEF })
  log(doneLine(facts.length + ' research angle(s) answered.'))
  return {
    receipt: receipt(),
    stage: 'research',
    next: 'Run the /grilling skill on this brief, answer every decision, then run this workflow again with stage "plans".',
    brief: brief?.markdown ?? null,
    facts,
    unknowns: facts.flatMap(f => f.unknowns),
  }
}

// ---- stage: plans ----
if (!args.brief || !args.decisions || !args.outDir) throw new Error('stage "plans" needs args.brief, args.decisions and args.outDir')
const outDir = args.outDir
const OUTLINE = {
  type: 'object',
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string', description: 'file name like 01-core.md' }, title: { type: 'string' }, scope: { type: 'string' } },
        required: ['file', 'title', 'scope'],
      },
    },
  },
  required: ['plans'],
}
const WRITTEN = { type: 'object', properties: { file: { type: 'string' }, summary: { type: 'string' } }, required: ['file', 'summary'] }
const CRITIC = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } },
        required: ['file', 'problem', 'fix'],
      },
    },
  },
  required: ['gaps'],
}
const PLAN_FORMAT = 'Each plan file has: Goal; Decisions already made (copied from the owner\'s answers, never re-decided); Scope; Out of scope; ' +
  'Ordered steps small enough for one agent session each; Acceptance criteria that command output can prove; ONE verification command; ' +
  'Stop-points (push, deploy, send, submit, spend, delete, publish) with the expected handling; Open items that need the owner.'

// Size depends on how many plan files the outline chooses (usually 3-7), so only a floor is known.
log(planLine('at least 3 agents (1 outline, one writer per plan file, 1 critic, plus one repair per flagged file)', 'fewer or smaller plans in args.decisions'))
if (args?.dryRun === true) return { dryRun: true, plan: { stage, min: 3, max: null, note: 'usually 3-7 plan files' } }

phase('Outline')
const outline = await run(
  `Project: ${idea}\nDecision brief:\n${args.brief}\n\nThe owner's confirmed decisions:\n${args.decisions}\n\n` +
  `Decide which plan files to write (usually 3-7: an overview plus one per workstream, ordered by build sequence). Files go in ${outDir}. ` +
  'Each must be independently executable by a fresh agent session.',
  { label: 'outline', phase: 'Outline', schema: OUTLINE })
if (!outline?.plans?.length) return { error: 'outline failed', receipt: receipt() }

phase('Draft')
const drafted = (await parallel(outline.plans.map(p => () => run(
  `Write the plan file ${outDir}/${p.file}.\nProject: ${idea}\nPlan title: ${p.title}\nScope: ${p.scope}\n` +
  `Other plans in this set (do not duplicate their scope): ${outline.plans.map(x => x.file + ' - ' + x.title).join('; ')}\n` +
  `Owner's confirmed decisions (authoritative):\n${args.decisions}\n\nBackground brief:\n${args.brief}\n\n${PLAN_FORMAT}\n` +
  `Write ONLY the file ${outDir}/${p.file}. Do not modify or create anything else. Return the file path and a two-line summary.`,
  { label: `draft:${p.file}`, phase: 'Draft', schema: WRITTEN, ...m('draft') })))).filter(Boolean)
if (drafted.length < outline.plans.length) log(`WARNING: ${outline.plans.length - drafted.length} plan file(s) failed to draft`)

phase('Critique')
const critique = await run(
  `Read every plan file in ${outDir} that was just written (${drafted.map(d => d.file).join(', ')}) and check them against the owner's confirmed decisions:\n${args.decisions}\n\n` +
  'Report gaps: a plan that contradicts a decision, a decision no plan implements, a step too big for one session, an acceptance criterion no command can prove, a missing stop-point, two plans that overlap. ' +
  'Do not edit anything; only report.',
  { label: 'critic', phase: 'Critique', schema: CRITIC })

let repaired = []
if (critique?.gaps?.length) {
  log(`${critique.gaps.length} gap(s) found; repairing`)
  const files = [...new Set(critique.gaps.map(g => g.file))]
  repaired = (await parallel(files.map(file => () => run(
    `Fix these problems in ${file} (and only that file). Keep everything else as is.\n${JSON.stringify(critique.gaps.filter(g => g.file === file), null, 1)}`,
    { label: `repair:${file}`, phase: 'Critique', schema: WRITTEN, ...m('draft') })))).filter(Boolean)
}
log(doneLine(drafted.length + ' plan file(s) written, ' + repaired.length + ' repaired.'))
return { receipt: receipt(), stage: 'plans', outDir, written: drafted, gapsFound: critique?.gaps ?? [], repaired: repaired.map(r => r.file) }
