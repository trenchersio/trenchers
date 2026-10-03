"""Exports every Trencher as a compact vector description, so the website can draw the art
crisply at any size (web/public/collection/art.json). Uses the exact same design() as generate.py.

Per token: [bg, main, second, eye, signal, eyeType, eyeRow, eyeCol, scanRow, pieces]
pieces: 3 base-36 chars each, packing row, col, size, shape, tone and glitch shift.
"""
import json, os
from concurrent.futures import ProcessPoolExecutor
from generate import design, colors, N, SUPPLY

EYES = {"Square": 0, "Circle": 1, "Ring": 2, "Core": 3}
TONES = {"main": 0, "second": 1, "signal": 2}
B36 = "0123456789abcdefghijklmnopqrstuvwxyz"

def enc(v):
    return B36[v // 1296] + B36[(v // 36) % 36] + B36[v % 36]

def one(token_id):
    t, pieces, (er, ec), glitch_rows, scan_row, fp, attempt = design(token_id)
    bg, main, second, eye, sig = colors(t)
    out = []
    for r, c, s, shape, tone in pieces:
        shift = 0
        for gr in glitch_rows:
            if r <= gr < r + s:
                shift = 1 if gr % 2 else -1
        v = ((((r * N + c) * 3 + (s - 1)) * 2 + (1 if shape == "circle" else 0)) * 3 + TONES[tone]) * 3 + (shift + 1)
        out.append(enc(v))
    return [bg, main, second, eye, sig, EYES[t["Eye"]], er, ec, -1 if scan_row is None else scan_row, "".join(out)]

if __name__ == "__main__":
    with ProcessPoolExecutor() as ex:
        rows = list(ex.map(one, range(1, SUPPLY + 1), chunksize=50))
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "collection", "art.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(rows, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path) // 1024, "KB")
