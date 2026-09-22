-- PAS 360 -- esquema estructurado (Postgres)
-- Unidad de análisis: el cargo (un expediente puede tener varios cargos
-- con desenlaces distintos). Ver CLAUDE.md "Modelo de datos".

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS resoluciones (
    id                 SERIAL PRIMARY KEY,
    numero_resolucion  TEXT UNIQUE NOT NULL,
    expediente         TEXT,
    fecha_resolucion   DATE,
    administrado       TEXT,
    sector             TEXT NOT NULL,          -- hidrocarburos | industria
    url_pdf            TEXT NOT NULL,
    url_detalle        TEXT,
    pdf_bytes          INTEGER,
    texto_completo     TEXT NOT NULL,
    procesado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cargos (
    id                    SERIAL PRIMARY KEY,
    resolucion_id         INTEGER NOT NULL REFERENCES resoluciones(id) ON DELETE CASCADE,
    conducta_imputada     TEXT,
    obligacion_incumplida TEXT,
    tipificacion          TEXT,   -- leve | grave | muy grave
    informe_supervision   TEXT,
    defensa_alegada       TEXT,
    desenlace             TEXT,   -- responsabilidad | archivo | subsanacion | ...
    instancia_resultado   TEXT,   -- confirmada | revocada | reformada
    atenuantes            TEXT,
    agravantes            TEXT,
    multa_uit             NUMERIC,
    resumen               TEXT,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cargos_chunks (
    id             SERIAL PRIMARY KEY,
    resolucion_id  INTEGER NOT NULL REFERENCES resoluciones(id) ON DELETE CASCADE,
    chunk_index    INTEGER NOT NULL,
    chunk_text     TEXT NOT NULL,
    embedding      VECTOR(768),
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resoluciones_sector       ON resoluciones(sector);
CREATE INDEX IF NOT EXISTS idx_resoluciones_administrado ON resoluciones(administrado);
CREATE INDEX IF NOT EXISTS idx_cargos_resolucion         ON cargos(resolucion_id);
CREATE INDEX IF NOT EXISTS idx_cargos_desenlace          ON cargos(desenlace);
CREATE INDEX IF NOT EXISTS idx_chunks_resolucion          ON cargos_chunks(resolucion_id);
