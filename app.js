// Gurbani Sync: search for a shabad or bani, then show it as a slideshow (one line at a time)
// or in full. Text comes from BaniDB (Khalis Foundation); the Panj Baniyan are saved in banis/.

const $ = (sel) => document.querySelector(sel);
const GURMUKHI = /[਀-੿]/;

const state = {
  results: [], // [{ kind: 'bani', id, gm, en } | { kind: 'shabad', shabadId, verseId, gm, meta }]
  view: null,  // what's open: { result, title, meta, lines, current }
  mode: store.get('paath:openAs') === 'full' ? 'full' : 'slides', // how a result opens
  searchSeq: 0,
};

// While listening, an empty status falls back to saying so.
function setStatus(msg) {
  $('#status').textContent = msg || (listening.on ? 'Listening…' : '');
  updateLayout();
}

// ---------- BaniDB ----------

// Answers are kept for reuse, but only the most recent ones: listening searches several times
// a second, and keeping every answer filled the phone's memory within minutes until iOS
// closed the page.
function remember(cache, key, value, limit) {
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value); // the oldest
  return value;
}
function recall(cache, key) {
  const value = cache.get(key);
  if (value !== undefined) { cache.delete(key); cache.set(key, value); } // now the newest
  return value;
}

const searchCache = new Map();
function searchBaniDB(query, type, source = 'all', results = 100) {
  const key = `${type}:${source}:${results}:${query}`;
  const kept = recall(searchCache, key);
  if (kept) return kept;
  const url = `${API}/search/${encodeURIComponent(query)}?searchtype=${type}&source=${source}&results=${results}`;
  const answer = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`BaniDB returned ${r.status}`);
    return r.json();
  }).then((d) => d.verses || []).catch(() => {
    searchCache.delete(key); // a failed search is tried again next time, not remembered as "no match"
    return [];
  });
  return remember(searchCache, key, answer, 300);
}

const shabadCache = new Map();
function fetchShabad(id) {
  const kept = recall(shabadCache, id);
  if (kept) return kept;
  const shabad = fetch(`${API}/shabads/${id}`).then((r) => {
    if (!r.ok) throw new Error(`BaniDB returned ${r.status}`);
    return r.json();
  }).catch((err) => { shabadCache.delete(id); throw err; });
  return remember(shabadCache, id, shabad, 50);
}

const verseMeta = (v) => [
  v.source?.english,
  v.pageNo ? `Ang ${v.pageNo}` : null,
  v.raag?.english,
  v.writer?.english,
].filter(Boolean).join(' · ');

// ---------- searching ----------

// Each search returns matching lines best first, as [{ v: BaniDB verse, score }].

// Gurmukhi words or first letters: a few overlapping runs of first letters go to BaniDB's
// first-letter search, so one wrong word doesn't sink it, then every candidate is ranked by
// how well it matches what was typed (0 to 1).
async function searchGurmukhi(text) {
  const query = makeQuery(text);
  const L = query.letters;
  const n = L.length;
  if (n < 2) return [];
  // Longer runs are rare, so they come back small and fast. Three letters match thousands of
  // lines (a slow, 400 KB answer), so short runs are only used when there's nothing longer.
  const sizes = n >= 5 ? [Math.min(n, 6), 4] : [n, Math.min(n, 3)];
  const runs = new Set();
  for (const k of sizes) {
    for (const o of [0, Math.floor((n - k) / 2), n - k]) runs.add(L.slice(o, o + k).join(''));
  }
  const lists = await Promise.all([...runs].map((r) => searchBaniDB(r, 1, 'all', r.length >= 5 ? 30 : 100)));
  return lists.flat()
    .map((v) => ({ v, score: scoreLine(query, v.verse.unicode) }))
    .sort((a, b) => b.score - a.score);
}

// Words in English letters ("sochai soch"): BaniDB's romanized search, keeping lines whose
// transliteration has most of the typed words, best first.
async function searchRomanized(text) {
  const plain = (s) => (s || '').toLowerCase().replace(/\(n\)/g, 'n').replace(/[^a-z ]/g, ' ');
  const typed = plain(text).split(/\s+/).filter(Boolean);
  if (!typed.length) return [];
  const verses = await searchBaniDB(text, 4, 'all', 30); // the best matches come first
  return verses
    .map((v) => {
      const words = plain(v.transliteration?.english).split(/\s+/);
      const hits = typed.filter((t) => words.some((w) => w.startsWith(t.slice(0, 4)))).length;
      return { v, score: hits / typed.length };
    })
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);
}

