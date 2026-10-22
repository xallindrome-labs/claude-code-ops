#!/usr/bin/env node
// phone-approve: PermissionRequest hook that pages your phone via ntfy.
//
// Contract:
//   - stdin: hook JSON. stdout: allow/deny JSON, or NOTHING (normal dialog shows).
//   - Never allows by default. Timeout, error, or presence => no output.
//   - Notification body is a redacted summary only.
//   - Config: ~/.claude/phone-approve.json (create with `node phone-approve.js --init`).
//
// Env overrides (testing only): PHONE_APPROVE_FORCE_AWAY=1, PHONE_APPROVE_TIMEOUT_S,
// PHONE_APPROVE_DRY_RUN=1 (prints the ntfy payload to stderr, sends nothing).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'phone-approve.json');
const DEFAULTS = {
  server: 'https://ntfy.sh',
  timeoutSeconds: 600,
  skipWhenPresent: true,
  presenceSeconds: 120,
  skipTools: ['AskUserQuestion', 'ExitPlanMode'],
};

// ---------- pure functions (unit-tested) ----------

// The ONLY place that decides allow/deny. Returns 'allow' | 'deny' | null.
// Strict: the whole message must be exactly "<verb> <nonce>".
function decide(message, nonce) {
  if (typeof message !== 'string' || typeof nonce !== 'string' || nonce.length < 16) return null;
  const m = /^(allow|deny) ([0-9a-f]+)$/.exec(message.trim());
  if (!m || m[2] !== nonce) return null;
  return m[1];
}

