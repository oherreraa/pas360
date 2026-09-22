# PAS 360°

## Qué es
Herramienta que analiza resoluciones del TFA y la DFAI de OEFA para reconstruir
el recorrido completo de un expediente sancionador: imputación → supervisión →
1ª instancia (DFAI) → subsanación/reconocimiento/pago → apelación → TFA → desenlace.
No es un buscador (eso ya lo tiene OEFA) — es una capa de análisis que convierte
resoluciones sueltas en patrones de defensa y desenlace reutilizables.

## Alcance
- Sectores **hidrocarburos**, **industria** y, desde 2026-09-22, **energía/eléctrico**.
- El sector eléctrico estuvo excluido deliberadamente por conflicto de interés
  (autor trabaja en generadora eléctrica). El autor confirmó explícitamente el
  2026-09-22 levantar esa exclusión y agregar normativa/resoluciones de
  energía-electricidad al dataset. Cualquier ampliación adicional de alcance de
  sector sigue requiriendo confirmación explícita del autor.
- Motor retrospectivo: solo casos con resolución ya publicada, no PAS en trámite.

## Fuentes de datos
- Resoluciones del TFA (transcriben la Resolución Directoral apelada + citan la
  Subdirectoral de imputación) — punto de entrada preferido para casos apelados.
- Resoluciones/dataset de la DFAI — necesario también de forma directa, capta los
  casos firmes sin apelar (subsanación voluntaria, reconocimiento de responsabilidad).
- RUIAS: descartado como fuente de detalle (solo estadística agregada, 1 año).

## Reglas de scraping
- **Filtrar por sector ANTES de descargar.** Nunca bajar el corpus completo del
  TFA (6000+, todos los sectores) y filtrar después.
- El CDN de gob.pe bloquea requests automatizados sin headers de navegador —
  probar rutas alternativas (repositorio institucional OEFA, Datos Abiertos) si
  falla.
- El scraping pesado corre en GitHub Actions, no en la VM (mismo patrón que los
  scrapers de SEACE/REMAJU/SUNARP del autor). A n8n solo le llega el resultado ya
  extraído vía webhook.

## Modelo de datos
La unidad de análisis es el **cargo**, no el expediente (un expediente puede
tener varios cargos con desenlaces distintos). Cada cargo:
conducta imputada · obligación incumplida · tipificación (leve/grave/muy grave) ·
informe de supervisión de origen · sentido del desenlace (responsabilidad /
archivo / subsanación) · atenuantes/agravantes · multa en UIT · recorrido por
instancia (confirmada/revocada/reformada) · **peso del precedente** (vinculante
del TFA vs. resolución aislada — no tratar todas las citas como equivalentes).

## Infraestructura
- Droplet DigitalOcean: 2 vCPU, 4 GB RAM (compartida), 60 GB SSD.
- RAM es el recurso limitante, no storage — evitar correr scraping pesado en la
  VM misma.
- Postgres: esquema estructurado (administrados, expedientes, cargos, sanciones,
  resoluciones).
- Qdrant: hechos imputados en texto libre, para clustering de patrones. Usar
  `on_disk` para vectores/índice (no el modo full-in-memory por defecto) dado el
  límite de RAM.
- n8n: orquesta ingesta desde el webhook de GitHub Actions.
- PDFs crudos: no dejarlos permanentes en el disco en caliente — archivar
  comprimido o mover a object storage una vez extraído el texto.

## Estado / casos de prueba
Ver `docs/casos-prueba/`. Caso de referencia: Pluspetrol Norte S.A. en
Liquidación, Exp. 1208-2025-OEFA/DFAI/PAS, Res. TFA 217-2026-OEFA/TFA-SE —
confirma que el formato de ficha de cargo funciona sobre un caso real.
Pendiente de resolver: acceso estable al PDF completo (el CDN de gob.pe bloqueó
un fetch directo durante las pruebas), y confirmar si el buscador RAA soporta
filtro por sector antes de descargar.

## Convenciones de código
- (completar cuando se defina stack del parser: Python/Node, librería de
  extracción de PDF, etc.)

## No hacer
- No incluir sectores nuevos (fuera de hidrocarburos, industria y energía/eléctrico)
  en ningún dataset ni consulta sin confirmación explícita del autor.
- No presentar el resultado como "esto garantiza X defensa" — siempre expresar
  tendencias con su tamaño de muestra visible (retrospectivo, no predictivo
  garantizado).
- No descargar en bulk sin filtro de sector aplicado primero.
