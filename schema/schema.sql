-- PAS 360 -- esquema estructurado (Postgres)
-- Unidad de análisis: el cargo (un expediente puede tener varios cargos
-- con desenlaces distintos). Ver CLAUDE.md "Modelo de datos".
--
-- Las columnas booleanas/de resumen en `resoluciones` se calculan por
-- código (regex, sin LLM) al momento de la ingesta, a partir de
-- `texto_completo` ya limpio. Ver el nodo "Analizar y Segmentar" del
-- workflow n8n "PAS360 - Recepción simple" para el detalle de los
-- patrones (con variantes de redacción legal peruana).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS resoluciones (
    id                 SERIAL PRIMARY KEY,
    numero_resolucion  TEXT UNIQUE NOT NULL,
    expediente         TEXT,
    fecha_resolucion   DATE,
    administrado       TEXT,
    sector             TEXT NOT NULL,          -- hidrocarburos | industria (y variantes, p.ej. "hidrocarburos líquidos")
    procedencia        TEXT,
    apelacion_resolucion TEXT,                 -- N° de la Resolución Directoral apelada
    sumilla            TEXT,
    url_pdf            TEXT NOT NULL,
    url_detalle        TEXT,
    pdf_bytes          INTEGER,
    texto_completo     TEXT NOT NULL,

    -- Desenlace del TFA (no son mutuamente excluyentes: una resolución
    -- puede confirmar un cargo y revocar/reformar otro -- ver CLAUDE.md,
    -- la unidad de análisis real es el cargo, esto es una señal a nivel
    -- resolución mientras no se extrae aún por cargo individual)
    desenlace_confirma       BOOLEAN,
    desenlace_revoca         BOOLEAN,
    desenlace_reforma        BOOLEAN,
    desenlace_nulidad        BOOLEAN,
    desenlace_improcedente   BOOLEAN,          -- rechazo procesal, no de fondo
    desenlace_archivo        BOOLEAN,
    desenlace_responsabilidad BOOLEAN,         -- el resolutivo declara responsabilidad administrativa
    apelacion_exitosa        BOOLEAN,          -- revoca o reforma: el administrado ganó algo

    -- Defensas / argumentos alegados (detectados en todo el texto)
    defensa_reconocimiento_responsabilidad BOOLEAN,  -- allanamiento / reconoció los hechos
    defensa_subsanacion                    BOOLEAN,  -- subsanación voluntaria de la conducta
    defensa_prescripcion                   BOOLEAN,
    defensa_nueva_prueba                   BOOLEAN,
    defensa_vulneracion_debido_procedimiento BOOLEAN,
    defensa_falta_motivacion               BOOLEAN,
    defensa_error_tipificacion             BOOLEAN,  -- atipicidad / indebida tipificación
    defensa_desproporcionalidad_multa      BOOLEAN,  -- principio de proporcionalidad / graduación
    defensa_falta_competencia              BOOLEAN,
    defensa_indefension                    BOOLEAN,  -- vulneración al derecho de defensa

    cita_precedente_tfa       BOOLEAN,         -- cita >=1 resolución TFA como precedente
    administrado_en_liquidacion BOOLEAN,
    monto_multa_uit           NUMERIC,
    resumen_clasificacion     TEXT,            -- frase corta armada por código, no por LLM

    procesado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resolucion_secciones (
    id             SERIAL PRIMARY KEY,
    resolucion_id  INTEGER NOT NULL REFERENCES resoluciones(id) ON DELETE CASCADE,
    orden          INTEGER NOT NULL,
    titulo         TEXT NOT NULL,
    contenido      TEXT NOT NULL,
    embedding      VECTOR(768),                -- para la próxima etapa (RAG por sección)
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (resolucion_id, orden)
);

CREATE TABLE IF NOT EXISTS resolucion_referencias (
    id                SERIAL PRIMARY KEY,
    resolucion_id     INTEGER NOT NULL REFERENCES resoluciones(id) ON DELETE CASCADE,
    tipo_documento    TEXT,
    numero_citado     TEXT NOT NULL,
    contexto          TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (resolucion_id, numero_citado)
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

-- Progreso del scraper nocturno: una sola fila, avanzada atómicamente
-- por el workflow n8n "PAS360 - Orquestador nocturno" en cada disparo.
CREATE TABLE IF NOT EXISTS scraper_progreso (
    id               INTEGER PRIMARY KEY DEFAULT 1,
    pagina_siguiente INTEGER NOT NULL DEFAULT 1,
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT solo_una_fila CHECK (id = 1)
);
INSERT INTO scraper_progreso (id, pagina_siguiente) VALUES (1, 1)
    ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_resoluciones_sector            ON resoluciones(sector);
CREATE INDEX IF NOT EXISTS idx_resoluciones_administrado      ON resoluciones(administrado);
CREATE INDEX IF NOT EXISTS idx_resoluciones_desenlace_confirma ON resoluciones(desenlace_confirma);
CREATE INDEX IF NOT EXISTS idx_resoluciones_apelacion_exitosa ON resoluciones(apelacion_exitosa);
CREATE INDEX IF NOT EXISTS idx_secciones_resolucion           ON resolucion_secciones(resolucion_id);
CREATE INDEX IF NOT EXISTS idx_referencias_resolucion         ON resolucion_referencias(resolucion_id);
CREATE INDEX IF NOT EXISTS idx_referencias_numero             ON resolucion_referencias(numero_citado);
CREATE INDEX IF NOT EXISTS idx_cargos_resolucion              ON cargos(resolucion_id);
CREATE INDEX IF NOT EXISTS idx_cargos_desenlace               ON cargos(desenlace);