function decisionOutput(verb) {
  if (verb === 'allow') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
  }
  if (verb === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied from phone' },
      },
    };
  }
  return null;
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_\-]{6,}/g, // OpenAI / Anthropic style
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}(?:\.[A-Za-z0-9_\-]*)?/g, // JWT
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=\-]{8,}/gi,
  /(:\/\/)[^\s\/:@]+:[^\s\/@]+@/g, // user:pass@host
  // KEY=value or --token value / --password=value for secret-ish names
  /\b([A-Za-z0-9_.\-]*(?:key|token|secret|passw(?:or)?d|pwd|auth|credential|cookie)[A-Za-z0-9_.\-]*)(\s*[=:]\s*|\s+)(["']?)[^\s"']+\3/gi,
];

// Replace anything token-like. Applied to the FULL string before truncation.
function redact(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(SECRET_PATTERNS[0], '[redacted]');
  s = s.replace(SECRET_PATTERNS[1], '[redacted]');
  s = s.replace(SECRET_PATTERNS[2], '[redacted]');
  s = s.replace(SECRET_PATTERNS[3], '[redacted]');
  s = s.replace(SECRET_PATTERNS[4], '[redacted]');
  s = s.replace(SECRET_PATTERNS[5], '[redacted]');
  s = s.replace(SECRET_PATTERNS[6], '$1 [redacted]');
  s = s.replace(SECRET_PATTERNS[7], '$1[redacted]@');
  s = s.replace(SECRET_PATTERNS[8], (m, name, sep, q) => `${name}${sep.includes('=') || sep.includes(':') ? sep : ' '}[redacted]`);
  // Generic: long opaque strings mixing letters and digits (not paths).
  s = s.replace(/[A-Za-z0-9_\-+=]{24,}/g, (tok) => (/[A-Za-z]/.test(tok) && /\d/.test(tok) ? '[redacted]' : tok));
  return s;
}

function oneLine(s, max) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

// Short, redacted summary. Never includes file contents or full commands.
function buildSummary(req) {
  const tool = typeof req.tool_name === 'string' ? req.tool_name : 'unknown tool';
  const input = (req && typeof req.tool_input === 'object' && req.tool_input) || {};
  let detail = '';
  if (tool === 'Bash' || tool === 'PowerShell') detail = input.command;
  else if (input.file_path || input.path || input.notebook_path) detail = input.file_path || input.path || input.notebook_path;
  else if (tool === 'WebFetch') detail = hostOf(input.url);
  else if (tool === 'WebSearch') detail = '';
  const project = req.cwd ? path.basename(String(req.cwd).replace(/[\\/]+$/, '')) : '';
  const parts = [];
  const d = oneLine(redact(detail || ''), 120);
  if (d) parts.push(d);
  if (project) parts.push(`in ${oneLine(redact(project), 40)}`);
  return { title: `Claude: ${oneLine(redact(tool), 60)}`, body: parts.join('\n') || '(no details)' };
}

function buildPayload(cfg, req, nonce) {
  const { title, body } = buildSummary(req);
  const replyUrl = `${cfg.server.replace(/\/+$/, '')}/${cfg.replyTopic}`;
  return {
    topic: cfg.requestTopic,
    title,
    message: body,
    priority: 4,
    tags: ['lock'],
    actions: [
      { action: 'http', label: 'Approve', url: replyUrl, method: 'POST', body: `allow ${nonce}`, clear: true },
      { action: 'http', label: 'Deny', url: replyUrl, method: 'POST', body: `deny ${nonce}`, clear: true },
    ],
  };
}

function loadConfig(raw) {
  const c = { ...DEFAULTS, ...(raw || {}) };
  const topicOk = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(t);
  if (!topicOk(c.requestTopic) || !topicOk(c.replyTopic) || c.requestTopic === c.replyTopic) return null;
  if (typeof c.server !== 'string' || !/^https:\/\//.test(c.server)) return null;
  c.timeoutSeconds = Number(c.timeoutSeconds);
  if (!(c.timeoutSeconds > 0) || c.timeoutSeconds > 640) c.timeoutSeconds = DEFAULTS.timeoutSeconds;
  return c;
}

// ---------- side effects ----------

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function idleSeconds() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const ps = `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Idle {
  [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
  public static uint Seconds() { var i = new LII(); i.cbSize = (uint)Marshal.SizeOf(i); if (!GetLastInputInfo(ref i)) return 99999; return ((uint)Environment.TickCount - i.dwTime) / 1000; }
}
'@
[Idle]::Seconds()`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10000, windowsHide: true }, (err, out) => {
      const n = err ? NaN : parseInt(String(out).trim(), 10);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

async function userIsPresent(cfg) {
  if (!cfg.skipWhenPresent || process.env.PHONE_APPROVE_FORCE_AWAY === '1') return false;
  const idle = await idleSeconds();
  return idle !== null && idle < cfg.presenceSeconds; // unknown => assume away and page
}

async function publish(cfg, payload) {
  const res = await fetch(cfg.server.replace(/\/+$/, '') + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`publish failed: HTTP ${res.status}`);
}

// Resolves 'allow' | 'deny' | null (timeout). Throws after repeated stream failures.
async function waitForReply(cfg, nonce, sinceSec, deadlineMs) {
  const url = `${cfg.server.replace(/\/+$/, '')}/${cfg.replyTopic}/json?since=${sinceSec}`;
  let failures = 0;
  while (Date.now() < deadlineMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1, deadlineMs - Date.now()));
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok || !res.body) throw new Error(`subscribe failed: HTTP ${res.status}`);
      failures = 0;
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.event !== 'message') continue;
          const verb = decide(ev.message, nonce);
          if (verb) return verb;
        }
      }
      // stream ended cleanly: reconnect
    } catch (e) {
      if (Date.now() >= deadlineMs) return null;
      if (++failures >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function initConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`${CONFIG_PATH} already exists; leaving it alone.`);
    return;
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const rnd = (p) => `${p}-${crypto.randomBytes(18).toString('base64url')}`;
  const cfg = { server: DEFAULTS.server, requestTopic: rnd('cc-req'), replyTopic: rnd('cc-rep'), timeoutSeconds: 600, skipWhenPresent: true, presenceSeconds: 120 };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  console.log(`Wrote ${CONFIG_PATH}. Subscribe the ntfy app to the requestTopic value in it.`);
}

async function main() {
  const raw = await readStdin();
  const req = JSON.parse(raw);
  let fileCfg;
  try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return; }
  const cfg = loadConfig(fileCfg);
  if (!cfg) return;
  if (process.env.PHONE_APPROVE_TIMEOUT_S) cfg.timeoutSeconds = Number(process.env.PHONE_APPROVE_TIMEOUT_S) || cfg.timeoutSeconds;
  if (req.hook_event_name && req.hook_event_name !== 'PermissionRequest') return;
  if (cfg.skipTools.includes(req.tool_name)) return;
  if (await userIsPresent(cfg)) return;

  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = buildPayload(cfg, req, nonce);
  if (process.env.PHONE_APPROVE_DRY_RUN === '1') {
    process.stderr.write(JSON.stringify(payload) + '\n');
    return;
  }
  const sinceSec = Math.floor(Date.now() / 1000) - 1;
  const deadline = Date.now() + cfg.timeoutSeconds * 1000;
  await publish(cfg, payload);
  const verb = await waitForReply(cfg, nonce, sinceSec, deadline);
  const out = decisionOutput(verb);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (require.main === module) {
  if (process.argv.includes('--init')) {
    initConfig();
  } else {
    main().then(() => process.exit(0), () => process.exit(0)); // any error => no output
  }
}

module.exports = { decide, decisionOutput, redact, buildSummary, buildPayload, loadConfig, userIsPresent, publish, CONFIG_PATH };
