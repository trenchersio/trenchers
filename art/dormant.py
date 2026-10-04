"""Dormant / awake metadata.

Every Trencher has two states on-chain (TrenchersNFT.tokenURI):
  dormant/  until its agent claims the 0.01 ETH starter balance: grey art, "0.01 ETH claimable"
  awake/    once claimed: full colour art
This builds both image sets and both metadata sets from out/images and out/metadata:
  out/release/images/awake/{id}.png     (colour, the generator output)
  out/release/images/dormant/{id}.png   (greyscale, eye dimmed)
  out/release/metadata/awake/{id}.json
  out/release/metadata/dormant/{id}.json
Upload out/release/images to IPFS, put its CID in IMAGES_CID, re-run, then upload
out/release/metadata and set the NFT base URI to ipfs://<metadata CID>/.
"""
import json, os, shutil, sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageEnhance, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "release")
IMAGES_CID = os.environ.get("IMAGES_CID", "IMAGES_CID")
HOUSE = range(1, 6)

def grey(tid):
    src = os.path.join(HERE, "out", "images", f"{tid}.png")
    shutil.copyfile(src, os.path.join(OUT, "images", "awake", f"{tid}.png"))
    im = Image.open(src).convert("RGB")
    g = ImageOps.grayscale(im)
    g = ImageEnhance.Contrast(g).enhance(0.72)
    g = ImageEnhance.Brightness(g).enhance(0.62)
    g = ImageOps.colorize(g, black="#0A0C0B", white="#B4BAB6")  # a faint green-grey cast, on brand
    g.save(os.path.join(OUT, "images", "dormant", f"{tid}.png"), optimize=True)

def meta(tid):
    m = json.load(open(os.path.join(HERE, "out", "metadata", f"{tid}.json")))
    attrs = [a for a in m["attributes"] if a["trait_type"] not in ("Status", "Starter ETH")]
    for state in ("awake", "dormant"):
        if state == "dormant" and tid in HOUSE:
            continue  # house agents are always awake
        d = dict(m)
        d["image"] = f"ipfs://{IMAGES_CID}/{state}/{tid}.png"
        if state == "dormant":
            d["description"] = m["description"] + "\n\nDormant: this Trencher's agent has not been awakened. Its 0.01 ETH starter balance is still claimable by the holder, straight into the agent wallet."
            extra = [{"trait_type": "Status", "value": "Dormant"}, {"trait_type": "Starter ETH", "value": "0.01 ETH claimable"}]
        else:
            d["description"] = m["description"] + ("" if tid in HOUSE else "\n\nAwake: this agent has claimed its starter balance and is registered on-chain.")
            extra = [{"trait_type": "Status", "value": "House agent" if tid in HOUSE else "Awake"},
                     {"trait_type": "Starter ETH", "value": "Not applicable" if tid in HOUSE else "Claimed"}]
        d["attributes"] = extra + attrs
        with open(os.path.join(OUT, "metadata", state, f"{tid}.json"), "w") as f:
            json.dump(d, f, indent=2)

if __name__ == "__main__":
    for p in ("images/awake", "images/dormant", "metadata/awake", "metadata/dormant"):
        os.makedirs(os.path.join(OUT, p), exist_ok=True)
    ids = range(1, 2001)
    if "--meta-only" not in sys.argv:
        with ProcessPoolExecutor() as ex: list(ex.map(grey, ids, chunksize=50))
    for t in ids: meta(t)
    print("release built:", OUT)
