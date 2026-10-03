"""Trenchers generative art.

Each piece is a 24x24 grid of pixel blocks and circles. All pieces share one base design:
the same grid, margin and palette family, and one glowing "eye" module (the agent). What
varies per token: palette, pattern, shape mix, scale, density, eye, signal colour, and a
few rare traits. Every token is checked to be unique; the build fails on any duplicate.

Deterministic: token N always renders the same image from SALT + N.

    python3 generate.py                  # all 2,000 images + metadata into out/
    python3 generate.py --only 1-64      # a range, for previews
"""
import argparse, hashlib, json, math, os, random
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageDraw

SALT = "trenchers-v2"
SUPPLY = 2000
TEAM = range(1, 6)            # token IDs 1-5 are the dev agents
N = 24                        # cells per side
MARGIN = 2                    # empty cells around the grid
MOD = 40                      # output pixels per cell -> 1120 px images
SS = 2                        # supersampling for circles
IMAGE_BASE = "ipfs://IMAGES_CID/"   # replaced at upload time

INK_BLACK, FOG = "#0B0D0C", "#E8ECE9"
GREEN, AMBER, RED, GOLD = "#39FF88", "#FFB020", "#FF4D4D", "#FFD54A"

# name: (background, main ink, secondary ink, eye, signal), weight
PALETTES = {
    "Terminal":    (("#0B0D0C", GREEN, "#1F6B42", FOG, AMBER), 22),
    "Amber Alert": (("#0B0D0C", AMBER, "#7A5310", FOG, RED), 14),
    "Paper":       ((FOG, INK_BLACK, "#9AA39E", GREEN, RED), 14),
    "Red Day":     (("#0B0D0C", RED, "#7A2626", FOG, AMBER), 10),
    "Deep Blue":   (("#0A1020", "#4DA3FF", "#21456E", GREEN, AMBER), 12),
    "Violet Hour": (("#120B1E", "#B784FF", "#4E3770", GREEN, AMBER), 10),
    "Mint Paper":  (("#DFF7E9", "#0B3D24", "#7FB894", RED, AMBER), 12),
    "Ghost":       (("#1A1D1C", "#59605C", "#2C312F", GREEN, GREEN), 6),
}
DEV_PALETTE = ("#0B0D0C", GOLD, "#6E5A1C", GREEN, FOG)

PATTERNS = {"Scatter": 16, "Clusters": 24, "Mirror": 18, "Quad": 10, "Rain": 12, "Orbit": 10, "Stack": 10}
SHAPES = {"Blocks": 30, "Circles": 25, "Mixed": 45}
SCALE = {"Fine": 45, "Chunky": 40, "Bold": 15}
DENSITY = {"Sparse": (0.30, 30), "Balanced": (0.44, 50), "Dense": (0.58, 20)}
EYES = {"Square": 30, "Circle": 30, "Ring": 25, "Core": 15}
SIGNAL = {"None": 50, "Low": 35, "High": 15}
RARE = [("Inverted", 0.03), ("Gold Touch", 0.02), ("Glitch", 0.04), ("Scanline", 0.05)]


def pick(rng, table):
    names = list(table)
    weights = [v[1] if isinstance(v, tuple) else v for v in table.values()]
    return rng.choices(names, weights=weights)[0]


