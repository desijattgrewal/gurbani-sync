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

test('restored listening uses the native Punjabi service without a local model', () => {
  let rec;
  class Recognition { constructor() { rec = this; } start() { this.started = true; } stop() { this.stopped = true; } }
  const { run, stats } = setup({ recognition: Recognition });
  run('startListening()');
  assert.equal(rec.started, true);
  assert.equal(rec.lang, 'pa-IN');
  assert.equal(stats.workers.length, 0);
  run('stopListening()');
  assert.equal(rec.stopped, true);
});

test('a service rejection never starts Whisper or asks for a paid service', () => {
  let rec;
  class Recognition { constructor() { rec = this; } start() {} stop() {} }
  const { run, stats, element } = setup({ recognition: Recognition });
  run('startListening()');
  rec.onerror({ error: 'service-not-allowed' });
  assert.equal(run('listening.on'), false);
  assert.equal(stats.workers.length, 0);
  assert.match(element('#status').textContent, /service is unavailable/);
});

test('the restored matcher still opens a shabad as a slideshow', async () => {
  class Recognition { start() {} stop() {} }
  const { run, context } = setup({ recognition: Recognition });
  context.gurmukhiWords = text => text.split(' ');
  context.makeQuery = text => ({ words: text.split(' ') });
  run(`searchGurmukhi = async () => [{ score: 0.99, v: { shabadId: 42, verseId: 10, verse: { unicode: 'ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ' } } }];
    fetchShabad = async () => ({});
    openResult = async (result, mode) => { globalThis.openedMatch = { result, mode }; };
    startListening(); listening.text = 'ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ';`);
  await run('checkHeard()');
  assert.equal(context.openedMatch.mode, 'slides');
  assert.equal(context.openedMatch.result.shabadId, 42);
  run('stopListening()');
});
