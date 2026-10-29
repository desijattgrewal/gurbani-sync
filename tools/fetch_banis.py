"""Download banis from BaniDB and save them in the app, so they load instantly and offline.

    python3 tools/fetch_banis.py            # the Nitnem banis (Panj Baniyan, Rehras, Sohila)
    python3 tools/fetch_banis.py 31         # add more by BaniDB ID

Writes banis/<id>.json in the same compact format app.js builds from the live API.
"""

import json
import pathlib
import sys
import urllib.request

API = "https://api.banidb.com/v2"
NITNEM_BANIYAN = [2, 4, 6, 9, 10, 21, 23]  # Japji, Jaap, Tav Prasad Savaiye, Chaupai, Anand, Rehras, Sohila
OUT = pathlib.Path(__file__).resolve().parent.parent / "banis"


def slim(bani_id, data):
    """Keep only what the app shows. `v` lists the versions a line belongs to:
    s = SGPC (Sikh Rehat Maryada), t = Damdami Taksal, b = Buddha Dal."""
    lines = []
    for v in data["verses"]:
        verse = v["verse"]
        en = (verse.get("translation") or {}).get("en") or {}
        pu = ((verse.get("translation") or {}).get("pu") or {}).get("ss") or {}
        versions = "".join(
            flag for flag, key in (("s", "existsSGPC"), ("t", "existsTaksal"), ("b", "existsBuddhaDal")) if v.get(key) == 1
        )
        lines.append({
            "verseId": verse["verseId"],
            "para": v.get("paragraph"),
            "header": (v.get("header") or 0) > 0,
            "gm": (verse.get("verse") or {}).get("unicode") or "",
            "lv": (verse.get("larivaar") or {}).get("unicode") or "",
            "tl": (verse.get("transliteration") or {}).get("english") or "",
            "en": en.get("ssk") or en.get("bdb") or en.get("ms") or "",
            "pu": pu.get("unicode") or "",
            "v": versions,
        })
    info = data.get("baniInfo") or {}
    return {"id": bani_id, "name": info.get("unicode") or "", "token": info.get("english") or str(bani_id), "lines": lines}


def main():
    ids = [int(a) for a in sys.argv[1:]] or NITNEM_BANIYAN
    OUT.mkdir(exist_ok=True)
    for bani_id in ids:
        with urllib.request.urlopen(f"{API}/banis/{bani_id}") as res:
            bani = slim(bani_id, json.load(res))
        path = OUT / f"{bani_id}.json"
        path.write_text(json.dumps(bani, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{path.name}: {bani['name']} ({len(bani['lines'])} lines, {path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
