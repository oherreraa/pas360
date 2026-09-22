const API_LISTADO = '/webhook/pas360-listado';
const API_DETALLE = '/webhook/pas360-detalle';
const API_CHAT = '/webhook/pas360-chat';
const API_ESQUEMA = '/webhook/pas360-esquema';
const LIMIT = 12;

let offset = 0;
let totalActual = 0;
let filtroSector = '';
let filtroDesenlace = '';
let filtroImputacion = '';
let resolucionActual = null; // {id, numero_resolucion}
let historialChat = [];
let mermaidListo = false;

// ---------- tema claro/oscuro ----------
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  try { localStorage.setItem('pas360-tema', tema); } catch (e) { /* almacenamiento no disponible */ }
  const btn = document.getElementById('toggle-tema');
  if (btn) btn.textContent = tema === 'light' ? 'Oscuro' : 'Claro';
}

function iniciarTema() {
  let guardado = null;
  try { guardado = localStorage.getItem('pas360-tema'); } catch (e) { /* ignorar */ }
  if (guardado === 'light' || guardado === 'dark') {
    aplicarTema(guardado);
  } else {
    const prefiereClaro = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    aplicarTema(prefiereClaro ? 'light' : 'dark');
  }
}

function alternarTema() {
  const actual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  aplicarTema(actual === 'light' ? 'dark' : 'light');
}

function etiquetasDesenlace(r) {
  const out = [];
  if (r.desenlace_confirma) out.push('<span class="etiqueta confirma">Confirma</span>');
  if (r.desenlace_revoca) out.push('<span class="etiqueta revoca">Revoca</span>');
  if (r.desenlace_reforma) out.push('<span class="etiqueta reforma">Reforma</span>');
  if (r.desenlace_nulidad) out.push('<span class="etiqueta nulidad">Nulidad</span>');
  if (r.desenlace_archivo) out.push('<span class="etiqueta archivo">Archivo</span>');
  if (r.cita_precedente_tfa) out.push('<span class="etiqueta precedente">Cita precedente</span>');
  return out.join('');
}

// ---------- chips de filtro ----------
function iniciarChips() {
  document.querySelectorAll('.chip[data-grupo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const grupo = btn.dataset.grupo;
      document.querySelectorAll(`.chip[data-grupo="${grupo}"]`).forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      if (grupo === 'sector') filtroSector = btn.dataset.valor;
      if (grupo === 'desenlace') filtroDesenlace = btn.dataset.valor;
      if (grupo === 'imputacion') filtroImputacion = btn.dataset.valor;
      offset = 0;
      buscar();
    });
  });
}

function construirFiltros() {
  const body = { limit: LIMIT, offset };
  const empresa = document.getElementById('f-empresa').value.trim();
  const anio = document.getElementById('f-anio').value.trim();
  if (filtroSector) body.sector = filtroSector;
  if (filtroDesenlace) body[filtroDesenlace] = true;
  if (filtroImputacion) body[filtroImputacion] = true;
  if (empresa) body.administrado = empresa;
  if (anio) body.anio = anio;
  return body;
}

async function buscar() {
  const cont = document.getElementById('lista-resultados');
  cont.innerHTML = '<p class="vacio">Buscando…</p>';
  try {
    const resp = await fetch(API_LISTADO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(construirFiltros()),
    });
    const filas = await resp.json();
    totalActual = filas.length ? Number(filas[0].total_resultados) : 0;
    renderResultados(filas);
    renderPaginacion();
  } catch (e) {
    cont.innerHTML = '<p class="vacio">No se pudo consultar la base. ¿El backend de n8n está activo?</p>';
  }
}

function renderResultados(filas) {
  const cont = document.getElementById('lista-resultados');
  document.getElementById('resumen-total').textContent = totalActual
    ? `${totalActual} resoluciones encontradas`
    : '';
  if (!filas.length) {
    cont.innerHTML = '<p class="vacio">Sin resultados para estos filtros.</p>';
    return;
  }
  cont.innerHTML = filas.map(r => `
    <div class="tarjeta" data-id="${r.id}">
      <div>
        <span class="num">${r.numero_resolucion}${r.administrado ? ' · ' + r.administrado : ''}</span>
        <p class="sumilla-corta">${(r.sumilla || r.resumen_clasificacion || 'Sin sumilla extraída.').slice(0, 180)}</p>
      </div>
      <div class="derecha">
        <div>${etiquetasDesenlace(r)}</div>
        <span class="multa">${r.monto_multa_uit != null ? r.monto_multa_uit + ' UIT' : '—'}</span>
      </div>
    </div>
  `).join('');
  cont.querySelectorAll('.tarjeta').forEach(t => {
    t.addEventListener('click', () => abrirExpediente(t.dataset.id));
  });
}

