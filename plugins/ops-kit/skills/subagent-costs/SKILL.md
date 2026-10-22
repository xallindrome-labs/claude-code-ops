---
name: subagent-costs
description: Cost discipline for delegating to subagents. Use before spawning subagents or workflows, when choosing a model for delegated work, or when a session has grown long and expensive.
---

# Subagent cost rules

In a long session most of the cost is the cache read of the whole history on every turn, and the most capable model costs the most per token. Subagents keep bulky work out of the main context and can run on cheaper models. Apply these rules every time you delegate.

## Choose the model explicitly

Subagents inherit your model unless you say otherwise.

- **Smaller model (Haiku or Sonnet):** codebase searches, reading and summarizing files, running tests or builds and reporting results, log triage, asset or file chores, mechanical or well-specified edits, formatting, simple research.
- **Top model only:** architecture decisions, hard debugging, tricky design or balance logic, final review of risky changes.
- If unsure, try the smaller model first and escalate only if the result is poor. Note which model you used and whether quality held, so the team learns what is safe to downshift.

## When to use a subagent

- Use one when the work is bulky, self-contained or parallel: wide searches, long test output, multi-file investigations. Only its summary comes back.
- Do **not** use one for a single command or a quick lookup. Do it directly.
- Don't spawn many at once unless the tasks are truly independent; each carries its own context and cost.

## Briefs and returns

- Write a short, self-contained brief: the goal, the relevant paths, the constraints, and exactly what to return. Never paste your whole history.
- Ask for a concise summary back (findings, paths, exact errors), not raw logs or file dumps.

## Lifecycle

- Prompt-cache entries expire after roughly five idle minutes. A subagent should never wait more than four minutes in one command; poll in short chunks.
- Do not message a subagent that has been idle over five minutes. Start a fresh one with a short brief.
- Prefer one-shot subagents that finish and return over long-lived ones that sit open.

## Your own session

- When a major task completes, or the context passes roughly 400k tokens, write a short handoff note (current goal, decisions, files touched, open items, commands to resume) and suggest starting a fresh session.

## Report back

After a substantial task, say which subagents you spawned, which model each used, what you chose not to delegate and why, and any case where a smaller model did worse.
