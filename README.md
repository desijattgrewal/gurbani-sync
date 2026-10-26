# Gurbani Sync

Tap the microphone near paath, katha or kirtan: Gurbani Sync hears the Gurbani, finds the shabad
and shows it, following along line by line, as a **slideshow** (one line at a time, full screen,
for a TV or Gurdwara projector) or **in full**.
Text, transliteration and meanings come from [BaniDB](https://www.banidb.com/) (Khalis Foundation).

## Run it

```bash
python3 -m http.server 8765 --directory gurbani-sync
```

Then open http://localhost:8765 in **Google Chrome** or **Microsoft Edge** (best), or **Safari**.
Listening uses the browser's speech recognition:

- Chrome and Edge on a computer or Android recognise Punjabi (the audio is sent to Google).
- Every browser on iPhone and iPad, and Safari on a Mac, uses Apple's recognition, which has no
  Punjabi. There the app listens in Hindi and writes what it hears in Gurmukhi (the two scripts
  match letter for letter). It is less accurate than Punjabi, and needs Dictation turned on
  (Settings → General → Keyboard → Enable Dictation).
- Other browsers (Firefox) are told to switch.

## Listening

1. Press **Tap to listen** and hold the phone near the sound. The words it hears appear under the
   microphone.
2. Once a few words clearly match a line of Gurbani (usually 3–4 words), it opens that shabad, as a
   slideshow or in full, whichever **Open as** is set to.
3. It keeps listening and following line by line, and moves to the next shabad when the reading
   does. A paath (bani) stays open and is followed even if something else is read for a while.
4. **Stop** (top bar or slideshow) ends listening. Stopping before anything was found shows the
   closest matches to what was heard.

It searches all of BaniDB: Sri Guru Granth Sahib Ji, Dasam Granth, Bhai Gurdas Ji's Vaaran and
more. Clear paath and katha work best; kirtan is harder because of the music and repeated lines.

## Slideshow

The current line, large, with its transliteration and meaning. For a paath, the next 2 lines show
underneath so the reader can see what's coming.

- **Black or white background** (`B`), remembered between visits
- `Space`, `→` or tapping the line: next line. `←`: previous line.
- `F` full screen, `N` next lines on/off (paath), `Esc` exit to the full shabad at the line reached
- The controls hide when the mouse is still. The Gurbani Sync logo and "Powered by BaniDB" stay
  in the bottom corners.

## Display

**Display** (top right) sets transliteration, English and Punjabi meanings, larivaar, and the paath
**version**: SGPC (Sikh Rehat Maryada), Damdami Taksal or Buddha Dal. The versions differ most in
Chaupai Sahib (104, 130 and 173 lines).

## Credits

Gurbani text, transliterations and translations: [BaniDB](https://www.banidb.com/) by the Khalis
Foundation. `assets/banidb-logo.png` is BaniDB's logo, taken unaltered from banidb.com and used only
to credit them.

## Banis saved in the app

The Panj Baniyan (Japji Sahib, Jaap Sahib, Tav Prasad Savaiye, Chaupai Sahib, Anand Sahib) are saved
in `banis/` so they open instantly. To save more, use their BaniDB IDs, for example Rehras Sahib
(21) and Sohila Sahib (23):

```bash
python3 tools/fetch_banis.py 21 23
```

then add them to `PANJ_BANIYAN` in `banis.js`.

## Files

- `index.html`, `app.js`: the page: listening, matching, results, full view
- `present.js`: the slideshow
- `gurbani.js`: matching heard Gurmukhi against Gurbani lines, and following a reading
- `banis.js`: loading banis
- `style.css`
- `assets/banidb-logo.png`: BaniDB's logo, for the credit
