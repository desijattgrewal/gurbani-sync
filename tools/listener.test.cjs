const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup({ secure = true, recognition, getUserMedia } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', value: '', checked: false,
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, children: [], querySelector: () => null, querySelectorAll: () => [],
    });
    return elements.get(id);
  };
  const stats = { stopped: 0, closed: 0, terminated: 0, posted: [], workers: [] };
  const stream = { getTracks: () => [{ stop() { stats.stopped++; } }] };
  class AudioContext {
    sampleRate = 48000;
    destination = {};
    resume() { return Promise.resolve(); }
    close() { stats.closed++; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  }
  class Worker {
    constructor() { stats.workers.push(this); }
    postMessage(message) { stats.posted.push(message); }
    terminate() { stats.terminated++; }
  }
  const sandbox = {
    console, setTimeout, clearTimeout, Float32Array, Worker,
    window: { isSecureContext: secure, AudioContext, SpeechRecognition: recognition, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    document: { querySelector: element, querySelectorAll: () => [], body: element('body'), documentElement: element('html'), addEventListener() {} },
    store: { get: () => null, set() {} }, UPCOMING_LINES: 2,
    createSlideshow: () => ({ addAction: () => element('slidesMic'), setStatus() {}, isOpen: false }),
    ResizeObserver: class { observe() {} },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'listener.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  return { context, stats, element, run: (code) => vm.runInContext(code, context) };
}

test('iPhone without speech API still gets microphone controls and starts local listener', async () => {
  const { run, element, stats } = setup();
  assert.equal(element('#listenHero').hidden, false);
  assert.equal(element('#unsupported').hidden, true);
  run('startListening()');
  await new Promise(setImmediate);
  assert.equal(stats.workers.length, 1);
  assert.equal(stats.posted[0].type, 'load');
  stats.workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(run('listening.on'), true);
  run('stopListening()');
  assert.equal(stats.stopped, 1);
  assert.equal(stats.closed, 1);
  assert.equal(stats.terminated, 1);
});

test('insecure HTTP explains HTTPS instead of blaming the browser', () => {
  const { run, element, stats } = setup({ secure: false });
  run('startListening()');
  assert.equal(run('listening.on'), false);
  assert.match(element('#unsupported').textContent, /HTTPS/);
  assert.equal(stats.workers.length, 0);
});

test('stop while permission is pending releases the late stream', async () => {
  let resolve;
  const { run, stats } = setup({ getUserMedia: () => new Promise((r) => { resolve = r; }) });
  run('startListening(); stopListening()');
  resolve({ getTracks: () => [{ stop() { stats.stopped++; } }] });
  await new Promise(setImmediate);
  assert.equal(stats.stopped, 1);
  assert.equal(stats.workers.length, 0);
});

test('permission denial restores idle controls with an actionable error', async () => {
  const { run, element, stats } = setup({ getUserMedia: async () => { const e = new Error(); e.name = 'NotAllowedError'; throw e; } });
  run('startListening()');
  await new Promise(setImmediate);
  assert.equal(run('listening.on'), false);
  assert.match(element('#status').textContent, /device refused microphone/);
  assert.equal(stats.closed, 1);
});

test('built-in unsupported-language failure switches to local listening', async () => {
  let rec;
  class Recognition { constructor() { rec = this; } start() {} abort() {} stop() {} }
  const { run, stats } = setup({ recognition: Recognition });
  run('startListening()');
  rec.onerror({ error: 'language-not-supported' });
  await new Promise(setImmediate);
  assert.equal(stats.workers.length, 0);
  assert.equal(run('listening.on'), false);
  run('startListening()');
  await new Promise(setImmediate);
  assert.equal(stats.workers.length, 1);
  run('stopListening()');
});

test('audio is resampled to 16kHz without changing a constant signal', () => {
  const { run } = setup();
  assert.equal(run('resampleSpeech(new Float32Array(48000).fill(0.5), 48000).length'), 16000);
  assert.equal(run('resampleSpeech(new Float32Array(44100).fill(0.5), 44100).every(x => x === 0.5)'), true);
});
