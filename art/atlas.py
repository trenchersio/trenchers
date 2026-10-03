"""Builds the website's Collection assets from out/images and out/metadata:
- web/public/collection/sheet-{n}.webp: 10 sprite sheets, 200 tiles each (20 x 10), 128 px per tile
- web/public/nft-md/{id}.webp: 320 px image per token for the detail panel
- web/lib/collection.json: compact traits for all 2,000 tokens
"""
import json, os
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web")
T, COLS, ROWS, N = 128, 20, 10, 2000
PER = COLS * ROWS

def sheet(n):
    s = Image.new("RGB", (COLS * T, ROWS * T))
    for k in range(PER):
        tid = n * PER + k + 1
        im = Image.open(os.path.join(HERE, "out/images", f"{tid}.png"))
        s.paste(im.resize((T, T), Image.LANCZOS), ((k % COLS) * T, (k // COLS) * T))
        im.resize((320, 320), Image.LANCZOS).save(os.path.join(WEB, "public/nft-md", f"{tid}.webp"), "WEBP", quality=80, method=6)
    s.save(os.path.join(WEB, "public/collection", f"sheet-{n}.webp"), "WEBP", quality=80, method=6)
    return n

if __name__ == "__main__":
    os.makedirs(os.path.join(WEB, "public/collection"), exist_ok=True)
    os.makedirs(os.path.join(WEB, "public/nft-md"), exist_ok=True)
    keys, tables, rows = None, {}, []
    for tid in range(1, N + 1):
        m = json.load(open(os.path.join(HERE, "out/metadata", f"{tid}.json")))
        attrs = m["attributes"]
        if keys is None: keys = [a["trait_type"] for a in attrs]
        row = []
        for a in attrs:
            t = tables.setdefault(a["trait_type"], [])
            if a["value"] not in t: t.append(a["value"])
            row.append(t.index(a["value"]))
        rows.append(row)
    json.dump({"tile": T, "cols": COLS, "rows": ROWS, "keys": keys, "values": [tables[k] for k in keys], "tokens": rows},
              open(os.path.join(WEB, "lib/collection.json"), "w"), separators=(",", ":"))
    with ProcessPoolExecutor() as ex: list(ex.map(sheet, range(N // PER)))
    print("done")