// Banis by name, in English letters or Gurmukhi: "japji", "Jaap Sahib", "ਅਨੰਦੁ", "rehras".
const simplify = (s) => (s || '').toLowerCase().replace(/\(n\)/g, 'n').replace(/[^a-z਀-੿]/g, '')
  .replace(/(saahib|sahib|sahb|jee|ji)$/, '');

async function searchBanis(text) {
  const q = simplify(text);
  if (q.length < 3) return [];
  const list = await fetchBaniList();
  const english = new Map(PANJ_BANIYAN.map((b) => [b.id, b.en]));
  // The name contains what was typed, or what was typed is the name plus a little more
  // ("japji sahib ji"), not a whole line that happens to contain a bani's name.
  const fits = (name) => {
    const s = simplify(name);
    return s && (s.includes(q) || (s.length >= 4 && q.includes(s) && q.length <= s.length + 4));
  };
  const matches = list.filter((b) => [b.token, b.tl, b.gm, english.get(b.id)].some(fits));
  // The Panj Baniyan first.
  matches.sort((a, b) => english.has(b.id) - english.has(a.id));
  return matches.slice(0, 6).map((b) => ({ kind: 'bani', id: b.id, gm: b.gm, en: english.get(b.id) || b.tl }));
}

async function search(text) {
  text = text.trim();
  if (!text) return;
  const seq = ++state.searchSeq;
  document.body.classList.add('compact'); // straight to the compact layout, no jump when results land
  showResults();
  setStatus('Searching…');

  const ang = text.match(/^(?:ang\s*)?(\d{1,4})$/i);
  let verses;
  if (ang) { // Ang numbers are Sri Guru Granth Sahib Ji's
    verses = searchBaniDB(ang[1], 5, 'G').then((vs) => vs.map((v) => ({ v, score: 1 })));
  } else if (GURMUKHI.test(text)) {
    verses = searchGurmukhi(text);
  } else {
    verses = searchRomanized(text);
  }

  const [banis, found] = await Promise.all([ang ? [] : searchBanis(text), verses]);
  if (seq !== state.searchSeq) return; // a newer search has started

  // One result per shabad, keeping the line that matched.
  const seen = new Set();
  const shabads = [];
  for (const { v } of found) {
    if (seen.has(v.shabadId)) continue;
    seen.add(v.shabadId);
    shabads.push({ kind: 'shabad', shabadId: v.shabadId, verseId: v.verseId, gm: v.verse.unicode, meta: verseMeta(v) });
    if (shabads.length >= 12) break;
  }

  state.results = [...banis, ...shabads];
  renderResults();
  if (!state.results.length) {
    setStatus(GURMUKHI.test(text) && makeQuery(text).letters.length < 2
      ? 'Type at least 2 words, or 2 first letters.'
      : 'Nothing found. Try a few more words, or check the spelling.');
  } else {
    setStatus('');
  }
}

// ---------- listening (keeps going until Stop) ----------

// Listen finds the shabad being read, opens it, then keeps following it line by line and
// moves to the next shabad when the reading does, until Stop is pressed.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Tuned on test phrases: Gurbani with recognition errors scores 0.9+, everyday Punjabi
// speech 0.65 or less.
const MATCH_SCORE = 0.75;
// Two words can fit many lines well; three are enough only for a near-certain match.
const MATCH_SCORE_3_WORDS = 0.9;
const SWITCH_SCORE = 0.8; // to move from the shabad on screen to another
// Searching uses only the newest words: they say where the reading is now.
const SEARCH_WORDS = 6;
// A paath is read in order, so ordinary moves stay within this many lines of the current
// one; jumping further needs a near-certain match.
const FOLLOW_NEAR = 12;
// How long a bani opened by listening waits, with nothing fitting it, before another
// shabad may take its place.
const PAATH_PATIENCE = 6000;