def field(rng, pattern, dens):
    """Boolean N x N grid of filled cells for the chosen pattern."""
    on = lambda p=dens: rng.random() < p
    g = [[False] * N for _ in range(N)]
    if pattern == "Scatter":
        g = [[on() for _ in range(N)] for _ in range(N)]
    elif pattern == "Clusters":
        g = [[on(dens + 0.08) for _ in range(N)] for _ in range(N)]
        for _ in range(2):  # cellular smoothing -> organic blobs
            g = [[sum(g[(r + dr) % N][(c + dc) % N] for dr in (-1, 0, 1) for dc in (-1, 0, 1)) >= 5
                  for c in range(N)] for r in range(N)]
    elif pattern in ("Mirror", "Quad"):
        h = N // 2
        for r in range(N if pattern == "Mirror" else h):
            for c in range(h):
                g[r][c] = on()
        for r in range(N):
            for c in range(h, N):
                g[r][c] = g[r][N - 1 - c]
        if pattern == "Quad":
            for r in range(h, N):
                g[r] = list(g[N - 1 - r])
    elif pattern == "Rain":
        for c in range(N):
            r = rng.randrange(N)
            length = int(N * dens * rng.uniform(0.6, 1.6))
            for i in range(length):
                g[(r + i) % N][c] = rng.random() > 0.12
    elif pattern == "Orbit":
        cx, cy = rng.uniform(8, 16), rng.uniform(8, 16)
        rings = rng.choice([3, 4, 5])
        for r in range(N):
            for c in range(N):
                d = math.hypot(r - cy, c - cx)
                band = (d / rings) % 1.0
                g[r][c] = band < dens + 0.1 and rng.random() > 0.15
    elif pattern == "Stack":
        r = 0
        while r < N:
            h = rng.randint(1, 3)
            if rng.random() < dens + 0.4:
                a = rng.randrange(N // 3)
                b = rng.randrange(N // 2, N + 1)
                for rr in range(r, min(N, r + h)):
                    for c in range(a, b):
                        g[rr][c] = rng.random() > 0.08
            r += h + (1 if rng.random() < 0.35 else 0)
    return g


def design(token_id):
    """Traits and the full cell layout for a token."""
    attempt = 0
    while True:
        seed = f"{SALT}:{token_id}" + (f":{attempt}" if attempt else "")
        rng = random.Random(hashlib.sha256(seed.encode()).digest())
        dev = token_id in TEAM
        t = {
            "Role": "Dev Agent" if dev else "Agent",
            "Palette": "Founder" if dev else pick(rng, PALETTES),
            "Pattern": pick(rng, PATTERNS),
            "Shapes": pick(rng, SHAPES),
            "Scale": pick(rng, SCALE),
            "Density": pick(rng, DENSITY),
            "Eye": pick(rng, EYES),
            "Signal": pick(rng, SIGNAL),
            "Special": "None",
        }
        if not dev:
            for name, p in RARE:
                if rng.random() < p:
                    t["Special"] = name
                    break
        g = field(rng, t["Pattern"], DENSITY[t["Density"]][0])

        # the eye: a 2x2 module at a random spot, with a clear 1-cell border around it
        er, ec = rng.randrange(2, N - 3), rng.randrange(2, N - 3)
        for r in range(er - 1, er + 3):
            for c in range(ec - 1, ec + 3):
                g[r][c] = False

        # group filled cells into shapes: big 3x3 / 2x2 pieces first (by scale), then singles
        used = [[False] * N for _ in range(N)]
        p_big = {"Fine": 0.15, "Chunky": 0.55, "Bold": 0.85}[t["Scale"]]
        p_circle = {"Blocks": 0.1, "Circles": 0.9, "Mixed": 0.5}[t["Shapes"]]
        sig_p = {"None": 0.0, "Low": 0.05, "High": 0.14}[t["Signal"]]
        pieces = []
        for size in (3, 2, 1):
            for r in range(N - size + 1):
                for c in range(N - size + 1):
                    cells = [(r + i, c + j) for i in range(size) for j in range(size)]
                    if any(used[a][b] or not g[a][b] for a, b in cells):
                        continue
                    if size > 1 and rng.random() > p_big * (0.6 if size == 3 else 1):
                        continue
                    for a, b in cells:
                        used[a][b] = True
                    shape = "circle" if rng.random() < p_circle else "block"
                    tone = "signal" if rng.random() < sig_p else ("second" if rng.random() < 0.22 else "main")
                    pieces.append((r, c, size, shape, tone))
        glitch_rows = sorted(rng.sample(range(2, N - 2), 3)) if t["Special"] == "Glitch" else []
        scan_row = rng.randrange(3, N - 3) if t["Special"] == "Scanline" else None

        layout = (tuple(sorted(t.items())), tuple(pieces), (er, ec), tuple(glitch_rows), scan_row)
        fingerprint = hashlib.sha256(repr(layout).encode()).hexdigest()
        return t, pieces, (er, ec), glitch_rows, scan_row, fingerprint, attempt


def colors(t):
    bg, main, second, eye, sig = DEV_PALETTE if t["Palette"] == "Founder" else PALETTES[t["Palette"]][0]
    if t["Special"] == "Inverted":
        bg, main = main, bg
    if t["Special"] == "Gold Touch":
        eye, sig = GOLD, GOLD
    if eye.lower() == bg.lower():
        eye = second
    return bg, main, second, eye, sig


def render(token_id):
    t, pieces, (er, ec), glitch_rows, scan_row, fp, attempt = design(token_id)
    bg, main, second, eye, sig = colors(t)
    m = MOD * SS
    size = (N + 2 * MARGIN) * m
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    tone_color = {"main": main, "second": second, "signal": sig}

    for r, c, s, shape, tone in pieces:
        shift = 0
        for gr in glitch_rows:
            if r <= gr < r + s:
                shift = m if gr % 2 else -m
        x0 = (c + MARGIN) * m + shift
        y0 = (r + MARGIN) * m
        x1, y1 = x0 + s * m, y0 + s * m
        gap = m // 10
        box = (x0 + gap, y0 + gap, x1 - gap - 1, y1 - gap - 1)
        if shape == "circle":
            d.ellipse(box, fill=tone_color[tone])
        else:
            d.rectangle(box, fill=tone_color[tone])

    # the eye: 2x2 cells
    x0, y0 = (ec + MARGIN) * m, (er + MARGIN) * m
    x1, y1 = x0 + 2 * m, y0 + 2 * m
    g = m // 10
    if t["Eye"] == "Square":
        d.rectangle((x0 + g, y0 + g, x1 - g - 1, y1 - g - 1), fill=eye)
    elif t["Eye"] == "Circle":
        d.ellipse((x0 + g, y0 + g, x1 - g - 1, y1 - g - 1), fill=eye)
    elif t["Eye"] == "Ring":
        d.ellipse((x0 + g, y0 + g, x1 - g - 1, y1 - g - 1), fill=eye)
        k = int(m * 0.45)
        d.ellipse((x0 + k, y0 + k, x1 - k - 1, y1 - k - 1), fill=bg)
    else:  # Core: square frame with a lit centre
        d.rectangle((x0 + g, y0 + g, x1 - g - 1, y1 - g - 1), fill=eye)
        k = int(m * 0.4)
        d.rectangle((x0 + k, y0 + k, x1 - k - 1, y1 - k - 1), fill=bg)
        k2 = int(m * 0.75)
        d.rectangle((x0 + k2, y0 + k2, x1 - k2 - 1, y1 - k2 - 1), fill=eye)

    if scan_row is not None:
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        y = (scan_row + MARGIN) * m
        ImageDraw.Draw(overlay).rectangle((MARGIN * m, y, (N + MARGIN) * m - 1, y + m - 1), fill=(57, 255, 136, 60))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    img = img.resize((size // SS, size // SS), Image.LANCZOS)
    return img, t, fp


def build(token_id, outdir):
    img, t, fp = render(token_id)
    path = os.path.join(outdir, "images", f"{token_id}.png")
    img.save(path, optimize=True)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    meta = {
        "name": f"Trenchers #{token_id}",
        "description": "Trenchers is an ecosystem of self-funding, NFT-enabled AI trading agents on Robinhood Chain. Register a Trencher as an agent with its own wallet, pick a memecoin trading strategy, compete in the Arena and launch its own agent coin on Pons. Agents earn their coin's creator fees plus a share of 10% of all $TRENCHERS fees. The agent, its wallet and its income move with the NFT.",
        "image": f"{IMAGE_BASE}{token_id}.png",
        "attributes": [{"trait_type": k, "value": v} for k, v in t.items()],
    }
    with open(os.path.join(outdir, "metadata", f"{token_id}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    return token_id, digest, fp, t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="range like 1-64")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    lo, hi = (map(int, a.only.split("-")) if a.only else (1, SUPPLY))
    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "metadata"), exist_ok=True)
    ids = list(range(lo, hi + 1))
    with ProcessPoolExecutor() as ex:
        results = sorted(ex.map(build, ids, [a.out] * len(ids)))

    # Uniqueness: no two tokens may share a layout, and no two images may be byte-identical.
    fps = [fp for _, _, fp, _ in results]
    digests = [h for _, h, _, _ in results]
    assert len(set(fps)) == len(fps), "duplicate layout"
    assert len(set(digests)) == len(digests), "duplicate image"

    provenance = hashlib.sha256("".join(digests).encode()).hexdigest()
    counts = {}
    for _, _, _, t in results:
        for k, v in t.items():
            counts.setdefault(k, {}).setdefault(v, 0)
            counts[k][v] += 1
    report = {"tokens": len(results), "provenance_sha256": provenance,
              "image_hashes": {i: h for i, h, _, _ in results}, "trait_counts": counts}
    with open(os.path.join(a.out, "provenance.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"{len(results)} tokens, all unique, provenance {provenance}")
    for k, v in counts.items():
        print(f"  {k}: " + ", ".join(f"{n} {c}" for n, c in sorted(v.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()
