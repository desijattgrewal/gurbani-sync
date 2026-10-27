// Slideshow view shared by both pages: one pankti at a time, large and centred, like a
// Gurdwara projector screen. The page tells it which line is current; it fades between lines.
//
//   const slides = createSlideshow({
//     getLine: (i) => ({ gm, tl, en, pu }),   // line i, or null
//     count: () => number of lines,
//     placeholder: () => text shown before any line is current,
//     onNavigate: (i) => the viewer pressed next/previous; move the page to line i,
//     upcoming: 2,        // optional: also show the next lines, small, under the current one
//     allowUpcoming: () => true, // optional: whether next lines apply to what's showing now
//     storageKey: 'bani', // optional: remembers the viewer's upcoming-lines choice per page
//     onClose: () => {},  // optional: the viewer left the slideshow
//     tapToAdvance: true, // optional: a tap or click on the line moves to the next one
//     brand: 'Gurbani Sync', // optional: shown small in the bottom corner, with ੴ
//     credit: { text: 'Powered by', name: 'BaniDB', url: 'https://banidb.com', logo: 'assets/banidb-logo.png' }, // optional
//   });
//   slides.open(); slides.show(i); slides.next(); slides.setMeta(text); slides.setStatus(text);

const UPCOMING_LINES = 2;

// Toolbar icons (24×24, drawn in the button's text colour). On a phone only the icons show,
// so the toolbar fits on one row; wider screens also show the labels.
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  prev: svg('<path d="M15 18l-6-6 6-6"/>'),
  next: svg('<path d="M9 18l6-6-6-6"/>'),
  upcoming: svg('<path d="M4 7h16M4 12h10M4 17h6"/>'),
  theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
};
const actionButton = (act, icon, label, hint) =>
  `<button data-act="${act}" aria-label="${label}" title="${hint || label}"><span class="ss-ico">${icon}</span><span class="ss-label">${label}</span></button>`;

