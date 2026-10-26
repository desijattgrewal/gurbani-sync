// Uses the same bounded rolling audio capture as the local fallback. Only the
// transcription transport changes. No API key is ever sent to this browser.
function speechWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767)), true));
  return new Blob([buffer], { type: 'audio/wav' });
}

class CloudGurbaniListener extends LocalGurbaniListener {
  constructor(options) { super(options); this.cloud = true; this.code = options.code; }
  async prepare(session) {
    const abort = new AbortController();
    this.worker = { terminate: () => { abort.abort(); clearTimeout(this.limitTimer); }, postMessage: async ({ audio }) => {
      try {
        const response = await fetch('/.netlify/functions/transcribe', {
          method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Listen-Code': this.code },
          body: speechWav(audio), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(28000)]),
        });
        const data = await response.json();
        if (!this.active || session !== this.session) return;
        if (!response.ok) { this.fail(data.error || 'Cloud listening is unavailable.', session); return; }
        this.busy = false;
        if (data.recognized && data.text) {
          this.onStatus('Listening… Audio clips are sent to OpenAI.');
          this.onText(data.text);
        } else this.onStatus('No clear Gurbani words yet. Move closer to the voice and try a spoken line of paath.');
      } catch (error) {
        if (error.name !== 'AbortError') this.fail('Transcription connection failed. Tap Listen to retry.', session);
      }
    } };
    this.limitTimer = setTimeout(() => this.fail('This 10-minute listening session has ended. Tap Listen to start another.', session), 600000);
    this.capture(session);
  }
}