// Every browser on iPhone and iPad, and Safari on a Mac, uses Apple's speech recognition,
// which has no Punjabi. There the app listens in Hindi and writes what it hears in Gurmukhi.
const IS_APPLE_SPEECH = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(navigator.userAgent));
const SPEECH_LANGS = IS_APPLE_SPEECH ? ['hi-IN'] : ['pa-IN', 'hi-IN'];

const MIC_ERRORS = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser’s address bar and try again.',
  'service-not-allowed': IS_APPLE_SPEECH
    ? 'Speech recognition is off on this device. Turn on Dictation (Settings → General → Keyboard → Enable Dictation), then try again.'
    : 'This browser doesn’t allow speech recognition here. Try Chrome or Edge.',
  // Apple's recognizer has no Hindi on this device: Hindi dictation comes with the Hindi keyboard.
  'language-unavailable': 'This iPhone can’t recognise Hindi speech yet, which Gurbani Sync uses on iPhone. Add the Hindi keyboard (Settings → General → Keyboard → Keyboards → Add New Keyboard → Hindi), check Enable Dictation is on, then try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Listening needs an internet connection.',
  'language-not-supported': 'This browser can’t recognise Punjabi. Try Chrome or Edge.',
};

const listening = {
  on: false,
  rec: null,
  heard: [],    // words recognised so far
  interim: [],  // words still being recognised
  text: '',     // the latest few words
  timer: null,  // next check
  seq: 0,       // checks started
  applied: 0,   // newest check whose answer was used
  pendingLine: null, // line the last check wanted to move to, waiting for a second check
  pendingShabad: null, // likewise for a different shabad
};

function startListening(langIndex = 0) {
  const rec = new Recognition();
  rec.lang = SPEECH_LANGS[langIndex];
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = onSpeech;
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    // No Punjabi here: listen in Hindi instead.
    const noLang = e.error === 'language-not-supported' || e.error === 'service-not-allowed';
    if (noLang && langIndex + 1 < SPEECH_LANGS.length) {
      rec.onend = null;
      listening.on = false;
      startListening(langIndex + 1);
      return;
    }
    stopListening();
    // Safari gives the same error for "speech recognition not allowed" and "no recognizer for
    // this language"; its message tells them apart.
    const key = IS_APPLE_SPEECH && /not available/i.test(e.message || '') ? 'language-unavailable' : e.error;
    const msg = MIC_ERRORS[key] || `Listening stopped (${e.error}${e.message ? `: ${e.message}` : ''}).`;
    setStatus(msg);
    slides.setStatus(msg);
  };
  // Browsers end recognition after a pause or a minute or so; start again until Stop.
  rec.onend = () => { if (listening.on) rec.start(); };
  rec.start();

  Object.assign(listening, { on: true, rec, heard: [], interim: [], text: '' });
  $('#heard').textContent = '';
  showListenState();
  if (!isShowing()) {
    showResults();
    state.results = [];
    renderResults();
  }
  setStatus('');
}

function stopListening() {
  if (!listening.on) return;
  listening.on = false;
  listening.rec?.stop();
  clearTimeout(listening.timer);
  listening.timer = null;
  $('#heard').textContent = '';
  showListenState();
  setStatus('');
}

// The big microphone, the top bar's Listen button and the slideshow's stay in step.
function showListenState() {
  const on = listening.on;
  $('#bigListenBtn').classList.toggle('on', on);
  $('#bigListenLabel').textContent = on ? 'Listening… tap to stop' : 'Tap to listen';
  $('#listenBtn').classList.toggle('on', on);
  $('#listenLabel').textContent = on ? 'Stop' : 'Listen';
  $('#status').classList.toggle('is-listening', on);
  updateLayout();
  slides.setActionLabel(slidesMic, on ? 'Stop listening' : 'Listen');
  slidesMic.classList.toggle('on', on);
  slides.setStatus(on ? 'Listening' : '');
}

// Is a shabad or paath on screen (slideshow or full view)?
const isShowing = () => !!state.view && (slides.isOpen || !$('#reader').hidden);

