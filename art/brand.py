"""Trenchers brand kit: logo mark + wordmark (SVG and PNG), collection avatar, banners.

    python3 brand.py   # writes into brand/
Needs out/images (from generate.py) for the banners' token strips.
"""
import os
from PIL import Image, ImageDraw, ImageFont

BLACK, FOG, GREEN, AMBER, RED = "#0B0D0C", "#E8ECE9", "#39FF88", "#FFB020", "#FF4D4D"
QUIET = "#8A938E"
OUT = "brand"
os.makedirs(OUT, exist_ok=True)
FONT = "fonts/SpaceGrotesk-Medium.ttf"
MONO = "fonts/JetBrainsMono-Medium.ttf"

# 5x7 pixel letters drawn for the wordmark (no third-party pixel font to license)
GLYPHS = {
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
}
# The mark: a QR finder square whose centre module is the agent's lit eye.
MARK = ["1111111", "1000001", "1011101", "101E101", "1011101", "1000001", "1111111"]


def mark_cells():
    for r, row in enumerate(MARK):
        for c, ch in enumerate(row):
            if ch != "0":
                yield r, c, GREEN if ch == "E" else FOG


def word_cells(text="TRENCHERS", gap=1):
    x = 0
    for ch in text:
        for r, row in enumerate(GLYPHS[ch]):
            for c, bit in enumerate(row):
                if bit == "1":
                    yield r, x + c
        x += 5 + gap


WORD_W = 9 * 6 - 1  # 9 letters x (5 + 1 gap) - trailing gap


def svg(cells, w, h, bg=None):
    rects = "".join(f'<rect x="{c}" y="{r}" width="1" height="1" fill="{f}"/>' for r, c, f in cells)
    back = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">'
            f"{back}{rects}</svg>")


def lockup_cells(fg=FOG):
    cells = list(mark_cells())
    for r, c in word_cells():
        cells.append((r, c + 7 + 3, fg))   # wordmark to the right of the mark, 3-module gap
    return cells


LOCKUP_W, LOCKUP_H = 7 + 3 + WORD_W, 7


def draw_cells(d, cells, x0, y0, px):
    for r, c, f in cells:
        d.rectangle((x0 + c * px, y0 + r * px, x0 + (c + 1) * px - 1, y0 + (r + 1) * px - 1), fill=f)


def strip(img, ids, y, size, gap, x0=0, dim=1.0):
    x = x0
    for i in ids:
        tile = Image.open(f"out/images/{i}.png").resize((size, size), Image.LANCZOS)
        if dim < 1:
            tile = Image.blend(Image.new("RGB", tile.size, BLACK), tile, dim)
        img.paste(tile, (x, y))
        x += size + gap


def banner(name, w, h, ids, tagline=True):
    img = Image.new("RGB", (w, h), BLACK)
    d = ImageDraw.Draw(img)
    size = int(h * 0.42)
    gap = max(8, size // 14)
    n = w // (size + gap) + 2
    strip(img, ids[:n], h - size // 2, size, gap, -size // 3, dim=0.55)   # half-cropped strip at the foot
    px = max(4, int(min(w * 0.55 / LOCKUP_W, h * 0.22 / LOCKUP_H)))
    lw, lh = LOCKUP_W * px, LOCKUP_H * px
    x0, y0 = (w - lw) // 2, int(h * 0.18)
    draw_cells(d, lockup_cells(), x0, y0, px)
    if tagline:
        f = ImageFont.truetype(FONT, max(14, int(px * 2.6)))
        text = "2,000 on-chain trading agents  ·  Robinhood Chain"
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, y0 + lh + px * 3), text, font=f, fill=QUIET)
    img.save(os.path.join(OUT, name))


def main():
    with open(os.path.join(OUT, "mark.svg"), "w") as f:
        f.write(svg(mark_cells(), 7, 7))
    with open(os.path.join(OUT, "lockup.svg"), "w") as f:
        f.write(svg(lockup_cells(), LOCKUP_W, LOCKUP_H))
    with open(os.path.join(OUT, "lockup-on-light.svg"), "w") as f:
        f.write(svg([(r, c, BLACK if col == FOG else col) for r, c, col in lockup_cells()], LOCKUP_W, LOCKUP_H))

    # Collection avatar: the mark centred on black, square.
    for size in (1000, 512, 32):
        img = Image.new("RGB", (size, size), BLACK)
        px = size // 11
        off = (size - 7 * px) // 2
        draw_cells(ImageDraw.Draw(img), mark_cells(), off, off, px)
        img.save(os.path.join(OUT, f"avatar-{size}.png" if size != 32 else "favicon-32.png"))

    # Wordmark lockup PNG for docs and decks
    px = 24
    img = Image.new("RGB", ((LOCKUP_W + 8) * px, (LOCKUP_H + 8) * px), BLACK)
    draw_cells(ImageDraw.Draw(img), lockup_cells(), 4 * px, 4 * px, px)
    img.save(os.path.join(OUT, "lockup.png"))

    showcase = [418, 77, 1203, 9, 640, 1555, 333, 1789, 25, 1402, 980, 61, 1650, 207, 1111, 7, 1999, 512]
    banner("opensea-banner-1400x350.png", 1400, 350, showcase)
    banner("x-header-1500x500.png", 1500, 500, showcase[3:])
    banner("discord-banner-960x540.png", 960, 540, showcase[6:])
    banner("og-image-1200x630.png", 1200, 630, showcase[2:])

    # Palette swatch sheet
    sw = [("Trench Black", BLACK), ("Terminal Green", GREEN), ("Signal Amber", AMBER), ("Loss Red", RED), ("Fog", FOG)]
    img = Image.new("RGB", (1200, 360), "#151817")
    d = ImageDraw.Draw(img)
    f, fm = ImageFont.truetype(FONT, 26), ImageFont.truetype(MONO, 22)
    for i, (n, hexv) in enumerate(sw):
        x = 40 + i * 228
        d.rectangle((x, 40, x + 200, 220), fill=hexv, outline="#2A2F2D")
        d.text((x, 240), n, font=f, fill=FOG)
        d.text((x, 280), hexv, font=fm, fill=QUIET)
    img.save(os.path.join(OUT, "palette.png"))
    print("brand kit written to", OUT)


if __name__ == "__main__":
    main()
