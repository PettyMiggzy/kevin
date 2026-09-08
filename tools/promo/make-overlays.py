#!/usr/bin/env python3
"""
Text for the promo, drawn here rather than prompted.

Video models cannot write. Asked for a whiteboard with a list on it, Kling
returns confident gibberish — see the p3 preview. So every shot whose point is
words is generated deliberately BLANK and the words are composited on top, in
the real brand fonts.

    python3 tools/promo/make-overlays.py <out_dir> <font_dir>

font_dir holds luckiest-guy-400.ttf and space-mono-700.ttf, converted from the
woff2 in assets/fonts with fontTools.
"""
import sys, pathlib
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(sys.argv[1]); FONTS = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1920, 1080
VOID = (255, 229, 0, 255); INK = (11, 11, 11, 255); RED = (232, 35, 43, 255)

lg = lambda s: ImageFont.truetype(str(FONTS / 'luckiest-guy-400.ttf'), s)
sm = lambda s: ImageFont.truetype(str(FONTS / 'space-mono-700.ttf'), s)

def measure(d, t, f):
    b = d.textbbox((0, 0), t, font=f)
    return b[2] - b[0], b[3] - b[1], b

def lower_third(name, big, small):
    """A solid brand bar, bottom left.

    Over photoreal footage a filled bar beats outlined or shadowed type: the
    plate behind is busy and moving, and an outline still has to compete with
    it. A bar simply wins, and it is on brand anyway.
    """
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    fb, fs = lg(120), sm(38)
    bw, bh, bb = measure(d, big, fb)
    sw, sh, sb = measure(d, small, fs)
    padx, pady = 44, 30
    barw, barh = max(bw, sw) + padx * 2, bh + sh + pady * 2 + 26
    x0, y0 = 96, H - 96 - barh
    d.rectangle([x0, y0, x0 + barw, y0 + barh], fill=VOID)
    d.text((x0 + padx - bb[0], y0 + pady - bb[1]), big, font=fb, fill=INK)
    d.text((x0 + padx - sb[0], y0 + pady + bh + 22 - sb[1]), small, font=fs, fill=RED)
    im.save(OUT / f'{name}.png')

lower_third('lt-billion', 'A BILLION', 'TOTAL SUPPLY')
lower_third('lt-40', '40%', 'SOLD AT AUCTION, OVER FOUR DAYS')
lower_third('lt-60', '60%', 'INTO LOCKED LIQUIDITY')
lower_third('lt-0', '0%', 'TO THE CREATOR. ENFORCED BY THE FACTORY.')
lower_third('lt-chain', 'ON CHAIN', 'ANYONE CAN CHECK IT. PEOPLE HAVE.')

def board():
    """The whiteboard, verbatim from docs/LORE.md. Three ticked, sleep later."""
    im = Image.new('RGBA', (980, 620), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.text((40, 26), 'ROBIN PLAN:', font=lg(76), fill=INK)
    d.line([(40, 120), (560, 120)], fill=INK, width=6)
    y = 160
    for label, ticked in [('LAUNCH', True), ('MOON', True), ('LAMBO', True), ('SLEEP', False)]:
        d.rectangle([44, y + 10, 88, y + 54], outline=INK, width=6)
        if ticked:
            d.line([(52, y + 34), (66, y + 48)], fill=INK, width=9)
            d.line([(66, y + 48), (84, y + 18)], fill=INK, width=9)
        d.text((116, y), label, font=lg(64), fill=INK)
        y += 104
    d.text((320, y - 104), 'LATER', font=lg(52), fill=RED)
    im.save(OUT / 'board.png')
board()

im = Image.new('RGBA', (W, H), VOID); d = ImageDraw.Draw(im)
for t, f, c, y in [('IAMKEVIN.LOL', lg(190), INK, 380),
                   ('$KEVIN  ·  ROBINHOOD CHAIN', sm(52), RED, 660)]:
    tw, th, bb = measure(d, t, f)
    d.text(((W - tw) / 2 - bb[0], y), t, font=f, fill=c)
im.save(OUT / 'end.png')

print('overlays:', sorted(p.name for p in OUT.glob('*.png')))
