"""Prueba end-to-end: descarga el PDF de una resolución del TFA, extrae su
texto y guarda también el HTML de la página de publicación para poder
diseñar el scraper del listado completo.

Uso: se ejecuta dentro de GitHub Actions (el CDN de gob.pe bloquea tráfico
sin headers de navegador y algunas redes no le dan salida en absoluto).
PDF_URL y DETAIL_URL son configurables por variable de entorno; si no se
pasan, se usa la resolución de prueba (Res. TFA 422-2026-OEFA/TFA-SE).
"""

import json
import os
import re

import pdfplumber
import requests

PDF_URL = os.environ.get("PDF_URL") or (
    "https://cdn.www.gob.pe/uploads/document/file/10496880/"
    "8511383-resolucion-n-422-2026-oefa-tfa-se.pdf?v=1787354823"
)
DETAIL_URL = os.environ.get("DETAIL_URL") or (
    "https://www.gob.pe/institucion/oefa/informes-publicaciones/"
    "8511383-resolucion-n-422-2026-oefa-tfa-se"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "es-PE,es;q=0.9",
}

RESOLUCION_RE = re.compile(
    r"RESOLUCI[ÓO]N\s+N[°ºO.]*\s*([\d]+-\d{4}-OEFA[\w/\-]*)", re.IGNORECASE
)
EXPEDIENTE_RE = re.compile(r"EXPEDIENTE\s+N[°ºO.]*\s*([\w./\-]+)", re.IGNORECASE)


def fetch(url: str) -> bytes:
    resp = requests.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.content


def extract_pdf_text(pdf_bytes: bytes) -> str:
    with open("/tmp/resolucion.pdf", "wb") as f:
        f.write(pdf_bytes)
    pages = []
    with pdfplumber.open("/tmp/resolucion.pdf") as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return "\n".join(pages)


def main() -> None:
    pdf_bytes = fetch(PDF_URL)
    texto = extract_pdf_text(pdf_bytes)
    detalle_html = fetch(DETAIL_URL).decode("utf-8", errors="replace")

    resolucion_match = RESOLUCION_RE.search(texto)
    expediente_match = EXPEDIENTE_RE.search(texto)

    resultado = {
        "url_pdf": PDF_URL,
        "url_detalle": DETAIL_URL,
        "pdf_bytes": len(pdf_bytes),
        "texto_len": len(texto),
        "numero_resolucion": resolucion_match.group(1) if resolucion_match else None,
        "expediente": expediente_match.group(1) if expediente_match else None,
        "texto_preview": texto[:3000],
    }

    with open("resultado.json", "w", encoding="utf-8") as f:
        json.dump({**resultado, "texto_completo": texto}, f, ensure_ascii=False, indent=2)

    with open("detalle.html", "w", encoding="utf-8") as f:
        f.write(detalle_html)

    print(json.dumps(resultado, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
