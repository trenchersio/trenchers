"""Logo explorations in the blocks-and-circles style. Writes brand/logo-options/ and a comparison sheet.

Mark grids: S = block, O = circle, E = the agent's eye (green circle), . = empty.
"""
import os
from PIL import Image, ImageDraw, ImageFont

BLACK, FOG, GREEN, QUIET = "#0B0D0C", "#E8ECE9", "#39FF88", "#8A938E"
OUT = "brand/logo-options"
os.makedirs(OUT, exist_ok=True)

MARKS = {
    "A  In the trench": ["SS...SS",
                         "SS.E.SS",
                         "SSSSSSS"],
    "B  T-agent":       ["SSOSS",
                         "..S..",
                         "..E..",
                         "..O..",
                         "..S.."],
    "C  Pixel eye":     ["SOS",
                         "OEO",
                         "SOS"],
    "D  Eye block":     ["SSSSS",
                         "S...S",
                         "S.E.S",
                         "S...S",
                         "SSOSS"],
}

# 5x7 letters; in the wordmark every lit pixel is a block, except the dot style below
GLYPHS = {
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
}


def mark_items(grid):
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch != ".":
                yield r, c, ch


def draw_mark(d, grid, x0, y0, px, fg=FOG, gap_ratio=0.12):
    g = max(1, int(px * gap_ratio))
    for r, c, ch in mark_items(grid):
        box = (x0 + c * px + g, y0 + r * px + g, x0 + (c + 1) * px - g - 1, y0 + (r + 1) * px - g - 1)
        if ch == "S":
            d.rectangle(box, fill=fg)
        else:
            d.ellipse(box, fill=GREEN if ch == "E" else fg)


def draw_word(d, x0, y0, px, fg=FOG, dots=False):
    x = x0
    g = max(1, int(px * 0.1))
    for ch in "TRENCHERS":
        for r, row in enumerate(GLYPHS[ch]):
            for c, bit in enumerate(row):
                if bit == "1":
                    box = (x + c * px + g, y0 + r * px + g, x + (c + 1) * px - g - 1, y0 + (r + 1) * px - g - 1)
                    (d.ellipse if dots else d.rectangle)(box, fill=fg)
        x += 6 * px
    return x - x0 - px


def svg_mark(grid, name):
    h, w = len(grid), len(grid[0])
    parts = []
    for r, c, ch in mark_items(grid):
        fill = GREEN if ch == "E" else FOG
        if ch == "S":
            parts.append(f'<rect x="{c + .06}" y="{r + .06}" width=".88" height=".88" fill="{fill}"/>')
        else:
            parts.append(f'<circle cx="{c + .5}" cy="{r + .5}" r=".44" fill="{fill}"/>')
    with open(os.path.join(OUT, f"{name}.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{"".join(parts)}</svg>')


def main():
    font = ImageFont.truetype("fonts/SpaceGrotesk-Medium.ttf", 26)
    W, ROW = 1800, 300
    sheet = Image.new("RGB", (W, ROW * len(MARKS) + 40), "#151817")
    d = ImageDraw.Draw(sheet)
    for i, (label, grid) in enumerate(MARKS.items()):
        y = 20 + i * ROW
        key = label.split()[0]
        svg_mark(grid, f"mark-{key}")
        d.rectangle((20, y, W - 20, y + ROW - 20), fill=BLACK)
        d.text((44, y + 16), label, font=font, fill=QUIET)
        # 1) large mark
        h, w = len(grid), len(grid[0])
        px = 160 // max(h, w)
        draw_mark(d, grid, 60 + (180 - w * px) // 2, y + 70 + (180 - h * px) // 2, px)
        # 2) lockups: block wordmark (top) and dot-matrix wordmark (below)
        mpx = 63 // h
        for k, dots in enumerate((False, True)):
            lx, ly = 340, y + 70 + k * 100
            draw_mark(d, grid, lx, ly + (63 - h * mpx) // 2, mpx)
            draw_word(d, lx + w * mpx + 28, ly, 9, dots=dots)
            d.text((lx + w * mpx + 28 + 53 * 9 + 30, ly + 20), "dot letters" if dots else "block letters",
                   font=ImageFont.truetype("fonts/SpaceGrotesk-Medium.ttf", 18), fill=QUIET)
        # 4) avatar + favicon-size check
        ax = W - 210
        av = Image.new("RGB", (150, 150), BLACK)
        ad = ImageDraw.Draw(av)
        apx = 150 // (max(h, w) + 3)
        draw_mark(ad, grid, (150 - w * apx) // 2, (150 - h * apx) // 2, apx)
        sheet.paste(av, (ax, y + 50))
        av.save(os.path.join(OUT, f"avatar-{key}.png"))
        fav = av.resize((32, 32), Image.LANCZOS)
        sheet.paste(fav, (ax - 90, y + 110))
        d.text((ax - 100, y + 150), "32px", font=ImageFont.truetype("fonts/SpaceGrotesk-Medium.ttf", 16), fill=QUIET)
    sheet.save(os.path.join(OUT, "logo-options.png"))
    print("written", OUT)


if __name__ == "__main__":
    main()
