export const meta = {
  name: 'review-changes',
  description: 'Multi-dimension code review where every finding is checked by independent skeptics',
  whenToUse: 'Before merging a branch or PR you want reviewed deeply. Read-only: it reports findings and never edits code.',
  phases: [
    { title: 'Scope', detail: 'find the change and summarize what it is meant to do' },
    { title: 'Review', detail: 'one reviewer per dimension, in parallel' },
    { title: 'Verify', detail: 'three skeptics try to refute each finding' },
    { title: 'Report', detail: 'ranked findings that survived' },
  ],
}

// args: {
//   cwd?: string                 repository to review (default: the session's working directory)
//   target?: string              what to review: "working tree" (default), "branch:<name>", "pr:<number>", or a path
//   base?: string                base branch to diff against (default: the repo's default branch)
//   dimensions?: string[]        subset of: correctness, security, error-handling, tests, performance, maintainability
//   maxPerDimension?: number     cap findings verified per dimension (default 6; anything beyond is logged, not silently dropped)
//   models?: { review?: string, verify?: string } | null
// }
const cwd = args?.cwd ?? '.'
const target = args?.target ?? 'working tree'
const maxPer = args?.maxPerDimension ?? 6
const models = args?.models === null ? {} : { review: 'sonnet', verify: 'sonnet', ...(args?.models ?? {}) }
const m = stage => (models[stage] ? { model: models[stage] } : {})

const ALL_DIMENSIONS = {
  correctness: 'Logic errors, off-by-one, wrong conditions, broken edge cases, race conditions, wrong assumptions about inputs or ordering.',
  security: 'Injection, unsafe deserialization, path traversal, secrets in code or logs, missing authz/authn checks, unsafe defaults, SSRF, dependency risk.',
  'error-handling': 'Swallowed errors, missing cleanup on failure paths, unhandled promise rejections, partial writes, retries that can double-apply side effects.',
  tests: 'Behavior in the change that no test covers, tests that cannot fail, assertions that do not test what the name says.',
  performance: 'Accidental O(n^2), work repeated in loops, unbounded memory, blocking calls on hot paths, missing pagination or limits.',
  maintainability: 'Duplicated logic that will drift, misleading names, dead code, public API changes without migration, comments that now lie.',
}
const wanted = (args?.dimensions ?? Object.keys(ALL_DIMENSIONS)).filter(d => ALL_DIMENSIONS[d])
if (!wanted.length) throw new Error('args.dimensions had no valid entries')

const SCOPE = {
  type: 'object',
  properties: {
    howToSeeTheChange: { type: 'string', description: 'the exact git command(s) that print the diff under review' },
    files: { type: 'array', items: { type: 'string' } },
    intent: { type: 'string', description: 'what the change is meant to do, from commit messages/PR text/code' },
    sizeNote: { type: 'string' },
  },
  required: ['howToSeeTheChange', 'files', 'intent'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          explanation: { type: 'string', description: 'what is wrong and the concrete input or state that triggers it' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'explanation'],
      },
    },
  },
  required: ['findings'],
}

const VOTE = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, already handled, or not reachable' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const REPORT = {
  type: 'object',
  properties: { markdown: { type: 'string' } },
  required: ['markdown'],
}

const READONLY = `You are READ-ONLY. Do not edit files, commit, push or run anything that changes the repository. Working directory: ${cwd}.`

phase('Scope')
const scope = await agent(
  `${READONLY}\nFind the change to review. Target: "${target}"${args?.base ? `, base branch: ${args.base}` : ''}.\n` +
  'Work out the exact git command(s) that show the diff (for a PR use `gh pr diff <n>`; for a branch, diff against the merge-base with the base branch; ' +
  'for "working tree", staged plus unstaged changes). List the changed files, and state what the change is meant to do (read commit messages and PR text). ' +
  'If the diff is huge (over ~3000 lines), say so in sizeNote.',
  { label: 'scope', phase: 'Scope', schema: SCOPE, ...m('review') })
if (!scope || !scope.files.length) return { error: 'No change found to review', target, scope }
log(`Reviewing ${scope.files.length} file(s): ${scope.howToSeeTheChange}`)

// Each dimension flows through review -> verify independently (no barrier between stages).
const results = await pipeline(
  wanted,
  dim => agent(
    `${READONLY}\nYou are the ${dim.toUpperCase()} reviewer. Look ONLY for: ${ALL_DIMENSIONS[dim]}\n` +
    `Change under review (see it with: ${scope.howToSeeTheChange}). Intent: ${scope.intent}\n` +
    `Files: ${scope.files.join(', ')}\n` +
    'Read the diff AND the surrounding code it touches (callers, tests). Report only problems introduced or exposed by THIS change, each with a file, a line, and the concrete input or state that triggers it. ' +
    'Prefer a few real findings over many speculative ones. Return an empty list if you find nothing.',
    { label: `review:${dim}`, phase: 'Review', schema: FINDINGS, ...m('review') }),
  async (review, dim) => {
    const all = review?.findings ?? []
    const rank = { high: 0, medium: 1, low: 2 }
    const kept = [...all].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, maxPer)
    if (all.length > kept.length) log(`${dim}: verifying top ${kept.length} of ${all.length} findings; ${all.length - kept.length} lower-severity not verified`)
    const lenses = [
      'REPRODUCE: trace the exact code path with the triggering input. Can it actually happen?',
      'CONTEXT: look for guards, callers, config or tests elsewhere that already prevent or handle it. Is this intended behaviour?',
      'IMPACT: assuming it happens, is the stated severity honest? Would a maintainer care?',
    ]
    const verified = await parallel(kept.map(f => async () => {
      const votes = (await parallel(lenses.map(lens => () => agent(
        `${READONLY}\nTry to REFUTE this review finding. Lens: ${lens}\n` +
        `Finding: ${f.title}\nFile: ${f.file}${f.line ? `:${f.line}` : ''}\nSeverity: ${f.severity}\nClaim: ${f.explanation}\n` +
        'Open the code. Answer refuted=true if you cannot make the claim hold, or if you are uncertain.',
        { label: `verify:${dim}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VOTE, ...m('verify') })))).filter(Boolean)
      const notRefuted = votes.filter(v => !v.refuted).length
      // A finding survives only if a strict majority of the skeptics that answered could not refute it.
      return { ...f, dimension: dim, votes, survived: notRefuted > votes.length / 2 }
    }))
    return verified.filter(Boolean)
  })

const all = results.filter(Boolean).flat()
const survivors = all.filter(f => f.survived)
const rejected = all.filter(f => !f.survived)
log(`${survivors.length} finding(s) survived verification, ${rejected.length} were refuted`)

phase('Report')
const rank = { high: 0, medium: 1, low: 2 }
survivors.sort((a, b) => rank[a.severity] - rank[b.severity])
const report = await agent(
  'Write the code-review report.\n' +
  `Change intent: ${scope.intent}\nFiles: ${scope.files.join(', ')}\n` +
  `Verified findings (each survived 3 independent refutation attempts; votes shown):\n${JSON.stringify(survivors, null, 1)}\n\n` +
  `Refuted findings (mention only as a count, never as problems): ${rejected.length}\n\n` +
  'Order by severity. For each: title, file:line, why it matters, the fix, and how many of the 3 skeptics could not refute it. ' +
  'End with one line on what was NOT reviewed (dimensions skipped, findings beyond the per-dimension cap). Do not add findings of your own.',
  { label: 'report', phase: 'Report', schema: REPORT })

return { survivors, refutedCount: rejected.length, dimensions: wanted, scope, markdown: report?.markdown ?? null }
