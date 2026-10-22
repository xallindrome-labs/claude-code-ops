---
name: workflow-quote
description: Quote the size of a multi-agent workflow before running it. Use before running any ops-kit workflow (release-readiness, review-changes, plan-my-project, leak-finder, design-panel) or any other Workflow, and again after it finishes to report what actually ran.
---

# Quote before you run

A workflow script cannot ask the user anything once it is running, so the only moment to check "is this the size of run you want?" is **before** launch. Each ops-kit workflow supports `dryRun: true`: it validates the arguments, logs a `PLAN` line, and returns without starting a single agent.

## Before the run

1. Call the workflow with the real arguments plus `dryRun: true`.
2. Tell the user, in plain words:
   - the agent count or range from the `PLAN` line;
   - which model the bulk stages use (the plan line says);
   - the **one argument that shrinks the run the most** (the plan line names it), for example `maxPerDimension` for `review-changes` or `verifyCap` for `leak-finder`;
   - the rule of thumb from the real runs: in the ops-kit test runs each agent reported roughly 80,000 subagent tokens (range 79k to 98k, on Sonnet, reading files and running tools). That is an observation from six runs, not a promise, and the script itself never estimates tokens or dollars.
3. Wait for a yes. Skip the wait only if the user has already said to run it without asking.

## After the run

The script logs a `DONE` line and returns a `receipt` (agents launched, by phase, and how many returned nothing). Tell the user those numbers, any finding that was capped or skipped (the scripts log what they drop), and that the real token cost is in their session usage view, not in the script.

## Don't

- Don't invent a dollar figure or a token estimate beyond the observed rule of thumb above.
- Don't run a workflow twice to "see what it does"; the dry run is for that.
