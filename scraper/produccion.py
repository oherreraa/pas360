"""Scraper de producción: recorre el listado de resoluciones del TFA,
filtra por sector (hidrocarburos/industria) y envía las resoluciones en
alcance a n8n vía webhook, en lotes (inserción simple en `resoluciones`;
el parseo por secciones y las referencias cruzadas se hacen después, con
más ejemplos reales a la vista).

Envía por lotes (no una llamada por resolución) para reducir cuántas
veces dependemos de que el webhook responda -- un webhook que falla a
mitad de una corrida larga tumbaba resoluciones ya encontradas antes.
Cada lote se reintenta unas veces con backoff; si el envío falla de
todas formas, el resultado completo también queda en resultados.json
(subido como artifact del job) para no perder el trabajo.

Corre en GitHub Actions. Reintenta el fetch de cada página del listado,
porque a veces devuelve la página sin los ítems reales aunque responda
200 (visto en pruebas anteriores).
"""

import json
import os
import re
import time

import pdfplumber
import requests

N8N_WEBHOOK_URL = os.environ.get("N8N_WEBHOOK_URL") or (
    "https://n8n-digitalocean.ai-salva.com/webhook/pas360-resolucion"
)
MAX_RESOLUCIONES = int(os.environ.get("MAX_RESOLUCIONES", "25"))
MAX_PAGINAS = int(os.environ.get("MAX_PAGINAS", "60"))
START_PAGINA = int(os.environ.get("START_PAGINA", "1"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "5"))

BASE_LISTADO = (
    "https://www.gob.pe/institucion/oefa/colecciones/"
    "1716-resoluciones-del-tribunal-de-fiscalizacion-ambiental-tfa"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "es-PE,es;q=0.9",
}

SECTORES_EN_ALCANCE = {"HIDROCARBUROS", "INDUSTRIA"}

LISTADO_HREF_RE = re.compile(
    r'href="(/institucion/oefa/informes-publicaciones/(\d+)-resolucion-[^"]+)"'
)
PDF_HREF_RE = re.compile(r'href="([^"]+\.pdf[^"]*)"')
RESOLUCION_RE = re.compile(
    r"RESOLUCI[ÓO]N\s+N[°ºO.]*\s*:?\s*([\d]+-\d{4}-OEFA[\w/\-]*)", re.IGNORECASE
)
EXPEDIENTE_RE = re.compile(r"EXPEDIENTE\s+N[°ºO.]*\s*:?\s*([\w./\-]+)", re.IGNORECASE)
SECTOR_RE = re.compile(r"SECTOR\s*:?\s*([A-ZÁÉÍÓÚÑ ]+)")
ADMINISTRADO_RE = re.compile(r"ADMINISTRADO\s*:?\s*(.+)")


def fetch_listado_page(pagina: int, intentos: int = 3):
    url = f"{BASE_LISTADO}?sheet={pagina}"
    for intento in range(1, intentos + 1):
        resp = requests.get(url, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        items = LISTADO_HREF_RE.findall(resp.text)
        if items:
            return items
        print(f"  página {pagina}: intento {intento}/{intentos} sin ítems, reintentando...")
        time.sleep(2)
    return []


def fetch_pdf_url_from_detalle(detalle_url: str) -> str | None:
    resp = requests.get(detalle_url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    links = PDF_HREF_RE.findall(resp.text)
    return links[0] if links else None


def fetch_pdf(pdf_url: str) -> bytes:
    resp = requests.get(pdf_url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.content


def extract_text(pdf_bytes: bytes) -> str:
    with open("/tmp/r.pdf", "wb") as f:
        f.write(pdf_bytes)
    paginas = []
    with pdfplumber.open("/tmp/r.pdf") as pdf:
        for page in pdf.pages:
            paginas.append(page.extract_text() or "")
    return "\n".join(paginas)


def procesar_resolucion(detalle_href: str):
    detalle_url = "https://www.gob.pe" + detalle_href
    pdf_url = fetch_pdf_url_from_detalle(detalle_url)
    if not pdf_url:
        print(f"  sin link de PDF en {detalle_url}, se omite")
        return None

    pdf_bytes = fetch_pdf(pdf_url)
    texto = extract_text(pdf_bytes)

    sector_match = SECTOR_RE.search(texto)
    sector = sector_match.group(1).strip() if sector_match else None
    en_alcance = sector is not None and any(s in sector for s in SECTORES_EN_ALCANCE)
    if not en_alcance:
        print(f"  descartado (sector={sector}): {pdf_url}")
        return None

    resolucion_match = RESOLUCION_RE.search(texto)
    expediente_match = EXPEDIENTE_RE.search(texto)
    administrado_match = ADMINISTRADO_RE.search(texto)

    return {
        "numero_resolucion": resolucion_match.group(1) if resolucion_match else None,
        "expediente": expediente_match.group(1) if expediente_match else None,
        "administrado": administrado_match.group(1).strip() if administrado_match else None,
        "sector": sector,
        "url_pdf": pdf_url,
        "url_detalle": detalle_url,
        "pdf_bytes": len(pdf_bytes),
        "texto_completo": texto,
    }


def enviar_lote(lote: list[dict], intentos: int = 3) -> bool:
    for intento in range(1, intentos + 1):
        try:
            resp = requests.post(N8N_WEBHOOK_URL, json={"items": lote}, timeout=60)
            resp.raise_for_status()
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"  intento {intento}/{intentos} enviando lote de {len(lote)}: {exc}")
            if intento < intentos:
                time.sleep(2**intento)
    return False


def main() -> None:
    recolectadas = 0
    vistos = set()
    lote: list[dict] = []
    todas: list[dict] = []

    def despachar_lote():
        if not lote:
            return
        ok = enviar_lote(lote)
        print(f"  lote de {len(lote)} {'enviado a n8n' if ok else 'FALLÓ tras reintentos (queda en resultados.json)'}")
        lote.clear()

    for pagina in range(START_PAGINA, START_PAGINA + MAX_PAGINAS):
        if recolectadas >= MAX_RESOLUCIONES:
            break
        print(f"Página {pagina}...")
        items = fetch_listado_page(pagina)
        if not items:
            print(f"  página {pagina}: sin ítems tras reintentos, se omite")
            continue

        for href, doc_id in items:
            if recolectadas >= MAX_RESOLUCIONES:
                break
            if doc_id in vistos:
                continue
            vistos.add(doc_id)

            try:
                resolucion = procesar_resolucion(href)
            except Exception as exc:  # noqa: BLE001 - 1 falla no debe tumbar el lote
                print(f"  error procesando {href}: {exc}")
                continue

            if resolucion is None:
                continue

            recolectadas += 1
            lote.append(resolucion)
            todas.append(resolucion)
            print(
                f"  [{recolectadas}/{MAX_RESOLUCIONES}] "
                f"{resolucion.get('numero_resolucion')} ({resolucion.get('sector')}) -> en lote"
            )

            if len(lote) >= BATCH_SIZE:
                despachar_lote()

    despachar_lote()

    with open("resultados.json", "w", encoding="utf-8") as f:
        json.dump(todas, f, ensure_ascii=False, indent=2)

    print(f"\nTotal recolectadas: {recolectadas}")


if __name__ == "__main__":
    main()
