# Phone approvals

Lets Claude Code page your phone when it needs permission and you've walked away, so an unattended run waits for one tap instead of stalling at your desk. It uses [ntfy](https://ntfy.sh): a `PermissionRequest` hook sends a notification with **Approve** and **Deny** buttons, and an optional `Notification` hook sends a plain nudge when Claude is waiting for you.

## Set up (about 3 minutes)

1. Install the plugin (the hooks come with it, and do nothing until step 2):
   ```
   /plugin marketplace add xallindrome-labs/claude-code-ops
   /plugin install ops-kit@xallindrome-labs
   ```
2. Create your private topics:
   ```bash
   node "<plugin folder>/hooks/phone-approve.js" --init
   ```
   This writes `~/.claude/phone-approve.json` with two random topic names. It never overwrites an existing file.
3. Install the ntfy app on your phone and subscribe it to the **`requestTopic`** value from that file.
4. Make sure the commands you care about actually prompt, even in auto mode. Add the rules from [`examples/permissions-ask.json`](../examples/permissions-ask.json) to your settings. Without them, auto mode can approve a push or deploy without ever paging you.

## What it does and doesn't do

- **Never approves by default.** No config, an error, a timeout (10 minutes by default) or any doubt produces no output, and Claude shows its normal dialog.
- **Only an exact reply decides.** The Approve and Deny buttons post `allow <nonce>` or `deny <nonce>` to your reply topic. The nonce is random per request, so an old or guessed reply does nothing.
- **Skips you when you're at the computer.** If you used the keyboard or mouse in the last 2 minutes it stays out of the way. The presence check is **Windows-only**; on macOS and Linux it can't tell, so it pages every time.
- **Won't approve plan mode or questions.** `ExitPlanMode` and `AskUserQuestion` always stay at the computer.
- **The notification is a redacted summary:** the tool name, at most 120 characters of the command or path with token-like strings masked, and the project folder name. It never includes file contents.

## Security model, honestly

- The topic names are the secret. Anyone who knows both your request topic and your reply topic could watch your requests and approve them. Keep `phone-approve.json` private (it is written with owner-only permissions where the OS supports it) and never paste it anywhere.
- ntfy.sh is a public service. It sees the redacted summaries. For stronger guarantees, [self-host ntfy](https://docs.ntfy.sh/install/) with authentication and set `server` in the config to your https URL.
- It approves whatever request is pending when you tap. Read the notification before you tap.
- The redaction patterns are best effort. Don't rely on them to hide a secret you deliberately put in a command line.

## Tests

`npm test` covers the decision logic, the redaction, the config validation, and an end-to-end dry run in a throwaway home folder. It does not send real notifications. A real round trip (a prompt, a tap, the command running) was verified by hand on Windows only.
