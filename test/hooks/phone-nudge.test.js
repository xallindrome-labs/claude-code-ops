'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const HOOKS = path.join(__dirname, '..', '..', 'plugins', 'ops-kit', 'hooks');
const { buildNudge, shouldNudge } = require('../../plugins/ops-kit/hooks/phone-nudge.js');

const cfg = { requestTopic: 'cc-req-' + 'a'.repeat(24) };
const now = 1_000_000_000_000;

test('shouldNudge: only idle_prompt / elicitation_dialog notifications', () => {
  const mk = (t) => ({ hook_event_name: 'Notification', notification_type: t });
  assert.ok(shouldNudge(mk('idle_prompt'), 0, now));
  assert.ok(shouldNudge(mk('elicitation_dialog'), 0, now));
  assert.ok(!shouldNudge(mk('permission_prompt'), 0, now)); // phone-approve handles these
  assert.ok(!shouldNudge(mk('auth_success'), 0, now));
  assert.ok(!shouldNudge({ hook_event_name: 'Stop', notification_type: 'idle_prompt' }, 0, now));
  assert.ok(!shouldNudge(null, 0, now));
});

test('shouldNudge: rate limit of one per 10 minutes', () => {
  const r = { hook_event_name: 'Notification', notification_type: 'idle_prompt' };
  assert.ok(!shouldNudge(r, now - 5 * 60 * 1000, now));
  assert.ok(shouldNudge(r, now - 11 * 60 * 1000, now));
});

test('buildNudge: no buttons, no content, redacted project name', () => {
  const p = buildNudge(cfg, { cwd: 'C:\\dev\\demo-app', message: 'sk-' + 'A1'.repeat(20) });
  assert.strictEqual(p.topic, cfg.requestTopic);
  assert.strictEqual(p.actions, undefined);
  assert.ok(p.title.includes('demo-app'));
  assert.ok(!JSON.stringify(p).includes('sk-'));
  const s = buildNudge(cfg, { cwd: 'C:\\dev\\sk-' + 'Z9'.repeat(20) });
  assert.ok(!JSON.stringify(s).includes('sk-'), JSON.stringify(s));
});

test('integration: garbage / wrong event => no output, exit 0', () => {
  for (const input of ['not json', JSON.stringify({ hook_event_name: 'Stop' })]) {
    const r = spawnSync(process.execPath, [HOOKS + '/phone-nudge.js'], { input, encoding: 'utf8' });
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.status, 0);
  }
});
