"""Valida si se puede leer el campo SECTOR de la página 1 pidiendo solo los
primeros bytes del PDF (HTTP Range), sin descargar el archivo completo.

Los PDF guardan su tabla de referencias cruzadas (xref) al final del
archivo, así que un Range parcial solo es parseable si el PDF está
"linearizado" para web. Esto lo comprueba contra el caso real en vez de
asumirlo.
"""

import os

import pdfplumber
import requests

PDF_URL = os.environ.get("PDF_URL") or (
    "https://cdn.www.gob.pe/uploads/document/file/10496880/"
    "8511383-resolucion-n-422-2026-oefa-tfa-se.pdf?v=1787354823"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "es-PE,es;q=0.9",
}

RANGE_SIZES = [32_768, 65_536, 131_072]


def try_range(nbytes: int) -> dict:
    headers = {**HEADERS, "Range": f"bytes=0-{nbytes - 1}"}
    resp = requests.get(PDF_URL, headers=headers, timeout=60)
    result = {
        "bytes_solicitados": nbytes,
        "status_code": resp.status_code,
        "content_range_header": resp.headers.get("Content-Range"),
        "bytes_recibidos": len(resp.content),
        "parseable": False,
        "sector_en_pagina_1": None,
        "error": None,
    }
    with open("/tmp/partial.pdf", "wb") as f:
        f.write(resp.content)
    try:
        with pdfplumber.open("/tmp/partial.pdf") as pdf:
            texto_p1 = pdf.pages[0].extract_text() or ""
            result["parseable"] = True
            result["sector_en_pagina_1"] = "SECTOR" in texto_p1.upper()
    except Exception as exc:  # noqa: BLE001 -- queremos capturar cualquier fallo de parseo para reportarlo
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def main() -> None:
    head = requests.head(PDF_URL, headers=HEADERS, timeout=60)
    print(f"HEAD status={head.status_code} accept_ranges={head.headers.get('Accept-Ranges')} "
          f"content_length={head.headers.get('Content-Length')}")

    for nbytes in RANGE_SIZES:
        r = try_range(nbytes)
        print(r)
        if r["parseable"]:
            print(f"OK: {nbytes} bytes bastaron para leer la página 1.")
            return

    print("NINGÚN tamaño de Range probado permitió parsear la página 1 con pdfplumber.")


if __name__ == "__main__":
    main()
