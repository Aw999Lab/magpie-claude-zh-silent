import os from 'node:os';
import path from 'node:path';
import { inject, launchClaude, loadUpstream, portOpen, DEFAULTS } from '../../lib/silent.mjs';

const stateDirectory = path.join(os.tmpdir(), 'magpie-claude-zh-silent');

// Only plugin factories may be exported here: the host invokes every export.
// Same shape as the upstream plugin: the watcher starts inside the factory.
export const ClaudeChineseSilentPlugin = async (_input, options = {}) => {
  const locale = options.locale === 'zh-Hant' ? 'zh-Hant' : 'zh-Hans';
  const port = Number(options.port) > 0 && Number(options.port) < 65536 ? Number(options.port) : DEFAULTS.port;
  const logLines = [];
  const log = line => { logLines.push(`${new Date().toISOString()} ${line}`); if (logLines.length > 200) logLines.shift(); };
  let upstream = null, busy = false, timer = null, last = { state: 'idle' };
  const state = () => ({ ...last, busy, port, locale, automaticNextLaunch: !!timer });

  function upstreamOrThrow() {
    if (!upstream) upstream = loadUpstream(_input?.directory || import.meta.url);
    return upstream;
  }
  async function run() {
    if (busy) return { ...last, busy: true };
    busy = true;
    try { last = await inject({ upstream: upstreamOrThrow(), port, locale, workDir: stateDirectory, log }); }
    catch (e) { last = { state: 'error', error: e.message }; log(e.message); }
    finally { busy = false; }
    return last;
  }
  function start() {
    if (options.runtimeAutoLoad === false || timer) return state();
    timer = setInterval(async () => {
      if (busy || !(await portOpen(port))) return;
      busy = true;
      try { last = await inject({ upstream: upstreamOrThrow(), port, locale, workDir: stateDirectory, log }); }
      catch (e) { last = { state: 'error', error: e.message }; log(e.message); }
      finally { busy = false; }
      // This Claude instance carries the language runtime now; nothing left to watch.
      if (last.state === 'applied') { clearInterval(timer); timer = null; }
    }, DEFAULTS.pollMs * 3);
    timer.unref?.();
    return state();
  }
  void start();

  return {
    tool: {
      claude_zh_silent_launch: {
        description: 'Start the Claude desktop app (Windows, 3p Gateway mode) with Chinese UI and no DevTools window or file dialog. Ask the human first, then pass confirm="launch".',
        args: { type: 'object', properties: { confirm: { type: 'string', enum: ['launch'] } }, additionalProperties: false, required: ['confirm'] },
        execute: async ({ confirm }) => {
          if (confirm !== 'launch') throw new Error('Confirm the exact action.');
          if (await portOpen(port)) return JSON.stringify({ state: 'already-running', ...await run() }, null, 2);
          const started = launchClaude({ port });
          return JSON.stringify({ started, ...await inject({ upstream: upstreamOrThrow(), port, locale, workDir: stateDirectory, log }) }, null, 2);
        }
      },
      claude_zh_silent_status: {
        description: '查看静默汉化状态：是否已加载、调试端口、日志尾部。',
        args: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => JSON.stringify({ ...state(), portOpen: await portOpen(port), log: logLines.slice(-10) }, null, 2)
      }
    }
  };
};
