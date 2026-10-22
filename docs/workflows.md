# Workflows

A workflow is a small script that decides, in code, how many agents to run, what each one sees, and what has to be true before a result is trusted. The model does the thinking inside each step; the script owns the control flow. That is why the loops, fan-outs and checks happen the same way every time instead of depending on the model remembering to do them.

These five ship in the plugin. They run with Claude Code's Workflow tool, so you have to ask for one explicitly (they can spawn dozens of agents). Say it in plain words:

> Run the `ops-kit:release-readiness` workflow on `/path/to/repo` and forbid the words "acme" and "internal".

They also show up in the `/` menu as `/ops-kit:<name>`.

**How the cost behaves.** Bulk stages (scans, researchers, finders, skeptics) default to the `sonnet` alias; the final synthesis stage inherits your session model. Every workflow takes `models` in its args to change that, or `models: null` to inherit everywhere. Agent counts are in each section so you can size a run before you start; none of these has a token figure here because it depends entirely on your repo or inputs.

**What they never do.** None of them pushes, publishes, sends, or deletes. The ones that touch your project are read-only. `plan-my-project` writes plan files, only under the folder you name.

**Tested how.** `npm test` runs every workflow against stubbed agents: the argument checks, the phase structure, the voting rules, the behaviour when agents fail, and that nothing is silently dropped. It cannot judge the quality of the prompts. That is what real runs are for.

---

## release-readiness

![release-readiness](../diagrams/release-readiness.svg)

**Use it before** making a repo public or publishing a package. Six scans run in parallel (secrets across working tree and history, hygiene such as personal paths, emails and words you forbid, license and dependency licenses, docs, a clean install from the built package, and junk or heavy files). Every blocker or warning is then re-checked by a skeptic that tries to refute it, so false alarms are dropped and logged. The report is `READY` only with zero confirmed blockers and when both the secret scan and the packaging check actually ran.

**Args:** `repo` (required), `forbidden` (words that must not appear), `license` (expected SPDX id), `models`.
**Agents:** 6 scans, one verifier per non-info finding, 1 report.
**Needs:** nothing installed, but it uses gitleaks or trufflehog if you have them and falls back to a weaker grep (and says so).

## review-changes

![review-changes](../diagrams/review-changes.svg)

**Use it before** merging a branch or PR you want reviewed deeply. One reviewer per dimension (correctness, security, error handling, tests, performance, maintainability) reads the diff and the code around it. Each finding then faces three skeptics with different jobs: reproduce it, look for guards elsewhere, and check the severity is honest. A finding survives only if a strict majority cannot refute it.

**Args:** `target` (`working tree`, `branch:<name>`, `pr:<n>`), `base`, `dimensions`, `maxPerDimension` (default 6), `cwd`, `models`.
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

**Use it to** prepare a diagnostic for a small business: your own, a client who agreed, or a prospect. It inspects the public website across six areas (lead capture, booking path, follow-up, reputation, manual work, basics). Every medium or high leak is verified by a skeptic who reopens the cited page. The report gives the top three leaks in plain language, quick wins that need no software, and questions to ask in a diagnostic call to size the real problem.

**Rules baked into every prompt:** public pages only; never log in, submit a form, or contact anyone; no personal data about individuals; every claim cites a URL and a quote; anything that can't be seen is listed as "could not verify". It does not put dollar figures on leaks it cannot support. Only point it at businesses you have a legitimate reason to look at, and check a site's terms if you plan to run it at volume.

**Args:** `sites` (`[{ name, url, notes? }]`, required), `areas`, `models`.
**Agents:** per site, 6 inspectors, one verifier per medium or high leak, 1 report.

## design-panel

![design-panel](../diagrams/design-panel.svg)

**Use it when** a design or strategy choice has a wide solution space and one attempt, iterated, would anchor on its first idea. Five designers work independently from different angles (simplest thing, risk-first, user-first, long-term, cheapest) and can't see each other. Three judges, each on one criterion, score every design. A synthesis step picks the winner, grafts the best ideas from the runners-up, and records what was rejected and why.

**Args:** `question` (required), `constraints`, `context`, `angles` (override the defaults), `cwd`, `models`.
**Agents:** 5 + 3 + 1 = 9.
