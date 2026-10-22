export const meta = {
  name: 'release-readiness',
  description: 'Check that a repo is safe to publish: secrets, hygiene, license, docs, packaging, clean install',
  whenToUse: 'Before making a repository public or publishing a package. Read-only: it never pushes, publishes or edits the repo.',
  phases: [
    { title: 'Scan', detail: 'six independent checks run in parallel' },
    { title: 'Verify', detail: 'a skeptic re-checks each blocking or warning finding' },
    { title: 'Verdict', detail: 'one report: READY or NOT READY, with blockers' },
  ],
}

// args: {
//   repo: string                 absolute path of the repository (required)
//   forbidden?: string[]         words that must not appear (employer, client names, internal hostnames)
//   license?: string             expected SPDX id, e.g. "MIT"
//   models?: { scan?: string, verify?: string } | null   model aliases per stage; null = inherit everywhere
// }
const repo = args?.repo
if (!repo) throw new Error('release-readiness needs args.repo (absolute path of the repository)')
const forbidden = args?.forbidden ?? []
const license = args?.license ?? null
const models = args?.models === null ? {} : { scan: 'sonnet', verify: 'sonnet', ...(args?.models ?? {}) }
const m = stage => (models[stage] ? { model: models[stage] } : {})

// ---- cost lines: counts only. Agent counts show the size of a run; tokens and dollars are not estimated here. ----
const NAME = 'release-readiness'
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

const RULES = `Hard rules: you are READ-ONLY on the repository at ${repo}. Do not edit, commit, push, publish or delete anything there.
Only write inside a fresh temp directory you create yourself, and say so. Report facts you observed with the command and its output;
if a tool is missing or a check could not run, say "not run" and why. Never invent results.`

const FINDINGS = {
  type: 'object',
  properties: {
    check: { type: 'string' },
    ran: { type: 'boolean', description: 'false if the check could not be run at all' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'warning', 'info'] },
          title: { type: 'string' },
          where: { type: 'string', description: 'file:line, or the command that showed it' },
          evidence: { type: 'string', description: 'exact output or quoted text, redact any secret value' },
          fix: { type: 'string' },
        },
        required: ['severity', 'title', 'where', 'evidence'],
      },
    },
  },
  required: ['check', 'ran', 'summary', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'true if the finding is real and still true after re-checking' },
    reason: { type: 'string' },
  },
  required: ['real', 'reason'],
}

const REPORT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['READY', 'NOT READY'] },
    blockers: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    passed: { type: 'array', items: { type: 'string' } },
    notRun: { type: 'array', items: { type: 'string' } },
    markdown: { type: 'string', description: 'the full human-readable report' },
  },
  required: ['verdict', 'blockers', 'warnings', 'passed', 'notRun', 'markdown'],
}

const CHECKS = [
  {
    key: 'secrets',
    prompt: `Secret scan of the repository at ${repo}, working tree AND full git history.
Prefer gitleaks (\`gitleaks dir\` and \`gitleaks git\`) or trufflehog if installed. If neither is installed, say so and fall back to
git grep / git log -p searches for private keys, tokens (ghp_, sk-, AKIA, xox, JWTs), .env files, and password/secret assignments.
Also list any file that was ever committed and deleted that looks like a credential (git log --diff-filter=D). Redact secret values in your output.
Anything real is a blocker. A fallback regex scan is weaker than gitleaks: mention that in the summary.`,
  },
  {
    key: 'hygiene',
    prompt: `Hygiene scan of ${repo} (tracked files, plus .git history for commit author emails).
Find: absolute personal paths (a Windows user-profile folder, /Users/<name>, /home/<name>), personal or work email addresses, internal hostnames and URLs,
private IP addresses, TODOs naming people, and commit author emails that should not be public.
${forbidden.length ? `Also search case-insensitively for these forbidden terms and report each hit: ${forbidden.map(t => JSON.stringify(t)).join(', ')}.` : 'No forbidden terms were supplied.'}
Paths and emails in code are warnings; forbidden terms and personal emails in git history are blockers.`,
  },
  {
    key: 'license',
    prompt: `License audit of ${repo}.
Check: a LICENSE file exists${license ? ` and is ${license}` : ''}; the package manifest (package.json / pyproject.toml / Cargo.toml / etc.) declares the same license and an author;
list direct dependencies and their licenses (npm ls / pip show / cargo metadata, whatever applies) and flag anything incompatible with the repo license (for example GPL/AGPL inside a permissive project);
list bundled third-party assets (fonts, images, audio, models, vendored code) and whether each has attribution or a license note.
Missing LICENSE or an incompatible dependency is a blocker; missing asset attribution is a warning.`,
  },
  {
    key: 'docs',
    prompt: `Documentation check of ${repo}.
Check the README has: a one-line statement of what it does, a quickstart whose commands you can actually trace to real files/scripts, a license mention, and a way to report problems.
Also check for SECURITY.md and CONTRIBUTING.md. Verify every relative link and image in the README points to a file that exists.
Flag claims in the README the code does not support (platforms, features, versions). A broken quickstart is a blocker; the rest are warnings.`,
  },
  {
    key: 'packaging',
    prompt: `Packaging and clean-install check of ${repo}.
Detect the ecosystem (npm, PyPI, cargo, etc.). Build the distributable the way the project says to (npm pack / python -m build / cargo package), list exactly which files go into it,
then install it into a brand-new empty temp directory with an empty package cache and run the documented entry point or a --version/--help call (for an MCP server, start it and send an initialize request over stdio).
Flag files that should not ship (tests fixtures with secrets, .env, local configs) and files that should ship but don't (the LICENSE, the bin).
Failure to install or run from the built artifact is a blocker. If the project is not a package, say so and mark ran=false.`,
  },
  {
    key: 'weight',
    prompt: `Repository weight and junk check of ${repo}.
List tracked files over 1 MB, committed build output or dependency folders (node_modules, dist, __pycache__), editor or OS junk, large binaries, and anything in .gitignore that is nevertheless tracked.
Check .gitignore exists and covers the obvious. Large binaries and committed dependencies are warnings unless they contain private data.`,
  },
]

