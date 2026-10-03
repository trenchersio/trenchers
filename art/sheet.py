"""Contact sheet of rendered tokens: python3 sheet.py out/images 1 64 sheet.png [cols]"""
import sys
from PIL import Image
d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 8
tile, gap = 220, 8
ids = list(range(lo, hi + 1))
rows = -(-len(ids) // cols)
sheet = Image.new("RGB", (cols * (tile + gap) + gap, rows * (tile + gap) + gap), "#0B0D0C")
for k, i in enumerate(ids):
    im = Image.open(f"{d}/{i}.png").resize((tile, tile), Image.LANCZOS)
    sheet.paste(im, (gap + (k % cols) * (tile + gap), gap + (k // cols) * (tile + gap)))
sheet.save(out)
