"""One-off icon generator for HealthNote PWA. Run once with `python gen_icons.py`."""
from PIL import Image, ImageDraw

BG = (15, 15, 15, 255)
MINT = (0, 229, 160, 255)

def make_icon(size, path, maskable=False):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    if maskable:
        # safe zone padding ~10% for maskable icons
        pad = int(size * 0.14)
    else:
        pad = int(size * 0.08)

    # rounded square background already filled; draw a heart/pulse mark
    cx, cy = size / 2, size / 2
    r = (size - pad * 2) / 2

    # draw a simple heartbeat pulse line inside a circle
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=MINT, width=max(2, size // 40))

    w = size // 14
    pts = [
        (cx - r * 0.7, cy),
        (cx - r * 0.35, cy),
        (cx - r * 0.18, cy - r * 0.5),
        (cx, cy + r * 0.5),
        (cx + r * 0.18, cy - r * 0.3),
        (cx + r * 0.35, cy),
        (cx + r * 0.7, cy),
    ]
    d.line(pts, fill=MINT, width=w, joint="curve")

    img.save(path)

make_icon(192, "../icons/icon-192.png")
make_icon(512, "../icons/icon-512.png")
make_icon(512, "../icons/icon-maskable-512.png", maskable=True)
make_icon(180, "../icons/apple-touch-icon.png")
print("done")
