const API_LISTADO = '/webhook/pas360-listado';
const API_DETALLE = '/webhook/pas360-detalle';
const API_CHAT = '/webhook/pas360-chat';
const LIMIT = 12;

let offset = 0;
let totalActual = 0;
let filtroSector = '';
let filtroDesenlace = '';
let resolucionActual = null; // {id, numero_resolucion}
let historialChat = [];

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
      offset = 0;
      buscar();
    });
  });
}

function construirFiltros() {
  const body = { limit: LIMIT, offset };
  const texto = document.getElementById('f-texto').value.trim();
  if (filtroSector) body.sector = filtroSector;
  if (filtroDesenlace) body[filtroDesenlace] = true;
  if (texto) {
    if (/^\d{2,4}-\d{4}/.test(texto)) body.numero_resolucion = texto;
    else body.q = texto;
  }
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
  document.getElementById('exp-esquema').innerHTML = '';
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
    renderExpediente(detalle);
    resolucionActual = { id: detalle.resolucion.id, numero_resolucion: detalle.resolucion.numero_resolucion };
    document.getElementById('chat-subtitulo').textContent = detalle.resolucion.numero_resolucion;
  } catch (e) {
    document.getElementById('exp-header').innerHTML = '<p class="vacio">Error cargando el expediente.</p>';
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

  const pasos = [];
  pasos.push({ titulo: '1ª instancia', texto: r.apelacion_resolucion ? `<span class="num-doc">${r.apelacion_resolucion}</span><br>Resolución Directoral (DFAI)` : 'No identificada en el texto.', activo: !!r.apelacion_resolucion });
  pasos.push({ titulo: 'Procedencia', texto: r.procedencia || 'No especificada.', activo: !!r.procedencia });
  let desenlaceTxt = 'Sin desenlace detectado.';
  if (r.desenlace_confirma) desenlaceTxt = 'TFA confirma la responsabilidad.';
  else if (r.desenlace_revoca) desenlaceTxt = 'TFA revoca lo resuelto en 1ª instancia.';
  else if (r.desenlace_reforma) desenlaceTxt = 'TFA reforma (modifica) el monto o extremo sancionado.';
  else if (r.desenlace_nulidad) desenlaceTxt = 'TFA declara la nulidad y retrotrae el procedimiento.';
  else if (r.desenlace_archivo) desenlaceTxt = 'Procedimiento archivado.';
  pasos.push({ titulo: 'Apelación · TFA', texto: `<span class="num-doc">${r.numero_resolucion || ''}</span><br>${desenlaceTxt}`, activo: true });
  pasos.push({ titulo: 'Multa', texto: r.monto_multa_uit != null ? `${r.monto_multa_uit} UIT` : 'No se detectó monto.', activo: r.monto_multa_uit != null });

  document.getElementById('exp-esquema').innerHTML = pasos.map(p => `
    <div class="paso ${p.activo ? 'activo' : ''}">
      <div class="punto"></div>
      <div class="linea"></div>
      <span class="etiqueta-paso">${p.titulo}</span>
      <div class="contenido-paso">${p.texto}</div>
    </div>
  `).join('');

  const secciones = (detalle.secciones || []).map(s => `
    <details class="seccion-doc">
      <summary>${s.titulo}</summary>
      <div class="contenido">${(s.contenido || '').replace(/</g, '&lt;')}</div>
    </details>
  `).join('');
  document.getElementById('exp-secciones').innerHTML = secciones || '<p class="vacio">Sin secciones parseadas.</p>';

  const referencias = (detalle.referencias || []).map(ref => `
    <li><span class="tipo">${ref.tipo_documento || ''}</span>${ref.numero_citado}</li>
  `).join('');
  document.getElementById('exp-referencias').innerHTML = referencias || '<li class="vacio">Sin referencias detectadas.</li>';
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
  document.getElementById('f-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; buscar(); } });
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