// Show the words as they're heard, and check them at most every 150ms.
function onSpeech(event) {
  listening.interim = [];
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const words = gurmukhiWords(event.results[i][0].transcript);
    if (event.results[i].isFinal) listening.heard.push(...words);
    else listening.interim.push(...words);
  }
  listening.heard = listening.heard.slice(-40);
  listening.text = [...listening.heard, ...listening.interim].slice(-10).join(' ');
  $('#heard').textContent = listening.text; // the words heard so far, under the microphone
  if (!listening.timer) listening.timer = setTimeout(() => { listening.timer = null; checkHeard(); }, 150);
}

async function checkHeard() {
  const text = listening.text;
  const view = state.view;
  const showing = isShowing();

  // Following what's on screen: move to the line being read. This needs no network.
  if (showing) {
    const isPaath = view.result.kind === 'bani';
    const query = makeQuery(text);
    // Single lines first; if none fits, the running text of the next lines (misheard words
    // from a phone across the room rarely fit one line, but still fit the passage).
    const found = followLine(query, view.lines, view.current, { near: isPaath ? FOLLOW_NEAR : Infinity })
      || (query.words && followRunning(query.words, view.lines, view.current));
    if (found) {
      view.lostSince = null;
      listening.pendingShabad = null;
      // On to the next line straight away (followLine already waits for 3 of its words).
      // Any other move, a jump ahead or back, needs two checks in a row to agree, so one
      // misheard moment can't move the line on screen.
      if (found.i === view.current) listening.pendingLine = null;
      else if (found.i === view.current + 1 || listening.pendingLine === found.i) { listening.pendingLine = null; moveTo(found.i); }
      else listening.pendingLine = found.i;
      return;
    }
    // A paath stays open while the reading pauses or wanders. One chosen from the results
    // stays for good; one that listening opened gives way only after PAATH_PATIENCE ms in
    // which nothing fits it (kirtan may sing one pauri of Anand Sahib, then move on).
    if (isPaath) {
      view.lostSince ??= Date.now();
      if (!view.result.auto || Date.now() - view.lostSince < PAATH_PATIENCE) return;
    }
  }

  // Otherwise find the shabad being read, anywhere in BaniDB, and open it. Checks run side
  // by side so new words never wait for a slow answer; an older answer arriving late is
  // ignored once a newer one has been used.
  const words = gurmukhiWords(text).slice(-SEARCH_WORDS);
  if (words.length < 3) return;
  const seq = ++listening.seq;
  const matches = await searchGurmukhi(words.join(' '));
  if (!listening.on || seq < listening.applied) return;
  listening.applied = seq;

  const top = matches[0];
  if (top && top.score >= 0.6) fetchShabad(top.v.shabadId).catch(() => {}); // likely next: start loading it
  const onScreen = state.view;
  const sameShabad = showing && !!top && (onScreen.result.kind === 'bani'
    ? onScreen.lines.some((l) => l.verseId === top.v.verseId)
    : onScreen.result.shabadId === top.v.shabadId);
  // Leaving the shabad on screen for another needs a little more certainty, since this runs
  // as soon as one check doesn't fit the open shabad.
  const needed = words.length < 4 ? MATCH_SCORE_3_WORDS : showing && !sameShabad ? SWITCH_SCORE : MATCH_SCORE;
  if (showing && !sameShabad && words.length < 4) return;
  if (top?.score >= needed) {
    const v = top.v;
    if (sameShabad) {
      moveTo(onScreen.lines.findIndex((l) => l.verseId === v.verseId));
      return;
    }
    // Leaving what's on screen needs two checks in a row to agree on where to go.
    if (showing && listening.pendingShabad !== v.shabadId) {
      listening.pendingShabad = v.shabadId;
      return;
    }
    listening.pendingShabad = null;
    // Part of one of the Panj Baniyan: open the whole bani, as a paath, at this line.
    const bani = await baniContaining(v.verseId);
    if (!listening.on) return;
    const result = bani
      ? { kind: 'bani', id: bani.id, gm: bani.gm, en: bani.en, verseId: v.verseId, auto: true }
      : { kind: 'shabad', shabadId: v.shabadId, verseId: v.verseId, gm: v.verse.unicode, meta: verseMeta(v) };
    // Keep showing it the way it's being shown now; from the results, use Open as.
    await openResult(result, slides.isOpen ? 'slides' : showing ? 'full' : state.mode);
  }
}

