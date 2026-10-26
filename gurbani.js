// Gurmukhi text matching: how well something typed or heard fits a line of Gurbani, and
// following a reading line by line.

// ---------- Gurmukhi text helpers ----------

// BaniDB's first-letter search files words that start with a vowel under its base letter.
const VOWEL_BASE = { 'ਆ': 'ਅ', 'ਐ': 'ਅ', 'ਔ': 'ਅ', 'ਇ': 'ੲ', 'ਈ': 'ੲ', 'ਏ': 'ੲ', 'ਉ': 'ੳ', 'ਊ': 'ੳ', 'ਓ': 'ੳ' };
const LETTER = /[ਅ-ਹੜੲੳ]/;
const base = (c) => VOWEL_BASE[c] || c;

// Devanagari letters that Gurmukhi lacks or that Gurbani spells another way. Everything else
// in the Devanagari block sits exactly 0x100 below its Gurmukhi twin (क U+0915 → ਕ U+0A15).
const DEVANAGARI_SPECIAL = {
  'ष': 'ਖ', 'ऋ': 'ਰਿ', 'ृ': '੍ਰ', 'ऩ': 'ਨ', 'ऱ': 'ਰ', 'ऴ': 'ਲ',
  'ऑ': 'ਓ', 'ऍ': 'ਏ', 'ॉ': 'ੋ', 'ॅ': 'ੇ', 'ऒ': 'ਓ', 'ऎ': 'ਏ', 'ॊ': 'ੋ', 'ॆ': 'ੇ', 'ॐ': ' ',
};

// Apple's speech recognition (every browser on iPhone) has no Punjabi, so there the app
// listens in Hindi; this writes the Devanagari it hears in Gurmukhi.
function devanagariToGurmukhi(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0921\u0922]\u093C/g, 'ੜ') // ड़ and ढ़
    .replace(/[\u0900-\u097F]/g, (c) => {
      if (c in DEVANAGARI_SPECIAL) return DEVANAGARI_SPECIAL[c];
      const g = String.fromCharCode(c.charCodeAt(0) + 0x100);
      return /\p{Assigned}/u.test(g) ? g : '';
    });
}

// Splits text into Gurmukhi words, dropping punctuation, numerals, ੴ and nuktas (ਸ਼ → ਸ),
// since speech recognition and Gurbani spell those differently.
function gurmukhiWords(text) {
  return devanagariToGurmukhi(text)
    .normalize('NFD')
    .replace(/਼/g, '')
    .replace(/[੦-੯ੴ]/g, ' ')
    .split(/[^਀-੿]+/)
    .filter((w) => LETTER.test(w[0]));
}

const firstLetter = (word) => base(word[0]);

// Letters only, without vowel signs: ਸਚੁ (Gurbani) and ਸੱਚ (everyday spelling) both become ਸਚ.
const skeleton = (word) => [...word].filter((c) => LETTER.test(c)).map(base).join('');

// Local alignment (Smith–Waterman): how well the heard text appears somewhere in the
// line, from 0 to 1. Tolerates a few misheard, missing or extra letters.
function align(query, target) {
  if (!query.length || !target.length) return 0;
  const MATCH = 2, MISMATCH = -1, GAP = -1;
  let prev = new Array(target.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= query.length; i++) {
    const cur = [0];
    for (let j = 1; j <= target.length; j++) {
      const s = Math.max(
        0,
        prev[j - 1] + (query[i - 1] === target[j - 1] ? MATCH : MISMATCH),
        prev[j] + GAP,
        cur[j - 1] + GAP,
      );
      cur.push(s);
      if (s > best) best = s;
    }
    prev = cur;
  }
  return best / (MATCH * query.length);
}

// A query is what was heard: whole words, or just first letters typed by hand.
function makeQuery(text) {
  const ws = gurmukhiWords(text);
  const typedLetters = ws.length === 1 && ws[0].length >= 3 && skeleton(ws[0]) === ws[0];
  if (typedLetters) return { words: null, letters: [...ws[0]].map(base) };
  return { words: ws, letters: ws.map(firstLetter) };
}

// Blends three signals: first letters in order, all letters in order, and how many heard
// words appear whole in the line. The last one keeps everyday speech made of common
// words (ਜੋ, ਹੈ, ਕੀ) from passing as Gurbani.
function scoreWords(ws, line) {
  const lw = gurmukhiWords(line);
  const first = align(ws.map(firstLetter).join(''), lw.map(firstLetter).join(''));
  const skel = align(ws.map(skeleton).join(''), lw.map(skeleton).join(''));
  const lineWords = new Set(lw.map(skeleton));
  const whole = ws.filter((w) => lineWords.has(skeleton(w))).length / ws.length;
  return 0.3 * first + 0.45 * skel + 0.25 * whole;
}

// Scores what was heard against one line. The listening window often straddles two
// lines, so its last 6 and last 4 words also get a chance, slightly discounted. When
// searching (not following along), the first words get the same chance.
function scoreLine(query, line, { latestOnly = false } = {}) {
  if (!query.words) {
    const lw = gurmukhiWords(line);
    return align(query.letters.join(''), lw.map(firstLetter).join(''));
  }
  const ws = query.words;
  let best = scoreWords(ws, line);
  for (const [k, weight] of [[6, 0.97], [4, 0.9]]) {
    if (ws.length <= k) continue;
    best = Math.max(best, weight * scoreWords(ws.slice(-k), line));
    if (!latestOnly) best = Math.max(best, weight * scoreWords(ws.slice(0, k), line));
  }
  return best;
}

// ---------- following a reading ----------

// Tuned on test phrases: Gurbani with recognition errors scores 0.9+, everyday Punjabi
// speech 0.65 or less.
const FOLLOW_SCORE = 0.65;

// Where the reading is now, given what was just heard, the lines being read (each with .gm)
// and the current line. Returns { i, score } or null when nothing fits well enough.
//
// `near` limits ordinary moves to that many lines either side of the current one, which
// suits a long bani read in order; anything further must be a near-certain match.
function followLine(query, lines, current, { near = Infinity } = {}) {
  if (!query.words || query.words.length < 2) return null;

  // Fast path: the two newest words open the next line and fit it better than anything in
  // the current line. Moves on after two words instead of waiting for four.
  const next = lines[current + 1];
  if (current >= 0 && next) {
    const heard = query.words.slice(-2).map(skeleton).join('');
    const opening = gurmukhiWords(next.gm).slice(0, 2).map(skeleton).join('');
    const here = gurmukhiWords(lines[current].gm).map(skeleton).join('');
    const fitsNext = align(heard, opening);
    if (fitsNext >= 0.8 && fitsNext > align(heard, here)) return { i: current + 1, score: fitsNext };
  }

  // Otherwise the best line for the newest words only; older ones belong to lines already
  // passed and would pull the highlight backwards. Nudged toward the current and next
  // line and away from earlier ones, so repeated words and lines don't make it jump
  // around. A clearly repeated line still wins.
  const recent = { words: query.words.slice(-4), letters: query.letters.slice(-4) };
  let best = null;
  lines.forEach((line, i) => {
    const far = current >= 0 && Math.abs(i - current) > near;
    let s = scoreLine(recent, line.gm, { latestOnly: true });
    if (far && s < 0.92) return;
    if (i === current || i === current + 1) s += 0.04;
    else if (i < current) s -= 0.06;
    if (s >= FOLLOW_SCORE && (!best || s > best.score)) best = { i, score: s };
  });
  return best;
}
