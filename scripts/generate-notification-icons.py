#!/usr/bin/env python3
"""Icônes des notifications Android (lot 2, maquette 28), produites à partir des dessins existants de l'app.

- Petite icône de la barre d'état « ic_stat_bim » : le « B » de BIM en blanc sur fond transparent (Android exige une
  icône monochrome ; il la colore lui-même), aux 5 densités d'écran.
- Avatar de Peni affiché dans la notification (« grande icône ») : copies en image des poses existantes, sans aucune
  modification du dessin de Peni (les fichiers SVG de l'app restent la référence).

Relancer après un changement des dessins : python3 scripts/generate-notification-icons.py
Dépendances : cairosvg, Pillow.
"""
import io
import os

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "apps/mobile/assets")
RES = os.path.join(ROOT, "apps/mobile/android/app/src/main/res")

DENSITIES = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}
POSES = ["happy", "think", "sad"]


def render(svg_path: str, height: int) -> Image.Image:
    png = cairosvg.svg2png(url=svg_path, output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def small_icon(size: int) -> Image.Image:
    """« B » blanc, centré, marge de 2/24 (règles d'Android pour les icônes de barre d'état)."""
    inner = round(size * 20 / 24)
    b = render(os.path.join(ASSETS, "brand/b_red.svg"), inner * 4)
    b = b.crop(b.getbbox())
    b.thumbnail((inner, inner), Image.LANCZOS)
    alpha = b.getchannel("A")
    white = Image.new("RGBA", b.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(white, ((size - b.width) // 2, (size - b.height) // 2), white)
    return canvas


def main() -> None:
    for density, size in DENSITIES.items():
        folder = os.path.join(RES, f"drawable-{density}")
        os.makedirs(folder, exist_ok=True)
        small_icon(size).save(os.path.join(folder, "ic_stat_bim.png"), optimize=True)
    folder = os.path.join(RES, "drawable-nodpi")
    os.makedirs(folder, exist_ok=True)
    for pose in POSES:
        img = render(os.path.join(ASSETS, f"peni/peni_{pose}.svg"), 256)
        img.save(os.path.join(folder, f"peni_notif_{pose}.png"), optimize=True)
    print("Icônes de notification générées dans", RES)


if __name__ == "__main__":
    main()