function renderPaginacion() {
  const pagina = Math.floor(offset / LIMIT) + 1;
  const totalPaginas = Math.max(Math.ceil(totalActual / LIMIT), 1);
  document.getElementById('pag-info').textContent = `Página ${pagina} de ${totalPaginas}`;
  document.getElementById('btn-prev').disabled = offset === 0;
  document.getElementById('btn-next').disabled = offset + LIMIT >= totalActual;
}

// ---------- vista expediente ----------
async function abrirExpediente(id) {
  document.getElementById('vista-buscar').style.display = 'none';
  document.getElementById('vista-expediente').style.display = 'block';
  window.scrollTo(0, 0);
  document.getElementById('exp-header').innerHTML = '<p class="vacio">Cargando expediente…</p>';
  document.getElementById('exp-resumen').innerHTML = '<p class="esquema-cargando">Generando resumen…</p>';
  document.getElementById('exp-esquema').innerHTML = '<p class="esquema-cargando">Generando esquema…</p>';
  document.getElementById('exp-secciones').innerHTML = '';
  document.getElementById('exp-referencias').innerHTML = '';
  historialChat = [];
  document.getElementById('chat-mensajes').innerHTML = '<p class="chat-vacio">Pregunta sobre esta resolución: qué se imputó, qué defensa funcionó, con qué otras resoluciones o normas se puede comparar.</p>';

  try {
    const resp = await fetch(API_DETALLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const detalle = await resp.json();
    if (!detalle || !detalle.resolucion) {
      document.getElementById('exp-header').innerHTML = '<p class="vacio">Esta resolución no está disponible en la base.</p>';
      document.getElementById('exp-resumen').innerHTML = '';
      document.getElementById('exp-esquema').innerHTML = '';
      resolucionActual = null;
      return;
    }
    renderExpediente(detalle);
    resolucionActual = { id: detalle.resolucion.id, numero_resolucion: detalle.resolucion.numero_resolucion };
    document.getElementById('chat-subtitulo').textContent = detalle.resolucion.numero_resolucion;
    cargarEsquema(detalle.resolucion.id);
  } catch (e) {
    document.getElementById('exp-header').innerHTML = '<p class="vacio">Error cargando el expediente.</p>';
    document.getElementById('exp-resumen').innerHTML = '';
    document.getElementById('exp-esquema').innerHTML = '';
  }
}

async function cargarEsquema(id) {
  const contResumen = document.getElementById('exp-resumen');
  const contDiagrama = document.getElementById('exp-esquema');
  try {
    const resp = await fetch(API_ESQUEMA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolucion_id: id }),
    });
    const data = await resp.json();

    const resumen = data.resumen;
    contResumen.innerHTML = resumen
      ? resumen.split('\n').filter(p => p.trim()).map(p => `<p>${p.replace(/</g, '&lt;')}</p>`).join('')
      : '<p class="vacio">No se pudo generar el resumen.</p>';

    const codigo = data.mermaid;
    if (!codigo) { contDiagrama.innerHTML = '<p class="vacio">No se pudo generar el esquema.</p>'; return; }
    if (!mermaidListo && window.mermaid) {
      const tema = document.documentElement.getAttribute('data-theme') === 'light' ? 'neutral' : 'dark';
      window.mermaid.initialize({ startOnLoad: false, theme: tema, fontFamily: 'Plus Jakarta Sans, sans-serif' });
      mermaidListo = true;
    }
    if (!window.mermaid) { contDiagrama.innerHTML = '<p class="vacio">No se pudo cargar el motor de diagramas.</p>'; return; }
    const idSvg = 'mermaid-' + Date.now();
    const { svg } = await window.mermaid.render(idSvg, codigo);
    contDiagrama.innerHTML = `<div class="esquema-contenedor">${svg}</div>`;
  } catch (e) {
    contResumen.innerHTML = '<p class="vacio">No se pudo generar el resumen.</p>';
    contDiagrama.innerHTML = '<p class="vacio">No se pudo generar el esquema.</p>';
  }
}

function volverABuscar() {
  document.getElementById('vista-expediente').style.display = 'none';
  document.getElementById('vista-buscar').style.display = 'block';
  resolucionActual = null;
}

