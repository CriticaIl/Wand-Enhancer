"""Draws the SaveForge icons (extension, toolbar, iOS app icon) with Pillow."""
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(HERE, '..', 'extension', 'images')
APPICON = os.path.join(HERE, '..', 'ios', 'SaveForge', 'Assets.xcassets', 'AppIcon.appiconset')


def hexagon(cx, cy, r):
    return [(cx + r * math.cos(math.radians(90 + 60 * i)), cy + r * math.sin(math.radians(90 + 60 * i))) for i in range(6)]


def draw(size, rounded=True, opaque=False):
    s = size * 4  # supersample
    img = Image.new('RGBA', (s, s), (6, 7, 11, 255) if opaque else (0, 0, 0, 0))
    grad = Image.new('RGBA', (s, s))
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            a = (61, 245, 167)
            b = (34, 211, 238)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    else:
        md.rectangle([0, 0, s - 1, s - 1], fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    c = s / 2
    d.polygon(hexagon(c, c, s * 0.34), fill=(3, 20, 13, 255))
    d.polygon(hexagon(c, c, s * 0.19), fill=(61, 245, 167, 255) if not opaque else (34, 211, 238, 255))
    d.polygon(hexagon(c, c, s * 0.10), fill=(3, 20, 13, 255))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(EXT, exist_ok=True)
    for n in (48, 64, 96, 128, 256, 512):
        draw(n).save(os.path.join(EXT, f'icon-{n}.png'))
    for n in (16, 19, 32, 38, 48, 72):
        draw(n).save(os.path.join(EXT, f'toolbar-icon-{n}.png'))
    os.makedirs(APPICON, exist_ok=True)
    # App Store icons must be square and opaque; iOS applies the rounded mask itself.
    draw(1024, rounded=False, opaque=True).convert('RGB').save(os.path.join(APPICON, 'AppIcon-1024.png'))
    print('icons written')