// Move the slideshow, or the highlight in the full view, to line i.
function moveTo(i) {
  if (i < 0 || !state.view) return;
  state.view.current = i;
  markCurrent();
  if (slides.isOpen) slides.show(i);
  else $('#readerLines').children[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Stop pressed with nothing found yet: show the closest matches for what was heard.
async function onListenButton() {
  if (!listening.on) { startListening(); return; }
  const text = listening.text;
  const showing = isShowing();
  stopListening();
  if (showing || !text) return;
  await search(text);
  setStatus(state.results.length
    ? 'Not sure of an exact match. These are the closest to what was heard.'
    : 'Couldn’t find that. Try again, closer to the sound.');
}

// Listening is the only way in, so browsers that can't listen get told where it works.
if (Recognition) {
  $('#listenBtn').hidden = false;
  $('#listenHero').hidden = false;
  $('#listenBtn').addEventListener('click', onListenButton);
  $('#bigListenBtn').addEventListener('click', onListenButton);
} else {
  $('#unsupported').hidden = false;
}

// ---------- results ----------

function renderResults() {
  const list = $('#results');
  list.innerHTML = '';
  state.results.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="result-card" data-i="${i}">
        <span class="result-body">
          <span class="result-gm"></span>
          <span class="result-meta">${r.kind === 'bani' ? '<span class="chip">Paath</span>' : ''}<span class="meta-text"></span></span>
        </span>
        <svg class="result-go" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>`;
    li.querySelector('.result-gm').textContent = r.gm;
    li.querySelector('.meta-text').textContent = r.kind === 'bani' ? r.en : r.meta;
    list.appendChild(li);
  });
  updateLayout();
}

// The big microphone steps aside once there's a shabad or matches to show; the top bar's
// Listen button takes over.
function updateLayout() {
  const busy = state.results.length > 0 || !$('#reader').hidden;
  document.body.classList.toggle('compact', busy);
}

// A result opens in whichever mode the Open as switch is set to.
$('#results').addEventListener('click', (e) => {
  const card = e.target.closest('.result-card');
  if (card) openResult(state.results[Number(card.dataset.i)], state.mode);
});

function showMode() {
  for (const btn of document.querySelectorAll('.mode-switch button')) {
    const on = btn.dataset.mode === state.mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', on);
  }
}

document.querySelector('.mode-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  store.set('paath:openAs', state.mode);
  showMode();
});
showMode();

function showResults() {
  $('#reader').hidden = true;
  $('#results').hidden = false;
  updateLayout();
}

// ---------- opening a shabad or bani ----------

async function loadView(result) {
  if (result.kind === 'bani') {
    const bani = await fetchBani(result.id);
    const lines = linesFor(bani, $('#optVersion').value);
    // Opened by listening: start at the line heard.
    const current = Math.max(0, lines.findIndex((l) => l.verseId === result.verseId));
    return { result, title: bani.name, meta: result.en, lines, current };
  }
  const data = await fetchShabad(result.shabadId);
  const lines = data.verses.map((v) => ({
    verseId: v.verseId,
    gm: v.verse.unicode,
    lv: v.larivaar?.unicode || '',
    tl: v.transliteration?.english || '',
    en: v.translation?.en?.ssk || v.translation?.en?.bdb || v.translation?.en?.ms || '',
    pu: v.translation?.pu?.ss?.unicode || '',
  }));
  const info = data.shabadInfo;
  const meta = [info.source?.english, info.pageNo ? `Ang ${info.pageNo}` : null, info.raag?.english, info.writer?.english]
    .filter(Boolean).join(' · ');
  const current = Math.max(0, lines.findIndex((l) => l.verseId === result.verseId));
  return { result, title: result.gm, meta, lines, current };
}

async function openResult(result, how) {
  setStatus('Opening…');
  try {
    state.view = await loadView(result);
  } catch (err) {
    setStatus(`Could not open it: ${err.message}`);
    return;
  }
  setStatus('');
  renderReader();
  if (how === 'slides') openSlides(state.view.current);
  else showReader();
}

function openSlides(i) {
  slides.setMeta(state.view.result.kind === 'bani' ? state.view.title : state.view.meta);
  slides.open(i);
}

// ---------- full shabad / paath ----------

function renderReader() {
  const view = state.view;
  $('#readerTitle').textContent = view.result.kind === 'bani' ? view.title : 'Shabad';
  $('#readerMeta').textContent = view.meta;
  const box = $('#readerLines');
  box.innerHTML = '';
  let prevPara = null;
  view.lines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'line';
    if (line.header) el.classList.add('header');
    if (prevPara != null && line.para != null && line.para !== prevPara) el.classList.add('para-start');
    prevPara = line.para;
    el.dataset.i = i;
    el.innerHTML = '<div class="gm"></div><div class="tl"></div><div class="en"></div><div class="pu"></div>';
    el.querySelector('.gm').textContent = $('#optLv').checked && line.lv ? line.lv : line.gm;
    el.querySelector('.tl').textContent = line.tl;
    el.querySelector('.en').textContent = line.en;
    el.querySelector('.pu').textContent = line.pu;
    box.appendChild(el);
  });
  markCurrent();
}

function markCurrent() {
  const box = $('#readerLines');
  box.querySelector('.current')?.classList.remove('current');
  box.children[state.view.current]?.classList.add('current');
}

function showReader() {
  $('#results').hidden = true;
  $('#reader').hidden = false;
  updateLayout();
  $('#readerLines').children[state.view.current]?.scrollIntoView({ block: 'center' });
}

// Click a line to show it in the slideshow from there.
$('#readerLines').addEventListener('click', (e) => {
  const el = e.target.closest('.line');
  if (el) openSlides(Number(el.dataset.i));
});
$('#readerSlidesBtn').addEventListener('click', () => openSlides(state.view.current));
$('#backBtn').addEventListener('click', () => { showResults(); window.scrollTo(0, 0); });

// ---------- slideshow ----------

const slides = createSlideshow({
  getLine: (i) => {
    const l = state.view?.lines[i];
    return l && { gm: $('#optLv').checked && l.lv ? l.lv : l.gm, tl: l.tl, en: l.en, pu: l.pu };
  },
  count: () => state.view?.lines.length || 0,
  placeholder: () => state.view?.title || '',
  onNavigate: (i) => { state.view.current = i; markCurrent(); },
  upcoming: UPCOMING_LINES, // paath readers see what's coming next...
  allowUpcoming: () => state.view?.result.kind === 'bani', // ...shabads don't need it
  storageKey: 'main',
  tapToAdvance: true,
  brand: 'Gurbani Sync',
  credit: { text: 'Powered by', name: 'BaniDB', url: 'https://www.banidb.com/', logo: 'assets/banidb-logo.png' },
  // Leaving the slideshow shows where you got to, in full (still following if listening).
  onClose: () => {
    if (!state.view) return;
    showReader();
  },
});

const slidesMic = slides.addAction('Listen', () => onListenButton());

// Space also moves to the next line.
document.addEventListener('keydown', (e) => {
  if (!slides.isOpen || e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  slides.next();
});

// ---------- wiring ----------

// Display options (the full view and the slideshow both follow these)
const displayOpts = { optTl: 'show-tl', optEn: 'show-en', optPu: 'show-pu' };
for (const [id, cls] of Object.entries(displayOpts)) {
  const box = $('#' + id);
  const saved = store.get(`paath:${id}`);
  if (saved != null) box.checked = saved;
  document.body.classList.toggle(cls, box.checked);
  box.addEventListener('change', () => {
    document.body.classList.toggle(cls, box.checked);
    store.set(`paath:${id}`, box.checked);
  });
}

$('#optLv').checked = !!store.get('paath:optLv');
$('#optLv').addEventListener('change', (e) => {
  store.set('paath:optLv', e.target.checked);
  if (state.view) renderReader();
});

$('#optVersion').value = store.get('paath:version') || 's';
$('#optVersion').addEventListener('change', async (e) => {
  store.set('paath:version', e.target.value);
  if (state.view?.result.kind === 'bani') {
    state.view = await loadView(state.view.result);
    renderReader();
  }
});

// The full view's header sits just below the top bar, whose height can change.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--header-h', `${entry.target.offsetHeight}px`);
}).observe($('.topbar'));

