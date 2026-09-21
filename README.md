# PAS 360°

Herramienta que analiza resoluciones del Tribunal de Fiscalización Ambiental (TFA)
y de la Dirección de Fiscalización y Aplicación de Incentivos (DFAI) de OEFA para
reconstruir el recorrido completo de un expediente sancionador — imputación,
supervisión, subsanación o reconocimiento, apelación y desenlace — con foco en
los sectores **hidrocarburos** e **industria**.

Ver [`CLAUDE.md`](./CLAUDE.md) para el contexto completo del proyecto (alcance,
arquitectura, reglas de scraping, modelo de datos).

## Estructura

- `scraper/` — workflows de GitHub Actions para la ingesta (Playwright/requests)
- `parser/` — extracción de texto y mapeo a la ficha de cargo
- `schema/` — DDL de Postgres y colecciones de Qdrant
- `n8n/` — exports de workflows de n8n
- `docs/casos-prueba/` — casos de referencia usados para validar el parser
