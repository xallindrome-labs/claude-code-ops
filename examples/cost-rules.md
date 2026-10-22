# Subagent cost rules

(Paste this into your CLAUDE.md to have it in every session. The `subagent-costs` skill carries the same rules for sessions where it's loaded on demand.)

In a long session most of the cost is the cache read of the whole history on every turn, and the most capable model costs the most per token. Subagents keep bulky work out of the main context and can run on cheaper models.

## Model choice (subagents inherit your model, so choose explicitly each time)
- Smaller model (Haiku or Sonnet): codebase searches, reading and summarizing files, running tests or builds and reporting results, log triage, asset or file chores, mechanical or well-specified edits, formatting, simple research.
- Top model only: architecture decisions, hard debugging, tricky design logic, final review of risky changes. If unsure, try the smaller model first and escalate only if the result is poor.
- Note which model you used and whether quality held up, so we learn what is safe to downshift.

## When to use a subagent
- Use one when the work is bulky, self-contained or parallel (wide searches, long test output, multi-file investigations). Only its summary comes back.
- Not for a single command or quick lookup: do it directly.
- Don't spawn many at once unless the tasks are truly independent; each carries its own context and cost.

## Briefs and returns
- Short, self-contained brief: goal, relevant paths, constraints, exactly what to return. Never paste your whole history.
- Ask for a concise summary back (findings, paths, exact errors), not raw logs or file dumps.

## Lifecycle (prompt cache expires after about 5 idle minutes)
- Subagents never wait more than 4 minutes in a single command. Poll in short chunks instead of one long sleep.
- Never message a subagent that has been idle over 5 minutes. Start a fresh one with a short brief instead.
- Prefer one-shot subagents that finish and return over long-lived ones that sit open.

## Your own session
- When a major task completes, or the context passes about 400k tokens, write a short handoff note (current goal, decisions, files touched, open items, commands to resume) and suggest starting a fresh session.

## Report back
- After a substantial task, say which subagents you spawned, which model each used, what you chose not to delegate and why, and any case where a smaller model did worse.
