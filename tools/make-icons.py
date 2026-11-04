"""產生工具列圖示：盾牌加勾勾。用法：python3 tools/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)
S = 512  # 先畫大圖再縮小，邊緣比較平滑


def shield(draw, inset, fill):
    w = S - inset * 2
    top = inset + int(w * 0.02)
    cx = S / 2
    pts = [
        (cx, top),
        (inset + w * 0.96, top + w * 0.14),
        (inset + w * 0.92, top + w * 0.52),
        (cx + w * 0.22, top + w * 0.84),
        (cx, top + w * 0.96),
        (cx - w * 0.22, top + w * 0.84),
        (inset + w * 0.08, top + w * 0.52),
        (inset + w * 0.04, top + w * 0.14),
    ]
    draw.polygon(pts, fill=fill)


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
shield(d, 8, (12, 74, 110, 255))     # 深藍外框
shield(d, 44, (26, 127, 55, 255))    # 綠色內盾
# 白色勾勾
d.line([(150, 270), (225, 345), (370, 185)], fill=(255, 255, 255, 255), width=56, joint="curve")
for x, y in [(150, 270), (370, 185)]:
    d.ellipse([x - 28, y - 28, x + 28, y + 28], fill=(255, 255, 255, 255))

for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
print("ok", sorted(p.name for p in OUT.iterdir()))
