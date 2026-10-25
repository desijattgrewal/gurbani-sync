// Pinned runtime; single-threaded WASM works without cross-origin isolation on iOS.
let transcriber;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        device: 'wasm', dtype: 'q8',
        progress_callback: (progress) => {
          if (progress.status === 'progress') self.postMessage({ type: 'progress',
            text: 'Preparing listening… Downloading the speech model for this device.' });
        },
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'transcribe') {
      const result = await transcriber(data.audio, {
        language: 'punjabi', task: 'transcribe', max_new_tokens: 96,
      });
      self.postMessage({ type: 'text', text: result.text || '' });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `On-device listening could not start: ${error.message}. Check your connection and tap Listen to retry.` });
  }
};