function renderExpediente(detalle) {
  const r = detalle.resolucion || {};
  document.getElementById('exp-header').innerHTML = `
    <span class="num-grande">${r.numero_resolucion || ''}</span>
    <h2>${r.administrado || 'Administrado no identificado'}</h2>
    <p class="meta">Exp. ${r.expediente || '—'} · ${(r.sector || '').toLowerCase()} · ${etiquetasDesenlace(r)}</p>
    ${r.sumilla ? `<p class="sumilla">${r.sumilla}</p>` : ''}
  `;

  const secciones = (detalle.secciones || []).map(s => `
    <details class="seccion-doc">
      <summary>${s.titulo}</summary>
      <div class="contenido">${(s.contenido || '').replace(/</g, '&lt;')}</div>
    </details>
  `).join('');
  document.getElementById('exp-secciones').innerHTML = secciones || '<p class="vacio">Sin secciones parseadas.</p>';

  const referencias = (detalle.referencias || []).map(ref => {
    const esTfa = /TFA/i.test(ref.numero_citado || '');
    if (esTfa) {
      return `<li class="anclada" data-numero="${(ref.numero_citado || '').replace(/"/g, '&quot;')}">
        <span class="tipo">${ref.tipo_documento || ''}</span>
        <span class="numero">${ref.numero_citado}</span>
        <span class="flecha">Ver expediente &rarr;</span>
      </li>`;
    }
    return `<li><span class="tipo">${ref.tipo_documento || ''}</span>${ref.numero_citado}</li>`;
  }).join('');
  document.getElementById('exp-referencias').innerHTML = referencias || '<li class="vacio">Sin referencias detectadas.</li>';
  document.querySelectorAll('#exp-referencias li.anclada').forEach(li => {
    li.addEventListener('click', () => abrirExpediente(li.dataset.numero));
  });
}

// ---------- chat ----------
function mdLigero(texto) {
  const esc = (texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lineas = esc.split('\n');
  let html = '';
  let enLista = false;
  for (const linea of lineas) {
    const l = linea.trim();
    if (/^#{1,3}\s+/.test(l)) {
      if (enLista) { html += '</ul>'; enLista = false; }
      html += `<p><strong>${l.replace(/^#{1,3}\s+/, '')}</strong></p>`;
    } else if (/^[-*]\s+/.test(l)) {
      if (!enLista) { html += '<ul>'; enLista = true; }
      html += `<li>${l.replace(/^[-*]\s+/, '')}</li>`;
    } else if (l === '') {
      if (enLista) { html += '</ul>'; enLista = false; }
    } else {
      if (enLista) { html += '</ul>'; enLista = false; }
      html += `<p>${l}</p>`;
    }
  }
  if (enLista) html += '</ul>';
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html || `<p>${esc}</p>`;
}

function agregarMensaje(rol, texto, cargando) {
  const cont = document.getElementById('chat-mensajes');
  const vacio = cont.querySelector('.chat-vacio');
  if (vacio) vacio.remove();
  const div = document.createElement('div');
  if (cargando) {
    div.className = 'msg cargando';
    div.textContent = 'Consultando el expediente, precedentes y normativa ambiental…';
  } else if (rol === 'usuario') {
    div.className = 'msg usuario';
    div.textContent = texto;
  } else {
    div.className = 'msg asistente';
    div.innerHTML = '<div class="cabecera-asistente">Análisis</div>' + mdLigero(texto);
  }
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
  return div;
}

async function enviarPregunta() {
  if (!resolucionActual) return;
  const ta = document.getElementById('chat-texto');
  const pregunta = ta.value.trim();
  if (!pregunta) return;
  ta.value = '';
  document.getElementById('chat-enviar').disabled = true;

  agregarMensaje('usuario', pregunta);
  const nodoCargando = agregarMensaje(null, null, true);

  try {
    const resp = await fetch(API_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolucion_id: resolucionActual.id,
        pregunta,
        historial: historialChat,
      }),
    });
    const data = await resp.json();
    nodoCargando.remove();
    const respuesta = data.respuesta || 'No se obtuvo respuesta.';
    agregarMensaje('asistente', respuesta);
    historialChat.push({ rol: 'usuario', texto: pregunta });
    historialChat.push({ rol: 'asistente', texto: respuesta });
    if (historialChat.length > 12) historialChat = historialChat.slice(-12);
  } catch (e) {
    nodoCargando.remove();
    agregarMensaje('asistente', 'No se pudo consultar el asistente. Intenta de nuevo en unos segundos.');
  } finally {
    document.getElementById('chat-enviar').disabled = false;
  }
}

// ---------- inicio ----------
function iniciar() {
  iniciarTema();
  iniciarChips();

  document.getElementById('toggle-tema').addEventListener('click', alternarTema);
  document.getElementById('btn-buscar').addEventListener('click', () => { offset = 0; buscar(); });
  document.getElementById('f-empresa').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; buscar(); } });
  document.getElementById('f-anio').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; buscar(); } });
  document.getElementById('btn-prev').addEventListener('click', () => { offset = Math.max(offset - LIMIT, 0); buscar(); });
  document.getElementById('btn-next').addEventListener('click', () => { offset += LIMIT; buscar(); });
  document.getElementById('btn-volver').addEventListener('click', volverABuscar);
  document.getElementById('chat-enviar').addEventListener('click', enviarPregunta);
  document.getElementById('chat-texto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarPregunta(); }
  });
  document.getElementById('chat-texto').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  buscar();
}

document.addEventListener('DOMContentLoaded', iniciar);
