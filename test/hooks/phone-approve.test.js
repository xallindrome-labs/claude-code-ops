'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const HOOKS = path.join(__dirname, '..', '..', 'plugins', 'ops-kit', 'hooks');
const { decide, decisionOutput, redact, buildSummary, buildPayload, loadConfig } = require('../../plugins/ops-kit/hooks/phone-approve.js');

const N = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

test('decide: exact allow/deny with right nonce', () => {
  assert.strictEqual(decide(`allow ${N}`, N), 'allow');
  assert.strictEqual(decide(`deny ${N}`, N), 'deny');
  assert.strictEqual(decide(`  allow ${N}\n`, N), 'allow');
});

test('decide: everything else is null (never allow by default)', () => {
  const bad = [
    `allow ${OTHER}`, `deny ${OTHER}`, `allow`, `allow `, ``, `ALLOW ${N}`, `allow ${N} extra`,
    `please allow ${N}`, `allow ${N}x`, `allow ${N.slice(1)}`, `allowed ${N}`, `${N}`, `allow\n${N}`,
    `allow ${N}\ndeny ${N}`, null, undefined, 42, {}, [`allow ${N}`],
  ];
  for (const m of bad) assert.strictEqual(decide(m, N), null, `should be null: ${JSON.stringify(m)}`);
});

test('decide: bad nonce arguments never match', () => {
  assert.strictEqual(decide('allow abc', 'abc'), null); // too short
  assert.strictEqual(decide(`allow ${N}`, undefined), null);
  assert.strictEqual(decide(`allow ${N}`, ''), null);
});

test('decisionOutput shapes', () => {
  assert.deepStrictEqual(decisionOutput('allow'), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  const d = decisionOutput('deny');
  assert.strictEqual(d.hookSpecificOutput.decision.behavior, 'deny');
  assert.strictEqual(d.hookSpecificOutput.decision.message, 'Denied from phone');
  assert.strictEqual(decisionOutput(null), null);
  assert.strictEqual(decisionOutput('maybe'), null);
});

test('redact: removes token-like strings', () => {
  const cases = [
    'sk-abcdefghijklmnopqrstuvwx1234',
    'sk-ant-api03-AbCdEf_123-xyz',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz',
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    // Fake JWT, assembled at runtime so secret scanners don't flag the fixture.
    ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join('.'),
    'Bearer abcDEF123456789xyz',
    'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5',
  ];
  for (const c of cases) {
    const out = redact(`curl -H "Authorization: ${c}" https://x.test/?k=${c} ${c}`);
    assert.ok(!out.includes(c), `leaked ${c}: ${out}`);
    assert.ok(out.includes('[redacted]'));
  }
});

test('redact: KEY=value, flags, URL credentials', () => {
  assert.ok(!redact('API_KEY=hunter2hunter2 npm run x').includes('hunter2'));
  assert.ok(!redact('deploy --token hunter2').includes('hunter2'));
  assert.ok(!redact('deploy --password=hunter2').includes('hunter2'));
  assert.ok(!redact('git clone https://user:hunter2@github.com/a/b').includes('hunter2'));
  assert.ok(!redact('-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----').includes('MIIE'));
});

test('redact: leaves ordinary commands and paths alone', () => {
  assert.strictEqual(redact('npm test'), 'npm test');
  assert.strictEqual(redact('git commit -m "fix bug"'), 'git commit -m "fix bug"');
  assert.strictEqual(redact('C:\\dev\\demo-app\\src\\components\\Header.tsx'), 'C:\\dev\\demo-app\\src\\components\\Header.tsx');
});

test('buildSummary: redacts before truncating, caps length, hides contents', () => {
  const secret = 'sk-' + 'Z9'.repeat(20);
  // secret straddles the 120-char boundary
  const cmd = 'x'.repeat(100) + ' ' + secret + ' tail';
  const s = buildSummary({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: 'C:\\dev\\demo-app' });
  assert.ok(!s.body.includes('sk-'), s.body);
  assert.ok(!s.body.includes('Z9Z9'), s.body);
  assert.ok(s.body.length <= 120 + 40);
  assert.ok(s.body.includes('demo-app'));
  assert.strictEqual(s.title, 'Claude: Bash');
  const w = buildSummary({ tool_name: 'Write', tool_input: { file_path: 'C:\\a\\b.txt', content: 'SECRET-CONTENT-HERE' }, cwd: 'C:\\a' });
  assert.ok(!w.body.includes('SECRET-CONTENT-HERE'));
  const bad = buildSummary({});
  assert.ok(bad.title && bad.body);
});

test('buildPayload: buttons post allow/deny + nonce to reply topic', () => {
  const cfg = loadConfig({ requestTopic: 'cc-req-' + 'a'.repeat(24), replyTopic: 'cc-rep-' + 'b'.repeat(24) });
  const p = buildPayload(cfg, { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: 'C:\\dev' }, N);
  assert.strictEqual(p.topic, cfg.requestTopic);
  assert.strictEqual(p.actions.length, 2);
  assert.strictEqual(p.actions[0].body, `allow ${N}`);
  assert.strictEqual(p.actions[1].body, `deny ${N}`);
  assert.ok(p.actions.every((a) => a.action === 'http' && a.method === 'POST' && a.url.endsWith('/' + cfg.replyTopic)));
  assert.ok(!JSON.stringify(p.message).includes(N));
});

test('loadConfig rejects weak/short/equal topics and non-https', () => {
  const good = 'cc-req-' + 'a'.repeat(24);
  assert.strictEqual(loadConfig(null), null);
  assert.strictEqual(loadConfig({ requestTopic: 'short', replyTopic: good }), null);
  assert.strictEqual(loadConfig({ requestTopic: good, replyTopic: good }), null);
  assert.strictEqual(loadConfig({ requestTopic: good, replyTopic: 'cc-rep-' + 'b'.repeat(24), server: 'http://ntfy.sh' }), null);
});

test('integration: dry run shows redacted payload, sends nothing, prints no stdout', () => {
  // Hermetic: a throwaway HOME, so the test never reads or writes the real ~/.claude/phone-approve.json.
  const fs = require('node:fs');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-approve-test-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, PHONE_APPROVE_DRY_RUN: '1', PHONE_APPROVE_FORCE_AWAY: '1' };
  const init = spawnSync(process.execPath, [HOOKS + '/phone-approve.js', '--init'], { env, encoding: 'utf8' });
  assert.strictEqual(init.status, 0, init.stderr);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'phone-approve.json')), '--init writes the config');
  const secret = 'sk-' + 'Q7'.repeat(20);
  const r = spawnSync(process.execPath, [HOOKS + '/phone-approve.js'], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: `echo ${secret}` }, cwd: '/work/demo' }),
    env,
    encoding: 'utf8',
  });
  fs.rmSync(home, { recursive: true, force: true });
  assert.strictEqual(r.stdout, '');
  assert.ok(r.stderr.includes('Approve'));
  assert.ok(!r.stderr.includes('sk-'), r.stderr);
  assert.ok(!r.stderr.includes('Q7Q7'), r.stderr);
});

test('integration: garbage stdin => no output, exit 0', () => {
  const r = spawnSync(process.execPath, [HOOKS + '/phone-approve.js'], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.status, 0);
});
