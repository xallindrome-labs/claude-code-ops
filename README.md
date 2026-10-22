# Claude Code Ops Kit

**Run Claude Code unattended without losing control.** A Claude Code plugin with the pieces we use to let agents work for hours while a human keeps the approvals that matter.

| Piece | What it gives you |
|---|---|
| **[Five workflows](docs/workflows.md)** | Multi-agent scripts with the checking built in: `release-readiness`, `review-changes`, `plan-my-project`, `leak-finder`, `design-panel`. |
| **`/runway`** | One interview up front, one plan approval, then an unattended run to a verifiable "done" with a turn cap. It stops only at the points that need you: push, deploy, send, spend, delete, publish. |
| **[Phone approvals](docs/phone-approvals.md)** | When a stop-point hits and you've walked away, your phone gets an Approve / Deny notification via ntfy. Never approves by default. |
| **`workflow-quote`** | Dry-runs a workflow first and tells you its size and the one setting that shrinks it, then reports what actually ran. |
| **`subagent-costs`** | The rules we use to keep delegated work cheap: which model for which job, when not to spawn, how to brief and how to stop idle sessions burning cache. |

## Install

```
/plugin marketplace add xallindrome-labs/claude-code-ops
/plugin install ops-kit@xallindrome-labs
```

Install it with those two commands. In our test in the Claude desktop app, a plugin declared only in a project's `.claude/settings.json` (`extraKnownMarketplaces` plus `enabledPlugins`) was **not** installed automatically and gave no prompt, so don't rely on that route. Once installed, each workflow can be run by name, for example `ops-kit:design-panel`, and appears in the Workflow tool's list.

You get the workflows, `/ops-kit:runway`, the `workflow-quote` and `subagent-costs` skills, and the (inactive until configured) phone hooks. Two things a plugin can't ship for you:

- **Force the stop-points to prompt.** Add the rules in [`examples/permissions-ask.json`](examples/permissions-ask.json) to your Claude Code settings, otherwise auto mode can approve a push or deploy without asking.
- **Always-on cost rules.** Skills load when relevant. If you want the rules in every session, copy [`examples/cost-rules.md`](examples/cost-rules.md) into your `CLAUDE.md`.

## The workflows, in one picture each

![review-changes](diagrams/review-changes.svg)

Every workflow follows the same idea: fan work out to cheaper models, then make the result earn its place with an independent check before a more capable model summarises it. [Read how each one works](docs/workflows.md).

## What's verified and what isn't

- `npm test` (Linux, macOS, Windows in CI): the workflow scripts against stubbed agents (arguments, phases, voting rules, failure handling, no silent caps) and the phone hook's decision logic, redaction and config handling. No tokens are spent.
- The plugin and marketplace manifests pass `claude plugin validate`.
- The phone hook's full round trip (a real prompt, a tap, the command running) was verified by hand on Windows only. Its "are you at the computer" check is Windows-only.
- Each workflow has also been run with real agents on Sonnet. Those runs found and fixed real bugs (see [docs/workflows.md](docs/workflows.md)) and gave us honest cost numbers: expect roughly 80–100k subagent tokens per agent, so even a small run is around a million tokens. Use `dryRun` first. Six runs in total, so treat the numbers as indicative and open an issue for anything odd.

## Built by Xallindrome

[Xallindrome](https://xallindrome.co) builds automation and AI workflows for small businesses. If you'd like a process like these running for your business, [book a diagnostic](https://xallindrome.co).

## License

[MIT](LICENSE). Issues are welcome; pull requests are reviewed slowly (see [CONTRIBUTING](CONTRIBUTING.md)). Security reports: [SECURITY](SECURITY.md).
