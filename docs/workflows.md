# Workflows

A workflow is a small script that decides, in code, how many agents to run, what each one sees, and what has to be true before a result is trusted. The model does the thinking inside each step; the script owns the control flow. That is why the loops, fan-outs and checks happen the same way every time instead of depending on the model remembering to do them.

These five ship in the plugin. They run with Claude Code's Workflow tool, so you have to ask for one explicitly (they can spawn dozens of agents). Say it in plain words:

> Run the `ops-kit:release-readiness` workflow on `/path/to/repo` and forbid the words "acme" and "internal".

They also show up in the `/` menu as `/ops-kit:<name>`.

**Models.** Bulk stages (scans, researchers, finders, skeptics) default to the `sonnet` alias; the final synthesis stage inherits your session model. Every workflow takes `models` in its args to change that, or `models: null` to inherit everywhere.

**Cost lines and dry runs.** Every workflow takes `dryRun: true`: it validates the arguments, logs a `PLAN` line (the agent count or range, the models, and the one argument that shrinks the run) and returns without starting an agent. A real run logs the same `PLAN` first and a `DONE` line at the end, and returns a `receipt` of agents launched, by phase, and how many returned nothing. The `workflow-quote` skill tells Claude to dry-run first and wait for your yes. The scripts print **counts only**: they cannot measure tokens, so they never print a token or dollar figure.

**What runs actually cost.** We ran each workflow with real agents on Sonnet. Agents read files and run tools, so they use far more than a chat message:

| Workflow (input) | Agents | Subagent tokens reported | Per agent | Wall time |
|---|---|---|---|---|
| design-panel (one design question) | 9 | 758k | 84k | ~5 min |
| review-changes (2 commits, 3 dimensions, cap 2) | 14 | 1.11M | 79k | ~1.4 min |
| release-readiness (a small repo) | 12 | 983k | 82k | ~2.5 min |
| leak-finder (one site, all 6 areas; before the dedupe and cap below) | 29 | 2.37M | 82k | ~4.6 min |
| leak-finder, after the fixes (same site, 2 areas, `verifyCap` 3) | 7 | 622k | 89k | ~3.5 min |
| plan-my-project, research stage (4 angles) | 6 | 589k | 98k | ~6 min |

Take roughly **80–100k tokens per agent** as a planning figure, and expect a "small" run to cost a million tokens. That is six observations, not a guarantee, and the harness's "reported tokens" may count more than you'd expect, so check your own usage view. Use `dryRun` and the knobs below before you launch.

**What they never do.** None of them pushes, publishes, sends, or deletes. The ones that touch your project are read-only. `plan-my-project` writes plan files, only under the folder you name.


**Tested how.** `npm test` runs every workflow against stubbed agents: the argument checks, the phase structure, the voting rules, dry runs, receipts, the behaviour when agents fail, and that nothing is silently dropped. It cannot judge prompt quality, so each workflow has also been run once with real agents (see the table above). Those runs found real bugs, which are fixed; for example the first `leak-finder` run showed that parallel agents sharing one browser tab corrupt each other's pages, that one problem was reported in up to five areas and verified five times, and that verifier corrections weren't reaching the report.

---

## release-readiness

![release-readiness](../diagrams/release-readiness.svg)

**Use it before** making a repo public or publishing a package. Six scans run in parallel (secrets across working tree and history, hygiene such as personal paths, emails and words you forbid, license and dependency licenses, docs, a clean install from the built package, and junk or heavy files). Every blocker or warning is then re-checked by a skeptic that tries to refute it, so false alarms are dropped and logged. The report is `READY` only with zero confirmed blockers and when both the secret scan and the packaging check actually ran.

**Args:** `repo` (required), `forbidden` (words that must not appear), `license` (expected SPDX id), `models`, `dryRun`.
**Agents:** 6 scans, one verifier per blocker or warning, 1 report: at least 7.
**Needs:** nothing installed, but it uses gitleaks or trufflehog if you have them and falls back to a weaker grep (and says so).

