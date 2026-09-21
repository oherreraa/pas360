"""Inspecciona la página de colección de resoluciones del TFA para diseñar
el scraper del listado completo. Imprime en stdout (visible en los logs de
Actions) los enlaces a fichas de resolución encontrados y pistas de
paginación, sin depender de descargar el HTML fuera de GitHub Actions.
"""

import os
import re

import requests

LISTADO_URL = os.environ.get("LISTADO_URL") or (
    "https://www.gob.pe/institucion/oefa/colecciones/"
    "1716-resoluciones-del-tribunal-de-fiscalizacion-ambiental-tfa?sheet=9"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "es-PE,es;q=0.9",
}

LINK_RE = re.compile(
    r'href="(/institucion/oefa/informes-publicaciones/[^"]+)"[^>]*>([^<]*)<',
    re.IGNORECASE,
)
SHEET_RE = re.compile(r"[?&]sheet=(\d+)")


def main() -> None:
    resp = requests.get(LISTADO_URL, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    html = resp.text

    with open("listado.html", "w", encoding="utf-8") as f:
        f.write(html)

    print(f"status_code={resp.status_code} html_bytes={len(html)}")

    matches = LINK_RE.findall(html)
    print(f"enlaces_a_resoluciones_encontrados={len(matches)}")
    for href, text in matches[:20]:
        print(f"  - {href.strip()} | {text.strip()[:90]}")

    sheet_numbers = sorted(set(int(n) for n in SHEET_RE.findall(html)))
    print(f"numeros_de_pagina_referenciados={sheet_numbers}")


if __name__ == "__main__":
    main()
