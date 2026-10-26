import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import transcribe from '../netlify/functions/transcribe.mjs';
const ctx = vm.createContext({ LocalGurbaniListener: class {}, Blob, ArrayBuffer, DataView, Math });
vm.runInContext(readFileSync(new URL('../cloud-listener.js', import.meta.url), 'utf8'), ctx);
const wav = () => vm.runInContext('speechWav(new Float32Array(16000 * 8).fill(0.1))', ctx);
const request = (body, extra = {}) => new Request('https://example.netlify.app/.netlify/functions/transcribe', {
  method: 'POST', body, headers: { Origin: 'https://example.netlify.app', 'Content-Type': 'audio/wav', 'X-Listen-Code': 'test-code', ...extra },
});

test('cloud endpoint fails closed without owner configuration', async () => {
  delete process.env.OPENAI_API_KEY; delete process.env.LISTEN_ACCESS_CODE;
  assert.equal((await transcribe(new Request('https://example.netlify.app/.netlify/functions/transcribe'))).status, 200);
  assert.equal((await (await transcribe(new Request('https://example.netlify.app/.netlify/functions/transcribe'))).json()).configured, false);
  assert.equal((await transcribe(request(wav()))).status, 503);
});

test('cloud validates access, origin, audio and strips non-Gurmukhi labels', async () => {
  process.env.OPENAI_API_KEY = 'fake-key-for-mocked-tests';
  process.env.LISTEN_ACCESS_CODE = 'test-code';
  const original = globalThis.fetch;
  let calls = 0;
  let output = 'ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ';
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.body.get('model'), 'gpt-transcribe');
    assert.equal(options.body.get('languages[]'), 'pa');
    assert.equal(options.body.get('file').size, 256044);
    return Response.json({ text: output });
  };
  try {
    assert.equal((await transcribe(request(wav(), { 'X-Listen-Code': 'wrong' }))).status, 401);
    assert.equal((await transcribe(request(wav(), { Origin: 'https://other.example' }))).status, 403);
    assert.equal((await transcribe(request(new Blob(['not wav'])))).status, 400);
    assert.equal((await transcribe(request(new Blob([new Uint8Array(400000)])))).status, 413);
    assert.equal(calls, 0);
    const data = await (await transcribe(request(wav()))).json();
    assert.equal(data.recognized, true);
    assert.equal(data.text, output);
    output = '*sad music*';
    assert.deepEqual(await (await transcribe(request(wav()))).json(), { text: '', recognized: false });
    globalThis.fetch = async () => new Response('private provider error', { status: 401 });
    const error = await transcribe(request(wav()));
    assert.equal(error.status, 502);
    assert.doesNotMatch(await error.text(), /private provider error|fake-key/);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY; delete process.env.LISTEN_ACCESS_CODE;
  }
});