## review-changes

![review-changes](../diagrams/review-changes.svg)

**Use it before** merging a branch or PR you want reviewed deeply. One reviewer per dimension (correctness, security, error handling, tests, performance, maintainability) reads the diff and the code around it. Each finding then faces three skeptics with different jobs: reproduce it, look for guards elsewhere, and check the severity is honest. A finding survives only if a strict majority cannot refute it.

**Args:** `target` (`working tree`, `branch:<name>`, `pr:<n>`), `base`, `dimensions`, `maxPerDimension` (default 6), `cwd`, `models`, `dryRun`.
**Agents:** 1 scope, one per dimension, up to `maxPerDimension × 3` verifiers per dimension, 1 report. The worst case is 6 × 6 × 3 = 108 verifiers; lower `maxPerDimension` or pick fewer `dimensions` for a cheaper run. Findings beyond the cap are logged, not silently dropped.

## plan-my-project

![plan-my-project](../diagrams/plan-my-project.svg)

**Use it when** you have an idea and want it researched and planned before building. A workflow can't ask you questions mid-run, so this is two runs with you in the middle.

1. `stage: "research"` with `idea`: it frames the research angles, fans out one cheap researcher per angle (every fact needs a source and a confidence), and writes a **decision brief**: each decision, the options, a recommended answer, and the facts behind it.
2. You answer the decisions, ideally with a grilling session (the `/runway` skill describes the interview format, and any `grilling` skill works).
3. `stage: "plans"` with `idea`, `brief`, `decisions` and `outDir`: it outlines the plan files, drafts them in parallel, has a critic check them against your decisions, and repairs only the flagged files.

**Agents:** stage 1 is 1 + (up to 8 angles) + 1. Stage 2 is 1 + one per plan + 1 + one per flagged file.
**Writes:** plan files, only under `outDir`.

## leak-finder

![leak-finder](../diagrams/leak-finder.svg)

**Use it to** prepare a diagnostic for a small business: your own, a client who agreed, or a prospect. It inspects the public website across six areas (lead capture, booking path, follow-up, reputation, manual work, basics). Duplicate leaks (one problem reported under several areas) are merged first, then the most important ones, up to `verifyCap`, are each re-checked by a skeptic who reopens the cited page. Anything not re-checked is listed separately as "also noticed", never in the top three, and where a verifier corrects a detail the report uses the correction. The report gives the top three leaks in plain language, quick wins that need no software, and questions to ask in a diagnostic call to size the real problem.

**Rules baked into every prompt:** public pages only; never log in, submit a form, or contact anyone; no personal data about individuals; every claim cites a URL and a quote; anything that can't be seen is listed as "could not verify". It does not put dollar figures on leaks it cannot support. Only point it at businesses you have a legitimate reason to look at, and check a site's terms if you plan to run it at volume.

**Args:** `sites` (`[{ name, url, notes? }]`, required), `areas`, `verifyCap` (default 8), `models`, `dryRun`.
**Agents:** per site, one inspector per area (6), 1 dedupe, up to `verifyCap` verifiers, 1 report: 8 to 16 per site at defaults. Agents read pages with WebFetch or curl and are told never to use shared browser tools.

## design-panel

![design-panel](../diagrams/design-panel.svg)

**Use it when** a design or strategy choice has a wide solution space and one attempt, iterated, would anchor on its first idea. Five designers work independently from different angles (simplest thing, risk-first, user-first, long-term, cheapest) and can't see each other. Three judges, each on one criterion, score every design. A synthesis step picks the winner, grafts the best ideas from the runners-up, and records what was rejected and why.

**Args:** `question` (required), `constraints`, `context`, `angles` (override the defaults), `cwd`, `models`, `dryRun`.
**Agents:** 5 + 3 + 1 = 9.
