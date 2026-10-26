# Cloud listening pilot

The iPhone local model is returning labels such as “sad music” instead of Gurbani.
This change adds an opt-in cloud transcription route using OpenAI's `gpt-transcribe`
Audio API, a Punjabi language hint, and a Gurmukhi prompt. Accuracy on sung Gurbani
must still be measured with representative recordings; no successful live test is claimed.

## Netlify deployment

This requires a **Netlify build with Functions**, not another static Netlify Drop upload.
Connect this repository (or the feature branch for a preview) to the existing project.
The committed netlify.toml runs `node build.mjs`, publishes only `dist`, and bundles
`netlify/functions`. No Node dependencies are required. Node 22 is configured.
GitHub Pages can continue serving the static site; cloud listening won't enable there.

In Netlify's Environment variables, set these server-side values with Functions scope:

- `OPENAI_API_KEY`: your OpenAI API project key, with access to the transcription model
  and API billing enabled. Never paste this into chat, the frontend, or GitHub.
- `LISTEN_ACCESS_CODE`: a long, random private pilot code; share only with testers.

Redeploy after setting variables. GET `/.netlify/functions/transcribe` should return
`configured: true` (only presence is reported, never secret values). Without both
variables, all transcription POST requests fail closed and no audio is sent to OpenAI.

Open the site, choose **Use cloud listening**, read the audio disclosure, enter the pilot
code, and press **Allow audio to OpenAI & listen**. This tap starts microphone access.
The browser sends rolling eight-second, 16kHz mono PCM WAV clips. One upload runs at a
time. Stop closes the microphone and aborts the browser request; provider work already
received can still complete and be billed. A listening session stops after ten minutes.

No audio or transcripts are intentionally persisted or logged by this function. Netlify
and OpenAI have their own data policies. API keys remain server-side. The service applies
same-origin checks, a pilot code, bounded WAV validation, generic upstream errors and
Netlify per-IP/domain rate limiting (15 requests per minute). A shared pilot code is not
full user authentication or a global spending cap: use project billing controls and
monitor usage before wider release. Do not enable without owner approval of API costs.

## Validation and acceptance

Run `node --test tools/listener.test.cjs tools/transcribe.test.mjs` and `node build.mjs`.
Tests use mocked provider responses and do not send audio or spend API credits.

Before wider use, on a physical iPhone:

1. Confirm consent cancellation never starts recording or uploads.
2. Speak a known Gurbani line, verify the Gurmukhi transcript and correct shabad.
3. Repeat with actual kirtan including instruments and repeated lines.
4. Select Slideshow, verify a match opens it and following advances correctly.
5. Stop, background, and close the tab; verify microphone indication clears.
6. Test wrong pilot code, denied microphone, lost internet, API timeout and quota errors.

The desktop browser's existing recognition path remains the default. Cloud listening
is a session-only choice. Gurmukhi transcripts use the same matcher and display selection.
