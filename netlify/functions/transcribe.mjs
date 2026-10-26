import { timingSafeEqual } from 'node:crypto';

const json = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const configured = () => !!(process.env.OPENAI_API_KEY && process.env.LISTEN_ACCESS_CODE);
const sameCode = (value) => {
  const a = Buffer.from(value || '');
  const b = Buffer.from(process.env.LISTEN_ACCESS_CODE || '');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

export default async function transcribe(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') return json(200, { configured: configured(), provider: 'OpenAI', clipSeconds: 8 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (request.headers.get('origin') !== url.origin) return json(403, { error: 'Open the listening page directly on this site.' });
  if (!configured()) return json(503, { error: 'Cloud listening is not configured by the site owner yet.' });
  if (!sameCode(request.headers.get('x-listen-code'))) return json(401, { error: 'The listening code is incorrect. Ask the site owner for access.' });
  if (request.headers.get('content-type') !== 'audio/wav') return json(415, { error: 'A PCM WAV recording is required.' });
  // Bound the request as it streams, even without Content-Length.
  const limit = 44 + 16000 * 2 * 12;
  const reader = request.body?.getReader();
  if (!reader) return json(400, { error: 'No audio was received.' });
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); return json(413, { error: 'Audio clips must be at most 12 seconds.' }); }
    chunks.push(Buffer.from(value));
  }
  const wav = Buffer.concat(chunks);
  // The browser sends our fixed 16kHz/mono/16-bit WAV format only.
  if (wav.length < 32044 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
      || wav.toString('ascii', 12, 16) !== 'fmt ' || wav.readUInt32LE(16) !== 16
      || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000
      || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data'
      || wav.readUInt32LE(40) !== wav.length - 44 || wav.readUInt32LE(4) !== wav.length - 8) {
    return json(400, { error: 'The audio format is invalid.' });
  }
  const form = new FormData();
  form.set('file', new Blob([wav], { type: 'audio/wav' }), 'paath.wav');
  form.set('model', 'gpt-transcribe');
  form.append('languages[]', 'pa');
  form.set('prompt', 'ਇਹ ਗੁਰਬਾਣੀ ਦਾ ਪਾਠ ਜਾਂ ਕੀਰਤਨ ਹੈ। ਸੁਣੇ ਹੋਏ ਸ਼ਬਦ ਗੁਰਮੁਖੀ ਲਿਪੀ ਵਿੱਚ ਲਿਖੋ। ਸੰਗੀਤ ਦਾ ਵਰਣਨ ਨਾ ਕਰੋ ਅਤੇ ਨਾ ਸੁਣੇ ਸ਼ਬਦ ਨਾ ਜੋੜੋ।');
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form, signal: AbortSignal.timeout(22000),
    });
    if (!response.ok) return json(response.status === 429 ? 429 : 502, { error: response.status === 429
      ? 'Transcription usage limit reached. Stop listening and try later.'
      : 'The transcription service could not process this clip. The site owner should check API access and billing.' });
    const data = await response.json();
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 3000) : '';
    // Non-Gurmukhi labels like “sad music” must not look like successful recognition.
    const words = text.match(/[\u0A05-\u0A39\u0A59-\u0A5E\u0A72\u0A73][\u0A00-\u0A7F]*/g) || [];
    return json(200, { text: words.length >= 2 ? text : '', recognized: words.length >= 2 });
  } catch { return json(504, { error: 'Transcription timed out. Check your connection and tap Listen to retry.' }); }
}

export const config = { rateLimit: { action: 'rate_limit', windowSize: 60, windowLimit: 15, aggregateBy: ['ip', 'domain'] } };
