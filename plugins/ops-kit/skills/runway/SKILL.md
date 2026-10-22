---
name: runway
description: Take a feature from idea to verified completion with one up-front interview and one plan approval, then run unattended under auto mode and /goal with a turn cap. Use when the user says /runway, "runway this", or wants a feature built end-to-end without being asked questions mid-task. Pages the phone only at stop-points (push, deploy, send, submit, spend, delete, publish).
---

# /runway

Goal: every question gets asked **now**, so nothing needs asking at turn 40. After that the user approves one plan and walks away; their phone is paged only for stop-points.

Ground rules (the user may have their own in CLAUDE.md; theirs win):
- Local and reversible work (edits, builds, tests, local commands, commits on a branch or worktree) runs without asking.
- **Always stop for:** push or deploy, sending any message, submitting any application, spending money, deleting data, publishing anything public.
- Use cheaper subagent models for bulky work (searches, test runs, log triage); the top model only for design and hard debugging.

## 0. Preflight (silent, no questions)

- Find the repo root and its state: `git status`, current branch, an existing `SPEC.md`, test and build scripts (`package.json`, `Makefile`, etc.). Finding facts is your job, not the user's.
- Check whether phone approvals are live. They are if either `~/.claude/settings.json` has a `PermissionRequest` hook running `phone-approve.js`, or this plugin's hook is enabled, **and** `~/.claude/phone-approve.json` exists. If not, tell the user once (setup: run `node "${CLAUDE_PLUGIN_ROOT}/hooks/phone-approve.js" --init`, then subscribe the ntfy app to the request topic in that file) and continue; stop-points then fall back to the desktop dialog.
- Check that stop-point commands are *forced* to prompt, because auto mode may otherwise approve them without paging. Look in user, project and local settings for `permissions.ask` (or `deny`) rules covering `git push`, this repo's deploy commands (`vercel`, `aws s3 sync`, `cdk deploy`, `npm publish`, `gh release`, `gh pr merge`), and delete commands (`rm -r`, `git clean`, `git branch -D`). If rules are missing, propose the specific ones, show the diff, and add them only if the user says yes (the plugin's `examples/permissions-ask.json` is a starting point). Never add `allow` rules for send, publish or deploy tools, and never `Bash(*)`.

## 1. Interview until the spec is complete

If a `grilling` or `grill-me` skill is installed, call it and run it on this feature; its rules apply in full. If not, run the interview yourself like this: ask in **rounds**; each round contains every question whose prerequisites are already settled, each numbered, each with your recommended answer worded so that "yes" accepts it. Wait for the answers, recompute what is now askable, and repeat. Look up environment facts yourself (use a subagent for bulky searches) and never ask the user for something you can find out. Decisions are the user's.

If the user already ran a grilling session on this feature earlier in the conversation and confirmed shared understanding, do not repeat it: reuse the answers and ask only about checklist items below that it left open.

Keep going until nothing is left open on all of:

1. **Goal**: one or two sentences, the user-visible outcome.
2. **Scope**: what will change (areas, files, surfaces).
3. **Out of scope**: what must not be touched.
4. **Acceptance criteria**: a checklist where each item can be shown true by command output.
5. **Verification command**: exactly one command whose exit 0 means done (for example `npm run lint && npm test && npm run build`). If none exists, the spec includes writing it as the first task.
6. **Stop-points**: which of push / deploy / send / submit / spend / delete / publish this feature will hit, and what the user expects at each (for example "push the branch, open a PR, do not merge").
7. **Decisions you would otherwise make mid-task**: libraries, naming, data shapes, copy, edge-case behaviour. Ask now, with a recommendation.
8. **Turn cap** (default 60) and any budget concern.

Do not move on until the user confirms shared understanding.

## 2. Write SPEC.md and commit it locally

Write `SPEC.md` in the repo root:

```markdown
# <feature name>
## Goal
## Scope
## Out of scope
## Acceptance criteria
- [ ] ...
## Verification command
`<one command>`
## Stop-points
| Action | Expected handling |
## Decisions already made
## Turn cap
60
```

Create a branch (`git switch -c runway/<slug>`), or use a worktree when other sessions are editing the same folder, then commit **only** `SPEC.md`. This is local and reversible; do not ask. Never push.

## 3. One plan approval

Enter plan mode and present a single plan: ordered steps, which steps go to subagents (and on which model), the verification command, and the stop-points with their expected handling. This is the **only** approval before the run. Use ExitPlanMode and ask the user to choose **"Yes, and use auto mode"**. (The phone hook deliberately skips plan approval, so the user does this at the computer.)

If auto mode is not active after approval, say so and ask the user to switch it. Do not run the loop in manual mode.

## 4. Run under /goal with a turn cap

Built-in slash commands cannot be invoked by the model, so end the previous step by giving the user **one** line to paste (fill in the real command and cap):

```
/goal <verification command> exits 0, every acceptance criterion in SPEC.md is checked off with evidence in the transcript, and nothing in SPEC.md's out-of-scope list was touched, or stop after 60 turns
```

If the session already runs a goal, `/goal` replaces it. The evaluator only sees the transcript, so while working: run the verification command often, print its result, and tick `SPEC.md` criteria with evidence. Report progress against the turn cap each turn.

While running:
- Do not ask questions. If something unspecified comes up, pick the option closest to the spec, record it under "Decisions already made", and continue. Stop for a question only when proceeding would hit a stop-point or contradict the spec.
- Commit work in small commits on the runway branch. Never push without a stop-point approval.
- At a stop-point, make the call normally; the permission prompt is what pages the phone. If it is denied, do not retry another way: record it, finish what does not need it, and report.
- If 3 consecutive turns make no progress, stop and report what blocked you.

## 5. Finish

When the verification passes (or the cap hits), report in this order:
1. Outcome: done / partially done / blocked, plus the branch and any PR link.
2. Diff stats (`git diff --stat <base>...HEAD`).
3. **Verified**: criteria proven, with the command and result.
4. **Not verified**: criteria not proven or only partly; anything skipped or denied at a stop-point.
5. Subagents used, on which model, and where a smaller model did worse.
6. Turns and rough cost used against the cap.
