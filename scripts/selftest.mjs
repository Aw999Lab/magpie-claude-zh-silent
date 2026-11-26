// Offline self-check: build the payload through the upstream plugin exactly as the
// injector does, without touching any running Claude. Nothing is injected.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPayload, findClaudeExe, loadUpstream, pickFrontend } from '../lib/silent.mjs';

const upstream = loadUpstream(path.join(os.homedir(), '.config', 'magpie', 'plugins', 'node_modules', 'magpie-claude-zh', 'x'));
console.log('upstream  :', upstream.root);
const claude = findClaudeExe();
console.log('claude exe:', claude?.exe, '| version', claude?.version);
const work = path.join(os.tmpdir(), 'magpie-claude-zh-silent', 'selftest');
const t0 = Date.now();
const p = await buildPayload(upstream, { locale: 'zh-Hans', workDir: work });
console.log('build ms  :', Date.now() - t0);
console.log('runtime   :', p.built.runtimeUrl, '| base', p.built.baseMessages, '| dynamic', p.built.dynamicMessages);
console.log('script B  :', p.script.length);
console.log('has file picker  :', p.script.includes('input.click'));
console.log('has spec inline  :', p.script.includes('activateRuntimeCatalog') || p.script.includes('setLocaleOverride'));
console.log('has marker       :', p.script.includes(p.marker));
console.log('frontend pick    :', JSON.stringify(pickFrontend([
  { type: 'page', url: 'app://localhost/new' }, { type: 'page', url: 'app://localhost/epitaxy?x' },
  { type: 'page', url: 'app://localhost/setup-desktop-3p' }, { type: 'webview', url: 'app://localhost/x' },
])));
