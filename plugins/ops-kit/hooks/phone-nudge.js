#!/usr/bin/env node
// phone-nudge: Notification hook. When Claude has been waiting for you (idle_prompt)
// and you are away from the PC, send a plain ntfy notification (no buttons, no decision).
// Never produces stdout. Any error => silent exit 0.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { redact, loadConfig, userIsPresent, publish, CONFIG_PATH } = require('./phone-approve.js');

const NUDGE_TYPES = ['idle_prompt', 'elicitation_dialog'];
const MIN_GAP_MS = 10 * 60 * 1000; // at most one nudge per session per 10 min

function buildNudge(cfg, req) {
  const project = req.cwd ? path.basename(String(req.cwd).replace(/[\\/]+$/, '')) : '';
  const p = project ? redact(project).slice(0, 40) : 'a session';
  return {
    topic: cfg.requestTopic,
    title: `Claude is waiting: ${p}`,
    message: 'Open the Claude app to reply.',
    priority: 3,
    tags: ['speech_balloon'],
  };
}

function shouldNudge(req, lastSentMs, nowMs) {
  if (!req || req.hook_event_name !== 'Notification') return false;
  if (!NUDGE_TYPES.includes(req.notification_type)) return false;
  return !(lastSentMs && nowMs - lastSentMs < MIN_GAP_MS);
}

function stampFile(sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'nosession';
  return path.join(os.tmpdir(), `phone-nudge-${safe}.stamp`);
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) raw += c;
  const req = JSON.parse(raw);
  const cfg = loadConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  if (!cfg) return;
  const stamp = stampFile(req.session_id);
  let last = 0;
  try { last = Number(fs.readFileSync(stamp, 'utf8')) || 0; } catch { /* first nudge */ }
  if (!shouldNudge(req, last, Date.now())) return;
  if (await userIsPresent(cfg)) return;
  const payload = buildNudge(cfg, req);
  if (process.env.PHONE_APPROVE_DRY_RUN === '1') { process.stderr.write(JSON.stringify(payload) + '\n'); return; }
  await publish(cfg, payload);
  fs.writeFileSync(stamp, String(Date.now()));
}

if (require.main === module) main().then(() => process.exit(0), () => process.exit(0));

module.exports = { buildNudge, shouldNudge };
