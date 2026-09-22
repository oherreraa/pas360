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

HREF_RE = re.compile(r'href="([^"]+)"')
SHEET_RE = re.compile(r"[?&]sheet=(\d+)")


def main() -> None:
    resp = requests.get(LISTADO_URL, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    html = resp.text

    with open("listado.html", "w", encoding="utf-8") as f:
        f.write(html)

    print(f"status_code={resp.status_code} html_bytes={len(html)}")

    all_hrefs = HREF_RE.findall(html)
    print(f"total_hrefs={len(all_hrefs)}")

    informes_hrefs = sorted(set(h for h in all_hrefs if "/informes-publicaciones/" in h))
    print(f"informes_hrefs_unicos={len(informes_hrefs)}")
    for h in informes_hrefs[:30]:
        print(f"  - {h}")

    numeric_hrefs = [h for h in informes_hrefs if re.search(r"/informes-publicaciones/\d", h)]
    print(f"numeric_resolution_hrefs={len(numeric_hrefs)}")
    for h in numeric_hrefs[:30]:
        print(f"  - {h}")

    print(f"contains_id_8511383={'8511383' in html}")
    print(f"contains_numero_422-2026={'422-2026' in html}")
    print(f"script_tag_count={html.count('<script')}")
    print(f"json_ld_scripts={html.count('application/json')}")

    sheet_numbers = sorted(set(int(n) for n in SHEET_RE.findall(html)))
    print(f"numeros_de_pagina_referenciados={sheet_numbers}")

    print("---HTML_SNIPPET_START---")
    print(html[:4000])
    print("---HTML_SNIPPET_END---")


if __name__ == "__main__":
    main()
