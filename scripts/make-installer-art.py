"""Generate NSIS installer art in the app's design language.

Palette comes from src/styles.css :root tokens.
Outputs 24-bit BMPs (NSIS/MUI requirement).
"""
from PIL import Image, ImageDraw, ImageFont

PAPER = (248, 245, 238)
SURFACE = (255, 253, 249)
SIDEBAR = (240, 237, 230)
INK = (48, 45, 41)
MUTED = (107, 100, 92)
LINE = (222, 216, 206)
ACCENT = (127, 70, 62)
SOFT = (238, 225, 217)

FONT_DIR = r"C:\Windows\Fonts"
ICON = r"C:\Users\valer\Projects 2027\Lotus Notes\src-tauri\icons\icon.png"
OUT_SIDEBAR = r"C:\Users\valer\Projects 2027\Lotus Notes\src-tauri\icons\installer-sidebar.bmp"
OUT_HEADER = r"C:\Users\valer\Projects 2027\Lotus Notes\src-tauri\icons\installer-header.bmp"


def font(name, size):
    return ImageFont.truetype(fr"{FONT_DIR}\{name}", size)


def rounded_tile(size, radius, color):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return tile


def paste_icon(base, cx, y, box):
    icon = Image.open(ICON).convert("RGBA").resize((box, box), Image.LANCZOS)
    base.paste(icon, (cx - box // 2, y), icon)


def centered(d, cx, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text((cx - w / 2, y), text, font=f, fill=fill)
    return y + f.size + d.textbbox((0, 0), text, font=f)[3] - f.size


def make_sidebar():
    w, h = 164, 314
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)

    # Soft vertical wash at the top so the panel feels like the app surface.
    d.rectangle([0, 0, w, 118], fill=SURFACE)
    d.line([0, 118, w, 118], fill=LINE)

    cx = w // 2

    # App icon in a soft rounded tile, like the app icon on its paper surface.
    box = 72
    tile = rounded_tile(box, 18, SOFT)
    img.paste(tile, (cx - box // 2, 34), tile)
    paste_icon(img, cx, 34 + (box - 52) // 2, 52)

    centered(d, cx, 128, "Lotus", font("seguisb.ttf", 26), INK)
    centered(d, cx, 162, "A quiet place for", font("segoeui.ttf", 11), MUTED)
    centered(d, cx, 176, "your notes.", font("segoeui.ttf", 11), MUTED)

    # Terracotta rule — the app's accent.
    d.rounded_rectangle([cx - 18, h - 34, cx + 18, h - 30], radius=2, fill=ACCENT)

    img.save(OUT_SIDEBAR)
    print("sidebar", img.size)


def make_header():
    w, h = 150, 57
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    d.line([0, h - 1, w, h - 1], fill=LINE)

    box = 34
    tile = rounded_tile(box, 9, SOFT)
    img.paste(tile, (w - box - 12, (h - box) // 2), tile)
    icon = Image.open(ICON).convert("RGBA").resize((24, 24), Image.LANCZOS)
    img.paste(icon, (w - box - 12 + 5, (h - 24) // 2), icon)

    f = font("seguisb.ttf", 14)
    text = "Lotus"
    tw = d.textlength(text, font=f)
    d.text((w - box - 24 - tw, (h - f.size) // 2 - 1), text, font=f, fill=INK)

    img.save(OUT_HEADER)
    print("header", img.size)


make_sidebar()
make_header()
