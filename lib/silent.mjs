// Silent Chinese-language loading for the Claude desktop app (Windows, 3p Gateway mode).
// Everything here talks to Claude's DevTools protocol on 127.0.0.1 only. No DevTools
// window, no file dialog, no simulated keystrokes and no foreground focus are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FRONTEND = 'app://localhost';
const DEFAULT_PORT = 9333;

export const DEFAULTS = { port: DEFAULT_PORT, timeoutMs: 120_000, pollMs: 1_000 };

// The upstream plugin owns catalog discovery, the language runtime and the
// payload builder. Resolve it from wherever the host installed it. Its
// package.json is not exported, so locate it by path instead of by name.
export function loadUpstream(from = import.meta.url) {
  const tried = [];
  const seeds = [from, process.cwd(), path.join(os.homedir(), '.config', 'magpie', 'plugins')];
  const roots = new Set();
  for (const seed of seeds) {
    let dir = path.resolve(seed);
    for (let i = 0; i < 5; i++) {
      roots.add(path.join(dir, 'node_modules'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const { pathToFileURL } = require('node:url');
  for (const nodeModules of roots) {
    for (const name of ['magpie-claude-zh', 'claude-desktop-zh']) {
      const root = path.join(nodeModules, name);
      const lib = path.join(root, 'lib', 'runtime-localization.mjs');
      if (fs.existsSync(lib)) {
        return {
          root,
          async lib() { return import(pathToFileURL(lib).href); },
          async discover() { return import(pathToFileURL(path.join(root, 'lib', 'discover.mjs')).href); },
        };
      }
      tried.push(root);
    }
  }
  throw new Error('magpie-claude-zh is not installed next to this plugin. Install github:jk-uzi/claude-desktop-zh-win first. Tried: ' + tried.slice(0, 3).join(', '));
}

// Locate the packaged Claude.exe (MSIX). Its version changes with every update,
// so never hardcode one path. Listing WindowsApps is denied for a normal user, so
// ask the package manager (same query the upstream plugin uses) and remember the
// answer until that exe disappears.
const EXE_CACHE = path.join(os.homedir(), 'AppData', 'Local', 'claude-desktop-3p-zh', 'claude-exe.txt');

function describe(root) {
  const exe = path.join(root, 'app', 'Claude.exe');
  if (!fs.existsSync(exe)) return null;
  const version = (path.basename(root).match(/^Claude_(\d+(?:\.\d+)*)_/i) || [])[1] || '0';
  return { exe, version, source: path.join(root, 'app', 'resources') };
}

export function findClaudeExe() {
  const cached = (() => { try { return fs.readFileSync(EXE_CACHE, 'utf8').trim(); } catch { return ''; } })();
  const hit = cached ? describe(cached) : null;
  if (hit) return hit;
  let roots = [];
  try {
    const out = require('node:child_process').execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-AppxPackage -Name Claude | ForEach-Object { $_.InstallLocation }'],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15_000 });
    roots = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { roots = []; }
  const found = roots.map(describe).filter(Boolean);
  if (!found.length) return null;
  found.sort((a, b) => { for (let i = 0; i < 4; i++) { const d = (b.version.split('.')[i] || 0) - (a.version.split('.')[i] || 0); if (d) return d; } return 0; });
  const best = found[0];
  try { fs.mkdirSync(path.dirname(EXE_CACHE), { recursive: true }); fs.writeFileSync(EXE_CACHE, path.dirname(path.dirname(best.exe))); } catch {}
  return best;
}

function httpJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request(url, { method: 'GET', timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export function portOpen(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise(resolve => {
    const net = require('node:net');
    const s = net.connect({ host, port });
    const done = v => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function listTargets(port) {
  try { return await httpJson(`http://127.0.0.1:${port}/json/list`); } catch { return []; }
}

// The main window page over secondary ones (settings / setup windows live deeper).
export function pickFrontend(targets) {
  const pages = targets.filter(t => t?.type === 'page' && String(t.url || '').startsWith(FRONTEND));
  if (!pages.length) return null;
  pages.sort((a, b) => String(a.url).split('/').length - String(b.url).split('/').length || a.url.length - b.url.length);
  return pages[0];
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.closed = false;
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || 'CDP error')); else p.resolve(m.result || {});
    });
    ws.addEventListener('close', () => { this.closed = true; for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed')); this.pending.clear(); });
    ws.addEventListener('error', () => {});
  }
  static async connect(url, timeoutMs = 10_000) {
    if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Only loopback DevTools endpoints are allowed.');
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('DevTools connect timeout')); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', e => { clearTimeout(t); reject(new Error('DevTools connect failed')); }, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, timeoutMs = 60_000) {
    if (this.closed) return Promise.reject(new Error('DevTools connection closed'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function evaluate(cdp, expression, { awaitPromise = true, timeoutMs = 60_000 } = {}) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout: timeoutMs }, timeoutMs + 5000);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page error: ' + (d.exception?.description || d.text || 'unknown').slice(0, 300));
  }
  return r.result?.value;
}

// Build the payload for the installed Claude version through the upstream
// plugin, then evaluate it. The catalog travels inline (the upstream
// runtimeAutomationSource embeds it), so no file picker is ever involved.
export async function buildPayload(upstream, { locale = 'zh-Hans', workDir } = {}) {
  const lib = await upstream.lib();
  const claude = findClaudeExe();
  if (!claude) throw new Error('Claude.exe not found under WindowsApps.');
  const out = path.join(workDir, `language-${Date.now()}.js`);
  fs.mkdirSync(workDir, { recursive: true });
  // Writes <out>, <out>.spec.json, <out>.picker.js, <out>.automation.js, <out>.automation.json
  const built = await lib.buildRuntimeLocalization(claude.source, catalogDirectory(upstream), locale, out);
  const spec = JSON.parse(fs.readFileSync(built.specOutput, 'utf8'));
  const marker = 'CLAUDE_ZH_APPLIED_' + require('node:crypto').randomUUID().replaceAll('-', '');
  const script = lib.runtimeAutomationSource(spec, marker);
  return { script, marker, built, files: [out, built.specOutput, built.pickerOutput, built.automationManifest] };
}

function catalogDirectory(upstream) {
  const local = path.join(upstream.root, '.catalogs');
  return fs.existsSync(local) ? local : path.join(os.homedir(), 'AppData', 'Local', 'claude-desktop-3p-zh', 'catalogs');
}

export async function isApplied(cdp) {
  return await evaluate(cdp, '!!(globalThis.claudeChineseRuntime)', { awaitPromise: false, timeoutMs: 5000 });
}

// Wait for the main app://localhost page, then build and inject once. Building
// takes seconds, so it only happens once a page is actually there. Resolves with a report.
export async function inject({ upstream, port = DEFAULT_PORT, locale = 'zh-Hans', timeoutMs = DEFAULTS.timeoutMs, workDir, log = () => {} } = {}) {
  const started = Date.now();
  let target = null, cdp = null, payload = null, portWasOpen = false;
  while (Date.now() - started < timeoutMs) {
    const t = pickFrontend(await listTargets(port));
    if (t) { target = t; break; }
    // Closed right after launch is normal; only give up once the port was open and then went away.
    if (portWasOpen) { if (!(await portOpen(port))) return { state: 'claude-exited', elapsedMs: Date.now() - started }; }
    else if (Date.now() - started > 10_000) portWasOpen = await portOpen(port);
    await sleep(1000);
  }
  if (!target) return { state: 'timeout', error: 'no app://localhost page target' };
  try { payload = await buildPayload(upstream, { locale, workDir }); log(`payload built for ${payload.built.runtimeUrl}`); }
  catch (e) { log(`payload build failed: ${e.message}`); return { state: 'payload-failed', error: e.message }; }
  // The page may have navigated while the payload was being built; re-resolve it.
  target = pickFrontend(await listTargets(port)) || target;
  log(`frontend ${target.url}`);
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  try {
    if (await isApplied(cdp)) { log('already applied'); return { state: 'applied', already: true, targetId: target.id, files: payload.files }; }
    let last = null;
    await evaluate(cdp, payload.script, { awaitPromise: true, timeoutMs: 45_000 }).catch(e => { last = e; });
    const ok = await evaluate(cdp, `(globalThis.claudeChineseRuntime||{}).locale||''`, { awaitPromise: false, timeoutMs: 5000 });
    log(`runtime locale ${ok}`);
    if (ok === locale) return { state: 'applied', already: false, targetId: target.id, elapsedMs: Date.now() - started, files: payload.files };
    return { state: 'not-acknowledged', locale: ok, targetId: target.id, error: last?.message, files: payload.files };
  } finally { cdp.close(); }
}

export function launchClaude({ port = DEFAULT_PORT } = {}) {
  const claude = findClaudeExe();
  if (!claude) throw new Error('Claude.exe not found under WindowsApps.');
  const child = spawn(claude.exe, ['--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], {
    detached: true, stdio: 'ignore', windowsHide: true, shell: false, cwd: path.dirname(claude.exe),
  });
  child.on('error', () => {});
  child.unref();
  return { exe: claude.exe, version: claude.version, port };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
