// On-device fallback: audio stays in this browser; the model is downloaded on first use.
class LocalGurbaniListener {
  constructor({ onText, onStatus, onError }) {
    Object.assign(this, { onText, onStatus, onError, active: false, session: 0 });
  }

  async start() {
    this.active = true;
    const session = ++this.session;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access needs a secure HTTPS connection. Open https://gurbanisync.com and try again.');
      }
      // Create/resume during the tap so iOS permits audio processing.
      const Audio = window.AudioContext || window.webkitAudioContext;
      this.context = new Audio();
      const resumed = this.context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true,
      } });
      if (!this.active || session !== this.session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      await resumed;
      this.onStatus('Preparing listening on this device… The first use downloads a speech model.');
      this.worker = new Worker('speech-worker.js?v=2', { type: 'module' });
      this.worker.onerror = () => this.fail('Could not load on-device listening. Check your connection and try again.', session);
      this.worker.onmessage = ({ data }) => {
        if (!this.active || session !== this.session) return;
        if (data.type === 'ready') this.capture(session);
        if (data.type === 'progress') this.onStatus(data.text);
        if (data.type === 'text') {
          this.busy = false;
          this.onStatus('Listening on this device…');
          if (data.text.trim()) this.onText(data.text);
        }
        if (data.type === 'error') this.fail(data.message, session);
      };
      this.worker.postMessage({ type: 'load' });
    } catch (error) {
      const message = error.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow microphone access for this website in your browser settings, then tap Listen again.'
        : error.message;
      this.fail(message, session);
    }
  }

  capture(session) {
    if (!this.active || session !== this.session) return;
    const context = this.context;
    const source = this.source = context.createMediaStreamSource(this.stream);
    // A small callback only copies audio; inference runs off the UI thread.
    const processor = this.processor = context.createScriptProcessor(4096, 1, 1);
    const mute = this.mute = context.createGain();
    mute.gain.value = 0;
    this.samples = new Float32Array(Math.ceil(context.sampleRate * 8));
    this.filled = 0;
    this.sinceLast = 0;
    this.busy = false;
    processor.onaudioprocess = (event) => {
      if (!this.active) return;
      const input = event.inputBuffer.getChannelData(0);
      this.samples.copyWithin(0, input.length);
      this.samples.set(input, this.samples.length - input.length);
      this.filled = Math.min(this.samples.length, this.filled + input.length);
      this.sinceLast += input.length;
      if (this.busy || this.filled < this.samples.length || this.sinceLast < context.sampleRate * 5) return;
      this.sinceLast = 0;
      let energy = 0;
      for (const sample of this.samples) energy += sample * sample;
      if (Math.sqrt(energy / this.samples.length) < 0.003) return;
      const audio = resampleSpeech(this.samples, context.sampleRate);
      this.busy = true;
      this.onStatus('Recognising Gurbani on this device…');
      this.worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.onStatus('Listening on this device… Hold the microphone close to the paath.');
  }

  fail(message, session) {
    if (!this.active || session !== this.session) return;
    this.stop();
    this.onError(message);
  }

  stop() {
    this.active = false;
    ++this.session;
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close().catch(() => {});
    this.worker?.terminate();
    this.source = this.processor = this.mute = this.stream = this.context = this.worker = null;
    this.samples = null;
  }
}

function resampleSpeech(samples, rate) {
  const ratio = rate / 16000;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    output[i] = sum / (to - from);
  }
  return output;
}