// Floor is 7: 6 scans + 1 report. One verifier is added per blocker or warning, so the top is not known in advance.
log(planLine('at least 7 agents (6 scans + 1 report, plus one verifier per blocker or warning)', 'args.models = null (inherit one model) or fewer findings to verify by fixing them first'))
if (args?.dryRun === true) return { dryRun: true, plan: { min: 7, max: null, note: 'plus one verifier per blocker or warning' } }

phase('Scan')
const scans = (await parallel(CHECKS.map(c => () =>
  run(`${RULES}\n\n${c.prompt}`, { label: `scan:${c.key}`, phase: 'Scan', schema: FINDINGS, ...m('scan') })))).filter(Boolean)
if (scans.length < CHECKS.length) log(`WARNING: ${CHECKS.length - scans.length} scan run(s) failed and are missing from the report`)

// Pipeline: each blocker/warning is verified independently as soon as the scans return.
phase('Verify')
const flat = scans.flatMap(s => s.findings.filter(f => f.severity !== 'info').map(f => ({ ...f, check: s.check })))
log(`${flat.length} finding(s) to verify`)
const checked = (await parallel(flat.map(f => () =>
  run(`${RULES}\n\nA scan reported this finding about ${repo}. Try to REFUTE it by re-running the check yourself.\n` +
    `Check: ${f.check}\nSeverity: ${f.severity}\nTitle: ${f.title}\nWhere: ${f.where}\nEvidence: ${f.evidence}\n` +
    'Answer real=true only if you reproduced it. If uncertain or you cannot reproduce it, answer real=false and say why.',
  { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT, ...m('verify') })
    .then(v => ({ ...f, real: v ? v.real : true, reason: v ? v.reason : 'verifier failed; kept as real' }))))).filter(Boolean)
const dropped = checked.filter(f => !f.real)
if (dropped.length) log(`${dropped.length} finding(s) refuted on re-check: ${dropped.map(f => f.title).join('; ')}`)
const confirmed = checked.filter(f => f.real)

phase('Verdict')
const notRun = scans.filter(s => !s.ran).map(s => `${s.check}: ${s.summary}`)
const report = await run(
  `Write the release-readiness report for ${repo}.\n` +
  `Confirmed findings (verified twice):\n${JSON.stringify(confirmed, null, 1)}\n\n` +
  `Findings that were refuted on re-check (do NOT report them as problems):\n${JSON.stringify(dropped.map(f => f.title))}\n\n` +
  `Scan summaries:\n${JSON.stringify(scans.map(s => ({ check: s.check, ran: s.ran, summary: s.summary })), null, 1)}\n\n` +
  `Checks that did not run: ${JSON.stringify(notRun)}\n\n` +
  'Verdict is READY only if there are zero confirmed blockers AND the secrets and packaging checks both ran. Otherwise NOT READY. ' +
  'The markdown must list blockers first with the fix for each, then warnings, then what passed, then what was NOT run and why. Do not add findings of your own.',
  { label: 'verdict', phase: 'Verdict', schema: REPORT })

log(doneLine(confirmed.length + ' confirmed finding(s), ' + dropped.length + ' refuted on re-check.'))
return { ...report, receipt: receipt(), confirmed, refuted: dropped.map(f => f.title), scans: scans.map(s => ({ check: s.check, ran: s.ran })) }
