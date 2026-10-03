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
# The mark ("Pixel eye"): blocks and circles around the agent's green eye. S block, O circle, E eye.
MARK = ["SOS", "OEO", "SOS"]
MARK_GAP = 0.12   # gap around each mark piece, as a share of its cell


def mark_items():
    for r, row in enumerate(MARK):
        for c, ch in enumerate(row):
            yield r, c, ch


def draw_mark(d, x0, y0, px, fg=FOG):
    g = max(1, int(px * MARK_GAP))
    for r, c, ch in mark_items():
        box = (x0 + c * px + g, y0 + r * px + g, x0 + (c + 1) * px - g - 1, y0 + (r + 1) * px - g - 1)
        if ch == "S":
            d.rectangle(box, fill=fg)
        else:
            d.ellipse(box, fill=GREEN if ch == "E" else fg)


def mark_svg_parts(scale=1.0, ox=0.0, oy=0.0, fg=FOG):
    parts = []
    for r, c, ch in mark_items():
        x, y = ox + c * scale, oy + r * scale
        if ch == "S":
            k = MARK_GAP * scale
            parts.append(f'<rect x="{x + k:.3f}" y="{y + k:.3f}" width="{scale - 2 * k:.3f}" height="{scale - 2 * k:.3f}" fill="{fg}"/>')
        else:
            parts.append(f'<circle cx="{x + scale / 2:.3f}" cy="{y + scale / 2:.3f}" r="{scale / 2 - MARK_GAP * scale:.3f}" fill="{GREEN if ch == "E" else fg}"/>')
    return parts


def word_cells(text="TRENCHERS", gap=1):
    x = 0
    for ch in text:
        for r, row in enumerate(GLYPHS[ch]):
            for c, bit in enumerate(row):
                if bit == "1":
                    yield r, x + c
        x += 5 + gap


WORD_W = 9 * 6 - 1  # 9 letters x (5 + 1 gap) - trailing gap


MARK_UNIT = 7 / 3                     # one mark cell = 7/3 letter pixels, so the mark is as tall as the letters
WORD_X = 7 + 3                        # wordmark starts after the 7-unit mark and a 3-unit gap
LOCKUP_W, LOCKUP_H = WORD_X + WORD_W, 7


def word_svg_parts(ox, fg):
    g = 0.1
    return [f'<rect x="{ox + c + g:.2f}" y="{r + g:.2f}" width="{1 - 2 * g:.2f}" height="{1 - 2 * g:.2f}" fill="{fg}"/>'
            for r, c in word_cells()]


def write_svg(name, w, h, parts):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.3f} {h:.3f}">{"".join(parts)}</svg>')


def draw_lockup(d, x0, y0, px, fg=FOG):
    draw_mark(d, x0, y0, px * MARK_UNIT, fg)
    g = max(1, int(px * 0.1))
    for r, c in word_cells():
        x = x0 + (WORD_X + c) * px
        y = y0 + r * px
        d.rectangle((x + g, y + g, x + px - g - 1, y + px - g - 1), fill=fg)


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
    draw_lockup(d, x0, y0, px)
    if tagline:
        f = ImageFont.truetype(FONT, max(14, int(px * 2.6)))
        text = "An on-chain AI trading agent ecosystem"
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, y0 + lh + px * 3), text, font=f, fill=QUIET)
    img.save(os.path.join(OUT, name))


def main():
    write_svg("mark.svg", 3, 3, mark_svg_parts())
    write_svg("lockup.svg", LOCKUP_W, LOCKUP_H, mark_svg_parts(MARK_UNIT) + word_svg_parts(WORD_X, FOG))
    write_svg("lockup-on-light.svg", LOCKUP_W, LOCKUP_H,
              mark_svg_parts(MARK_UNIT, fg=BLACK) + word_svg_parts(WORD_X, BLACK))

    # Avatar: the mark centred on black, square.
    for size in (1000, 512, 32):
        img = Image.new("RGB", (size, size), BLACK)
        px = size / 5
        off = (size - 3 * px) / 2
        draw_mark(ImageDraw.Draw(img), off, off, px)
        img.save(os.path.join(OUT, f"avatar-{size}.png" if size != 32 else "favicon-32.png"))

    # Wordmark lockup PNG for docs and decks
    px = 24
    img = Image.new("RGB", ((LOCKUP_W + 8) * px, (LOCKUP_H + 8) * px), BLACK)
    draw_lockup(ImageDraw.Draw(img), 4 * px, 4 * px, px)
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
