# Security policy

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on https://github.com/xallindrome-labs/claude-code-ops/security/advisories/new. Please don't open a public issue for a vulnerability. This is a small project: expect an acknowledgement within a week.

What matters most here is the **phone-approve hook**, because it can approve a permission request on your behalf. The model and its limits are written up in [docs/phone-approvals.md](docs/phone-approvals.md). Anything that lets a reply, a notification body or a config file approve something it should not is in scope.

Supported versions: the latest release only.
