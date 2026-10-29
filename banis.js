// Loading banis: the daily Nitnem banis from banis/ (instant and offline), the rest from BaniDB.

const API = 'https://api.banidb.com/v2';

// Saved in banis/ by tools/fetch_banis.py: the Panj Baniyan, Rehras Sahib and Kirtan Sohila.
const NITNEM_BANIYAN = [
  { id: 2, gm: 'ਜਪੁਜੀ ਸਾਹਿਬ', en: 'Japji Sahib' },
  { id: 4, gm: 'ਜਾਪੁ ਸਾਹਿਬ', en: 'Jaap Sahib' },
  { id: 6, gm: 'ਤ੍ਵ ਪ੍ਰਸਾਦਿ ਸਵੱਯੇ', en: 'Tav Prasad Savaiye' },
  { id: 9, gm: 'ਬੇਨਤੀ ਚੌਪਈ ਸਾਹਿਬ', en: 'Chaupai Sahib' },
  { id: 10, gm: 'ਅਨੰਦੁ ਸਾਹਿਬ', en: 'Anand Sahib' },
  { id: 21, gm: 'ਰਹਰਾਸਿ ਸਾਹਿਬ', en: 'Rehras Sahib' },
  { id: 23, gm: 'ਸੋਹਿਲਾ ਸਾਹਿਬ', en: 'Kirtan Sohila' },
];

// ---------- storage (best effort; the app works without it) ----------

const store = {
  get(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
  },
};

// ---------- banis ----------

// Same shape as tools/fetch_banis.py writes. `v` lists the versions a line belongs to:
// s = SGPC, t = Damdami Taksal, b = Buddha Dal.
function slimBani(id, data) {
  const versions = (v) => [['s', 'existsSGPC'], ['t', 'existsTaksal'], ['b', 'existsBuddhaDal']]
    .filter(([, key]) => v[key] === 1).map(([flag]) => flag).join('');
  return {
    id,
    name: data.baniInfo?.unicode || '',
    lines: data.verses.map((v) => {
      const verse = v.verse;
      const en = verse.translation?.en || {};
      return {
        verseId: verse.verseId,
        para: v.paragraph,
        header: v.header > 0,
        gm: verse.verse?.unicode || '',
        lv: verse.larivaar?.unicode || '',
        tl: verse.transliteration?.english || '',
        en: en.ssk || en.bdb || en.ms || '',
        pu: verse.translation?.pu?.ss?.unicode || '',
        v: versions(v),
      };
    }),
  };
}

const baniCache = new Map();
function fetchBani(id) {
  if (!baniCache.has(id)) {
    const saved = NITNEM_BANIYAN.some((b) => b.id === id);
    const load = saved
      ? fetch(`banis/${id}.json`).then((r) => r.json())
      : fetch(`${API}/banis/${id}`).then((r) => {
        if (!r.ok) throw new Error(`BaniDB returned ${r.status}`);
        return r.json();
      }).then((data) => slimBani(id, data));
    baniCache.set(id, load.catch((err) => { baniCache.delete(id); throw err; }));
  }
  return baniCache.get(id);
}

// Which Nitnem bani a line is part of, by its text, or null. BaniDB files a bani such as
// Japji Sahib as many shabads (one per pauri); listening opens the whole bani instead, so it
// follows the paath (with the next lines showing) without searching again at every pauri.
// By text, because a bani's lines carry BaniDB IDs of their own, not the ones search returns.
// Headings and lines under 3 words (ਚੌਪਈ ॥, ਸਲੋਕ ਮਃ ੧ ॥) are in too many places to tell. A
// line in two banis (Rehras Sahib includes Chaupai Sahib) goes to the one listed first.
let baniIndex = null;
async function baniContaining(text) {
  baniIndex ??= Promise.all(NITNEM_BANIYAN.map(async (b) => [b, await fetchBani(b.id)]))
    .then((all) => {
      const index = new Map();
      for (const [b, bani] of all) {
        for (const l of bani.lines) {
          if (!l.header && gurmukhiWords(l.gm).length >= 3 && !index.has(l.gm)) index.set(l.gm, b);
        }
      }
      return index;
    })
    .catch(() => new Map());
  return (await baniIndex).get(text) || null;
}

// The lines read in one version (Chaupai Sahib differs the most).
const linesFor = (bani, version) => bani.lines.filter((l) => !l.v || l.v.includes(version));

// Every bani BaniDB has: [{ id, gm, tl, token }]. The Nitnem banis alone when offline.
let baniListLoad = null;
function fetchBaniList() {
  baniListLoad ??= (async () => {
    const saved = store.get('paath:banis2');
    if (saved) return saved;
    try {
      const res = await fetch(`${API}/banis`);
      const list = (await res.json()).map((b) => ({ id: b.ID, gm: b.gurmukhiUni, tl: b.transliteration, token: b.token }));
      store.set('paath:banis2', list);
      return list;
    } catch {
      return NITNEM_BANIYAN.map((b) => ({ id: b.id, gm: b.gm, tl: b.en, token: '' }));
    }
  })();
  return baniListLoad;
}