function createSlideshow({ getLine, count, placeholder, onNavigate, upcoming = 0, allowUpcoming = () => true, storageKey = 'slides', onClose, tapToAdvance = false, brand = '', credit = null }) {
  const upcomingPref = `paath:upcoming:${storageKey}`;
  try {
    const saved = localStorage.getItem(upcomingPref);
    if (saved != null) upcoming = saved === '1' ? UPCOMING_LINES : 0;
  } catch { /* storage blocked: keep the default */ }

  const root = document.createElement('div');
  root.className = 'slideshow';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Slideshow');
  root.innerHTML = `
    <div class="ss-top">
      <span class="ss-meta"></span>
      <div class="ss-actions">
        ${actionButton('prev', ICONS.prev, 'Previous line', 'Previous line (←)')}
        ${actionButton('next', ICONS.next, 'Next line', 'Next line (→)')}
        ${actionButton('upcoming', ICONS.upcoming, 'Next lines', 'Show the next lines under the current one (N)')}
        ${actionButton('theme', ICONS.theme, 'White background', 'Black or white background (B)')}
        ${actionButton('fullscreen', ICONS.fullscreen, 'Full screen', 'Full screen (F)')}
        ${actionButton('close', ICONS.close, 'Exit', 'Exit (Esc)')}
      </div>
    </div>
    <div class="ss-stage" aria-live="polite"></div>
    <div class="ss-bottom">
      <span class="ss-brand"></span>
      <span class="ss-status"></span>
      <span class="ss-credit"></span>
    </div>`;
  document.body.appendChild(root);

  // The logo and the text's source stay on screen even when the controls hide.
  if (brand) {
    root.querySelector('.ss-brand').innerHTML = '<span class="ss-brand-mark">ੴ</span><span class="ss-brand-name"></span>';
    root.querySelector('.ss-brand-name').textContent = brand;
  }
  if (credit) {
    const a = document.createElement('a');
    a.href = credit.url;
    a.target = '_blank';
    a.rel = 'noopener';
    if (credit.logo) {
      // Their logo, unaltered, on a small white tag so it reads on black or white.
      const img = document.createElement('img');
      img.src = credit.logo;
      img.alt = credit.name;
      a.className = 'ss-credit-logo';
      a.appendChild(img);
    } else {
      a.textContent = credit.name;
    }
    root.querySelector('.ss-credit').append(`${credit.text} `, a);
  }

  const stage = root.querySelector('.ss-stage');
  const actions = root.querySelector('.ss-actions');
  // Phones (and the iPhone app) can't go full screen this way.
  actions.querySelector('[data-act="fullscreen"]').hidden = !document.fullscreenEnabled;
  const setLabel = (btn, label) => {
    btn.querySelector('.ss-label').textContent = label;
    btn.setAttribute('aria-label', label);
  };
  let shown = null;    // index on screen, -1 for the placeholder
  let shownKey = null; // what's on screen, so a new shabad or bani redraws even at the same index
  let idleTimer = null;

  const keyFor = (line) => (line ? `${line.gm}|${line.tl}|${line.en}|${line.pu}` : `placeholder|${placeholder()}`);

  // The lines after i (from the start when nothing is current yet), Gurmukhi only.
  function upcomingLines(i) {
    const out = [];
    if (!allowUpcoming()) return out;
    for (let k = Math.max(i + 1, 0); out.length < upcoming && k < count(); k++) {
      const line = getLine(k);
      if (line?.gm) out.push(line.gm);
    }
    return out;
  }

  function slideFor(line, i) {
    const slide = document.createElement('div');
    slide.className = 'ss-slide';
    const parts = line
      ? [['ss-gm', line.gm], ['ss-tl tl', line.tl], ['ss-en en', line.en], ['ss-pu pu', line.pu]]
      : [['ss-gm ss-placeholder', placeholder()]];
    for (const [cls, text] of parts) {
      if (!text) continue;
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = text;
      slide.appendChild(p);
    }
    const next = upcomingLines(i);
    if (next.length) {
      const box = document.createElement('div');
      box.className = 'ss-upcoming';
      for (const text of next) {
        const p = document.createElement('p');
        p.className = 'ss-next';
        p.textContent = text;
        box.appendChild(p);
      }
      slide.appendChild(box);
    }
    return slide;
  }

  function show(i, { force = false } = {}) {
    if (root.hidden) return;
    const line = i >= 0 ? getLine(i) : null;
    const key = [keyFor(line), ...upcomingLines(i)].join('|');
    if (key === shownKey && !force) return;
    shown = i;
    shownKey = key;
    for (const old of stage.querySelectorAll('.ss-slide:not(.leaving)')) {
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 250);
    }
    const slide = slideFor(line, i);
    stage.appendChild(slide);
    requestAnimationFrame(() => slide.classList.add('in'));
  }

  // Hide the controls and cursor when the mouse is still, so only the bani shows.
  function wake() {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('idle'), 2500);
  }

  function step(delta) {
    const n = count();
    if (!n) return;
    const next = Math.max(0, Math.min(n - 1, (shown ?? -1) + delta));
    onNavigate(next);
    show(next);
  }

  const upcomingBtn = actions.querySelector('[data-act="upcoming"]');
  function showUpcomingState() {
    upcomingBtn.classList.toggle('on', upcoming > 0);
    upcomingBtn.setAttribute('aria-pressed', upcoming > 0);
  }
  showUpcomingState();

  function toggleUpcoming() {
    upcoming = upcoming ? 0 : UPCOMING_LINES;
    try { localStorage.setItem(upcomingPref, upcoming ? '1' : '0'); } catch { /* not remembered */ }
    showUpcomingState();
    show(shown ?? -1, { force: true });
  }

  // Black background (the default, like a projector) or white, remembered for next time.
  const themeBtn = actions.querySelector('[data-act="theme"]');
  function setTheme(light) {
    root.classList.toggle('light', light);
    setLabel(themeBtn, light ? 'Black background' : 'White background');
    try { localStorage.setItem('paath:slidesTheme', light ? 'light' : 'dark'); } catch { /* not remembered */ }
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('paath:slidesTheme'); } catch { /* storage blocked */ }
  setTheme(savedTheme === 'light');
  const toggleTheme = () => setTheme(!root.classList.contains('light'));

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  }

  function open(i) {
    root.hidden = false;
    document.body.classList.add('slideshow-open');
    upcomingBtn.hidden = !allowUpcoming();
    shown = null;
    shownKey = null;
    show(i);
    wake();
  }

  function close() {
    if (document.fullscreenElement) document.exitFullscreen();
    root.hidden = true;
    document.body.classList.remove('slideshow-open');
    stage.innerHTML = '';
    clearTimeout(idleTimer);
    onClose?.();
  }

  actions.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'prev') step(-1);
    if (act === 'next') step(1);
    if (act === 'upcoming') toggleUpcoming();
    if (act === 'theme') toggleTheme();
    if (act === 'fullscreen') toggleFullscreen();
    if (act === 'close') close();
  });
  root.addEventListener('mousemove', wake);
  // Touch screens have no mouse to move: a tap brings the controls back.
  root.addEventListener('touchstart', wake, { passive: true });
  if (tapToAdvance) {
    stage.style.cursor = 'pointer';
    stage.addEventListener('click', () => step(1));
  }

  // Capture phase, so these keys drive the slideshow instead of the page underneath.
  window.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const keys = {
      Escape: close,
      ArrowRight: () => step(1), ArrowDown: () => step(1), PageDown: () => step(1),
      ArrowLeft: () => step(-1), ArrowUp: () => step(-1), PageUp: () => step(-1),
      f: toggleFullscreen, F: toggleFullscreen,
      n: toggleUpcoming, N: toggleUpcoming,
      b: toggleTheme, B: toggleTheme,
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    keys[e.key]();
    wake();
  }, true);

  return {
    open,
    close,
    show,
    next: () => step(1),
    get isOpen() { return !root.hidden; },
    refresh: () => show(shown ?? -1, { force: true }),
    setMeta: (text) => { root.querySelector('.ss-meta').textContent = text || ''; },
    setStatus: (text) => { root.querySelector('.ss-status').textContent = text || ''; },
    // Lets a page add its own control, e.g. the microphone toggle (icon: a key of ICONS).
    addAction(label, onClick, icon = 'mic') {
      const tmp = document.createElement('div');
      tmp.innerHTML = actionButton('', ICONS[icon] || '', label);
      const btn = tmp.firstElementChild;
      btn.removeAttribute('data-act');
      btn.addEventListener('click', onClick);
      actions.prepend(btn);
      return btn;
    },
    setActionLabel: setLabel,
  };
}
