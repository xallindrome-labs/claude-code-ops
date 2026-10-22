# Contributing

Issues are welcome. Pull requests are welcome too, but **reviewed slowly**; this is a small project, so open an issue first for anything bigger than a small fix.

- `npm test` runs everything. The workflow tests use stubbed agents, so they cost no tokens.
- Workflow scripts must start with `export const meta = {...}` (a pure literal), use only the workflow globals, and never call `Date.now()`, `Math.random()` or `new Date()`. The tests enforce this.
- If you change a workflow's shape, update `scripts/gen-diagrams.mjs` and run `npm run diagrams`; CI fails if the diagrams are stale.
- Hook changes need tests, and the hook must never approve anything by default: any error, timeout or doubt means no output.
- By contributing you agree your contribution is MIT licensed.

Built by [Xallindrome](https://xallindrome.co).
