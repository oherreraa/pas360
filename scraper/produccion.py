"""Scraper de producción: recorre el listado de resoluciones del TFA,
filtra por sector (env var SECTORES, default hidrocarburos/industria) y
envía las resoluciones en alcance a n8n vía webhook, en lotes (inserción
simple en `resoluciones`; el parseo por secciones y las referencias
cruzadas se hacen después, con más ejemplos reales a la vista).

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
import unicodedata
from urllib.parse import unquote

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

def _normalizar_sector(texto: str) -> str:
    """Quita tildes y pasa a mayúsculas, para que 'ELÉCTRICO' y 'ELECTRICO'
    (o variantes con codificación de tildes distinta en el PDF) matcheen igual."""
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return sin_tildes.upper().strip()


# Filtro de sector: configurable vía env var SECTORES (lista separada por
# comas), default = alcance original (hidrocarburos/industria). Ver
# CLAUDE.md "Alcance" -- energía/eléctrico se agregó el 2026-09-22 con
# confirmación explícita del autor, pero el flujo nocturno por defecto NO
# cambia de alcance solo por esto: cada corrida decide su propio SECTORES.
SECTORES_EN_ALCANCE = {
    _normalizar_sector(s)
    for s in (os.environ.get("SECTORES") or "HIDROCARBUROS,INDUSTRIA").split(",")
    if s.strip()
}

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
        try:
            resp = requests.get(url, headers=HEADERS, timeout=60)
            resp.raise_for_status()
        except requests.exceptions.RequestException as exc:
            print(f"  página {pagina}: intento {intento}/{intentos} falló ({exc}), reintentando...")
            time.sleep(2)
            continue
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


def extraer_numero_de_url(pdf_url: str) -> str | None:
    """Fallback cuando el número de resolución no se puede leer del texto
    extraído del PDF (visto en resoluciones antiguas 2015-2016 "TFA-SEE",
    donde el encabezado no sigue el formato regular). El nombre de archivo
    en la URL del CDN es literalmente "RESOLUCIÓN N° XXX-YYYY-OEFA/...pdf",
    así que el mismo regex aplicado al path decodificado también sirve."""
    match = RESOLUCION_RE.search(unquote(pdf_url))
    return match.group(1) if match else None


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

    # El PDF descargado a veces llega truncado/corrupto ("No /Root object",
    # "Unexpected EOF") -- visto en la corrida nocturna, siempre en
    # resoluciones antiguas (2015-2016). Un segundo intento normalmente
    # basta, así que no vale la pena descartar la resolución por esto solo.
    try:
        pdf_bytes = fetch_pdf(pdf_url)
        texto = extract_text(pdf_bytes)
    except Exception as exc:  # noqa: BLE001
        print(f"  PDF corrupto en primer intento ({exc}), reintentando: {pdf_url}")
        time.sleep(2)
        pdf_bytes = fetch_pdf(pdf_url)
        texto = extract_text(pdf_bytes)

    sector_match = SECTOR_RE.search(texto)
    sector = sector_match.group(1).strip() if sector_match else None
    sector_norm = _normalizar_sector(sector) if sector else ""
    en_alcance = sector is not None and any(s in sector_norm for s in SECTORES_EN_ALCANCE)
    if not en_alcance:
        print(f"  descartado (sector={sector}): {pdf_url}")
        return None

    resolucion_match = RESOLUCION_RE.search(texto)
    expediente_match = EXPEDIENTE_RE.search(texto)
    administrado_match = ADMINISTRADO_RE.search(texto)

    numero_resolucion = (
        resolucion_match.group(1) if resolucion_match else extraer_numero_de_url(pdf_url)
    )
    if not numero_resolucion:
        print(f"  sin número de resolución (ni en texto ni en URL): {pdf_url}")

    return {
        "numero_resolucion": numero_resolucion,
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

    # Modo reintento dirigido: HREFS_EXTRA = lista de detail-hrefs separados
    # por coma (los que fallaron en una corrida anterior), sin recorrer el
    # listado de páginas. Ej: HREFS_EXTRA="/institucion/oefa/informes-publicaciones/1366417-..."
    hrefs_extra = os.environ.get("HREFS_EXTRA", "").strip()
    if hrefs_extra:
        for href in [h.strip() for h in hrefs_extra.split(",") if h.strip()]:
            try:
                resolucion = procesar_resolucion(href)
            except Exception as exc:  # noqa: BLE001
                print(f"  error procesando {href}: {exc}")
                continue
            if resolucion is None:
                continue
            recolectadas += 1
            lote.append(resolucion)
            todas.append(resolucion)
            print(f"  [{recolectadas}] {resolucion.get('numero_resolucion')} ({resolucion.get('sector')}) -> en lote")
        despachar_lote()
        with open("resultados.json", "w", encoding="utf-8") as f:
            json.dump(todas, f, ensure_ascii=False, indent=2)
        print(f"\nTotal recolectadas: {recolectadas}")
        return

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
