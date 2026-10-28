#!/usr/bin/env python3
"""Build the EPSS vector identity and its raster app/share sizes with Inkscape."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "dist" / "assets"
BLUE = "#087BB7"
FONT = "DejaVu Sans, Arial, sans-serif"

ICON = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="icon-title icon-desc">
  <title id="icon-title">Fichas técnicas EPSS, hospitales</title>
  <desc id="icon-desc">Identidad tipográfica blanca sobre fondo azul. Todo el contenido está dentro del área segura de la máscara del icono.</desc>
  <rect width="512" height="512" fill="{BLUE}"/>
  <g fill="#FFFFFF" text-anchor="middle" font-family="{FONT}">
    <text x="256" y="150" font-size="48" font-weight="700" letter-spacing="1.3">FICHAS</text>
    <text x="256" y="213" font-size="48" font-weight="700" letter-spacing="0.5">TÉCNICAS</text>
    <text x="256" y="337" font-size="122" font-weight="700" letter-spacing="-3">EPSS</text>
    <text x="256" y="412" font-size="56" font-weight="800" letter-spacing="-1.2">HOSPITALES</text>
  </g>
</svg>
'''

SOCIAL = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-labelledby="social-title social-desc">
  <title id="social-title">Fichas técnicas EPSS, hospitales</title>
  <desc id="social-desc">Imagen para la presentación del repositorio de EPSS a la mano. Iniciativa de la DRIPSSHA, Huetar Atlántica.</desc>
  <rect width="1280" height="640" fill="{BLUE}"/>
  <g fill="#FFFFFF" text-anchor="middle" font-family="{FONT}">
    <text x="640" y="165" font-size="60" font-weight="700" letter-spacing="1.4">FICHAS TÉCNICAS</text>
    <text x="640" y="337" font-size="150" font-weight="700" letter-spacing="-3">EPSS</text>
    <text x="640" y="445" font-size="72" font-weight="800" letter-spacing="-1.2">HOSPITALES</text>
    <text x="640" y="565" font-size="25" font-weight="500" fill-opacity="0.9">DRIPSSHA · Huetar Atlántica</text>
  </g>
</svg>
'''


def main():
    inkscape = shutil.which("inkscape")
    if not inkscape:
        raise SystemExit("Inkscape is required to export the PNG assets.")
    ASSETS.mkdir(parents=True, exist_ok=True)
    icon = ASSETS / "icon.svg"
    social = ASSETS / "social-preview.svg"
    icon.write_text(ICON, encoding="utf-8")
    social.write_text(SOCIAL, encoding="utf-8")
    outputs = [(icon, ASSETS / f"icon-{size}.png", size, size) for size in (180, 192, 512)]
    outputs.append((social, ASSETS / "social-preview.png", 1280, 640))
    for source, output, width, height in outputs:
        subprocess.run([
            inkscape, str(source), "--export-type=png",
            f"--export-filename={output}", f"--export-width={width}",
            f"--export-height={height}",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
