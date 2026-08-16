/* =========================================================================
   Panel de gestión — se conecta directamente a los endpoints del backend
   (Express + Firebase RTDB + Cloudinary) ya existentes.
   ========================================================================= */

// Cloud de Cloudinary fijo del negocio: ya no se pide por interfaz, así se
// evita que cualquiera que abra el panel pueda cambiarlo por error o a propósito.
const CLOUDINARY_CLOUD_NAME = 'vgvdzqql';

// Limpieza de una config vieja que ya no se usa (si algún navegador la tenía guardada).
localStorage.removeItem('panel_cloud_name');

const state = {
  apiUrl: localStorage.getItem('panel_api_url') || '',
  authToken: localStorage.getItem('panel_auth_token') || '',
  cloudName: CLOUDINARY_CLOUD_NAME,
  authenticated: false, // se pone en true solo tras un login válido contra el backend
  productos: [],
  packs: [],
  pedidosNuevos: [],
  pedidosSeguimiento: [],
  usuarios: [],
  prodImages: [],   // imágenes en edición del modal de producto (public_id o dataURL)
  packImages: [],   // imágenes en edición del modal de pack
  invTab: 'todos',  // pestaña activa en Inventario: todos | bajo | sin
  stockUmbral: Number(localStorage.getItem('panel_stock_umbral') || 10),
  resumenRango: { preset: 'hoy', desde: null, hasta: null }, // rango activo en Resumen
};

/* ---------------------------- Helpers de red ---------------------------- */

function apiUrlOk(){
  return state.apiUrl && state.apiUrl.trim().length > 0;
}

function authHeaders(){
  return state.authToken ? { 'Authorization': 'Bearer ' + state.authToken } : {};
}

function setAuthToken(token){
  state.authToken = token || '';
  if (token) localStorage.setItem('panel_auth_token', token);
  else localStorage.removeItem('panel_auth_token');
}

/* Helpers "seguros" para tocar el DOM: si el elemento no existe (por ejemplo
   porque el móvil todavía tiene en caché una versión vieja de index.html/app.js
   que no coincide entre sí), no se rompe todo el script con
   "Cannot set properties of null". */
function setText(id, value){
  const el = document.getElementById(id);
  if (el) el.textContent = value;
  return el;
}
function setHtml(id, value){
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
  return el;
}

async function apiFetch(path, options = {}){
  if (!apiUrlOk()){
    showToast('Configura primero la URL del backend en "Conexión".', true);
    goToView('config');
    throw new Error('API URL no configurada');
  }
  const base = state.apiUrl.replace(/\/$/, '');
  const res = await fetch(base + path, {
    // Se manda igual por si el navegador sí soporta la cookie cross-site,
    // pero la autenticación real va por el token Bearer de abajo: en
    // iOS Safari (ITP) la cookie cross-site puede no viajar nunca, y sin
    // el token la sesión "se cae" aunque el login haya sido correcto.
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) }
  });
  if (res.status === 401){
    // La sesión no existe o expiró: ocultar la app y volver a pedir login.
    setAuthToken(null);
    lockApp();
    showAuthGate();
    throw new Error('Sesión no iniciada. Inicia sesión para continuar.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo JSON */ }
  if (!res.ok){
    const msg = (data && (data.message || data.error)) || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function showToast(msg, isError = false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function inferImageFormat(url){
  if (!url) return 'IMG';
  const path = url.split('?')[0].split('#')[0];
  const extMatch = path.match(/\.(jpg|jpeg|png|webp|gif|svg)(?:$|\?|#)/i);
  if (extMatch) return extMatch[1].toUpperCase();
  if (url.includes('/f_webp/')) return 'WEBP';
  if (url.includes('/f_png/')) return 'PNG';
  if (url.includes('/f_jpg/') || url.includes('/f_jpeg/')) return 'JPG';
  return 'IMG';
}

function formatBytes(bytes){
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchImageSize(url){
  if (!url) return null;
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'cors' });
    if (res.ok) {
      const contentLength = res.headers.get('content-length');
      if (contentLength) return Number(contentLength);
    }
  } catch (err) {
    // No pasa nada, se intentará con GET.
  }
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size;
  } catch (err) {
    return null;
  }
}

function parseCloudinaryUrl(url){
  try {
    const parsed = new URL(url);
    const isCloudinary = parsed.hostname.endsWith('cloudinary.com');
    if (!isCloudinary) return null;
    const path = parsed.pathname.split('/').filter(Boolean);
    const uploadIndex = path.indexOf('upload');
    if (uploadIndex < 0) return null;
    const afterUpload = path.slice(uploadIndex + 1);
    let folder = '';
    let publicId = '';
    let transformations = '';
    const knownFolders = ['products', 'packs'];
    if (afterUpload.length === 0) return null;
    if (knownFolders.includes(afterUpload[0])) {
      folder = afterUpload[0];
      publicId = afterUpload.slice(1).join('/');
    } else if (afterUpload.length > 1 && knownFolders.includes(afterUpload[1])) {
      transformations = afterUpload[0];
      folder = afterUpload[1];
      publicId = afterUpload.slice(2).join('/');
    } else {
      publicId = afterUpload.join('/');
    }
    const extension = publicId ? (publicId.split('.').pop().toUpperCase() || null) : null;
    const format = extension || (transformations.includes('f_webp') ? 'WEBP' : transformations.includes('f_png') ? 'PNG' : transformations.includes('f_jpg') ? 'JPG' : 'IMG');
    return {
      cloudName: parsed.hostname.split('.')[0],
      folder,
      publicId,
      format,
      transformations,
      url: parsed.href,
      origin: 'cloudinary'
    };
  } catch (err) {
    return null;
  }
}

async function setImageMetaInfo(img, labelEl){
  if (!img || !labelEl) return;
  const format = inferImageFormat(img.currentSrc || img.src || '');
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  let text = format;
  if (width && height) {
    text += ` · ${width}×${height}`;
  }
  const size = await fetchImageSize(img.currentSrc || img.src || '');
  if (size) {
    text += ` · ${formatBytes(size)}`;
    labelEl.classList.toggle('image-meta-large', size > 200 * 1024);
  }
  labelEl.textContent = text;
}

function getImageDetailPayload(source, folder = 'products'){
  const url = cloudinaryUrl(source, folder);
  const cloudinaryInfo = url ? parseCloudinaryUrl(url) : null;
  return {
    source: source || '—',
    url: url || source || '—',
    cloudName: cloudinaryInfo?.cloudName || '—',
    folder: cloudinaryInfo?.folder || folder || '—',
    publicId: cloudinaryInfo?.publicId || (source && source.startsWith('data:') ? 'Embedded data URL' : '—'),
    format: cloudinaryInfo?.format || inferImageFormat(url || source || ''),
    width: 0,
    height: 0,
    size: null
  };
}

async function showImageDetail(source, folder = 'products'){
  const payload = getImageDetailPayload(source, folder);
  const imgPreview = document.getElementById('img-detail-preview');
  const nameEl = document.getElementById('img-detail-name');
  const cloudEl = document.getElementById('img-detail-cloud');
  const formatEl = document.getElementById('img-detail-format');
  const sizeEl = document.getElementById('img-detail-size');
  const dimEl = document.getElementById('img-detail-dimensions');
  const urlEl = document.getElementById('img-detail-url');

  imgPreview.alt = payload.publicId || 'Vista previa de imagen';
  nameEl.textContent = payload.publicId;
  cloudEl.textContent = payload.cloudName !== '—' ? `${payload.cloudName}/${payload.folder}` : '—';
  formatEl.textContent = payload.format;
  sizeEl.textContent = 'Cargando...';
  dimEl.textContent = 'Cargando...';
  urlEl.href = payload.url;
  urlEl.textContent = payload.url;

  imgPreview.onload = async () => {
    dimEl.textContent = `${imgPreview.naturalWidth}×${imgPreview.naturalHeight}`;
    const size = await fetchImageSize(payload.url);
    if (size) {
      sizeEl.textContent = formatBytes(size);
    } else {
      sizeEl.textContent = 'Desconocido';
    }
  };
  imgPreview.onerror = () => {
    dimEl.textContent = 'No disponible';
    sizeEl.textContent = 'No disponible';
  };

  imgPreview.src = payload.url;
  openModal('modal-image-detail');
}

function installServiceWorker(){
  if (!('serviceWorker' in navigator)) return;

  // Evita que se recargue en bucle si hay varias pestañas abiertas.
  let hasReloaded = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return;
    hasReloaded = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js')
    .then(registration => {
      console.log('Service worker registrado.');

      // Si ya hay un SW esperando (detectado en una carga anterior), actívalo ya.
      if (registration.waiting) {
        registration.waiting.postMessage('SKIP_WAITING');
      }

      // Cuando se detecta una versión nueva del SW, actívala apenas termine
      // de instalarse en vez de esperar a que se cierren todas las pestañas.
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage('SKIP_WAITING');
          }
        });
      });

      // Revisa si hay una versión nueva del SW cada vez que la pestaña
      // vuelve a estar visible (además del chequeo automático del navegador).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update();
        }
      });
    })
    .catch(() => console.warn('No se pudo registrar el service worker.'));
}

installServiceWorker();

// folder: 'products' para inventario, 'packs' para packs — Cloudinary
// guarda cada tipo en una carpeta distinta y hay que respetarla al construir
// la URL o la imagen simplemente no existe en esa ruta.
function cloudinaryUrl(publicId, folder = 'products'){
  if (!publicId) return null;
  if (/^https?:\/\//i.test(publicId) || publicId.startsWith('data:image')) return publicId;
  if (!state.cloudName) return null;
  return `https://res.cloudinary.com/${state.cloudName}/image/upload/f_webp,q_auto/${folder}/${encodeURIComponent(publicId)}`;
}

function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxDim = 1280, quality = 0.82){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim){
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ------------------------------ Navegación ------------------------------ */

function goToView(view){
  // Blindaje: aunque alguien oculte el overlay de login a mano con devtools,
  // esta función sigue sin dejar cambiar de pestaña sin sesión válida.
  if (!state.authenticated){
    console.warn('Navegación bloqueada: no hay sesión iniciada.');
    return;
  }
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (!target){
    console.warn('Vista no encontrada:', view);
    return;
  }
  target.classList.add('active');

  if (view === 'resumen') loadResumen();
  if (view === 'inventario') loadProductos();
  if (view === 'packs') loadPacks();
  if (view === 'pedidos') loadPedidosSection();
  if (view === 'usuarios') loadUsuarios();
  if (view === 'notificaciones') loadNotificationBanner();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.view));
});

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('open'); });
});

/* ------------------------------- Conexión -------------------------------- */

function setConnStatus(mode, text){
  const el = document.getElementById('connStatus');
  el.className = 'conn-status ' + mode;
  setText('connStatusText', text);
}

async function testConnection(){
  try{
    await apiFetch('/api/products');
    setConnStatus('ok', 'Conectado');
    return true;
  }catch(e){
    setConnStatus('err', 'Sin conexión');
    return false;
  }
}

document.getElementById('cfg-save').addEventListener('click', async () => {
  const url = document.getElementById('cfg-api-url').value.trim();
  state.apiUrl = url;
  localStorage.setItem('panel_api_url', url);

  const result = document.getElementById('cfg-result');
  result.textContent = 'Probando conexión...';
  result.className = 'hint';

  // Si se cambia el backend estando ya dentro del panel, la sesión de la
  // URL anterior no sirve para la nueva: hay que volver a pedir login.
  const authenticated = await checkAuth();
  if (!authenticated){
    result.textContent = 'Backend guardado. Inicia sesión de nuevo para continuar.';
    result.className = 'hint err';
    lockApp();
    showAuthGate();
    return;
  }

  const ok = await testConnection();
  if (ok){
    result.textContent = '✓ Conectado correctamente al backend.';
    result.className = 'hint ok';
    loadPedidosSection();
    loadNotificationBanner();
  } else {
    result.textContent = '✕ No se pudo conectar. Revisa la URL (debe incluir https:// y estar accesible).';
    result.className = 'hint err';
  }
});

document.getElementById('notif-save')?.addEventListener('click', saveNotificationBanner);
document.getElementById('notif-load')?.addEventListener('click', loadNotificationBanner);

function initConfigFields(){
  document.getElementById('cfg-api-url').value = state.apiUrl;
}

const NOTIF_ICON_LIST = [
  { value: 'fas fa-bell', preview: 'fa-solid fa-bell' },
  { value: 'fas fa-info-circle', preview: 'fa-solid fa-info-circle' },
  { value: 'fas fa-check-circle', preview: 'fa-solid fa-check-circle' },
  { value: 'fas fa-exclamation-triangle', preview: 'fa-solid fa-exclamation-triangle' },
  { value: 'fas fa-star', preview: 'fa-solid fa-star' },
  { value: 'fas fa-percent', preview: 'fa-solid fa-percent' },
  { value: 'fas fa-shipping-fast', preview: 'fa-solid fa-shipping-fast' },
  { value: 'fas fa-gift', preview: 'fa-solid fa-gift' }
];

function setNotificationForm(banner){
  const iconField = document.getElementById('notif-icono');
  iconField.value = banner?.icono || '';
  document.getElementById('notif-titulo').value = banner?.titulo || '';
  document.getElementById('notif-subtitulo').value = banner?.subtitulo || '';
  document.getElementById('notif-mensaje').value = banner?.mensaje || '';
  document.getElementById('notif-tipo').value = banner?.tipo || 'info';
  highlightNotificationIcon(iconField.value);
}

function renderNotificationIconPicker(){
  const picker = document.getElementById('notif-iconpicker');
  if (!picker) return;
  picker.innerHTML = NOTIF_ICON_LIST.map(icon => `
    <button type="button" class="icon-select" data-icon="${icon.value}">
      <i class="${icon.preview}"></i>
      <span>${icon.value}</span>
    </button>
  `).join('');
  picker.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('notif-icono').value = btn.dataset.icon;
      highlightNotificationIcon(btn.dataset.icon);
    });
  });
  const iconField = document.getElementById('notif-icono');
  if (iconField) {
    iconField.addEventListener('input', () => highlightNotificationIcon(iconField.value.trim()));
    highlightNotificationIcon(iconField.value.trim());
  }
}

function previewIconClass(icon){
  return String(icon || '')
    .replace(/\bfas\b/g, 'fa-solid')
    .replace(/\bfar\b/g, 'fa-regular')
    .replace(/\bfab\b/g, 'fa-brands')
    .replace(/\bfal\b/g, 'fa-light');
}

function highlightNotificationIcon(selected){
  const picker = document.getElementById('notif-iconpicker');
  if (picker){
    picker.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.icon === selected);
    });
  }
  const preview = document.getElementById('notif-icon-preview');
  if (!preview) return;
  const iconEl = preview.querySelector('i');
  if (!iconEl) return;
  const previewClass = previewIconClass(selected);
  iconEl.className = previewClass || 'fas fa-bell';
}

async function loadNotificationBanner(){
  if (!apiUrlOk()) return;
  const hint = document.getElementById('notif-hint');
  hint.textContent = 'Cargando notificación...';
  hint.className = 'hint';
  try{
    const data = await apiFetch('/api/notification-banner');
    setNotificationForm(data.banner || {});
    hint.textContent = data.banner ? 'Notificación cargada correctamente.' : 'No hay notificación definida aún.';
    hint.className = 'hint ok';
  }catch(e){
    showToast('Error cargando la notificación: ' + e.message, true);
    hint.textContent = 'No se pudo cargar la notificación.';
    hint.className = 'hint err';
  }
}

async function saveNotificationBanner(){
  if (!apiUrlOk()) return;
  const payload = {
    icono: document.getElementById('notif-icono').value.trim(),
    titulo: document.getElementById('notif-titulo').value.trim(),
    subtitulo: document.getElementById('notif-subtitulo').value.trim(),
    mensaje: document.getElementById('notif-mensaje').value.trim(),
    tipo: document.getElementById('notif-tipo').value
  };
  try{
    const data = await apiFetch('/api/notification-banner', { method: 'PUT', body: JSON.stringify(payload) });
    setNotificationForm(data.banner || {});
    showToast('Notificación guardada.');
    const hint = document.getElementById('notif-hint');
    hint.textContent = 'Notificación guardada correctamente.';
    hint.className = 'hint ok';
  }catch(e){
    showToast('Error guardando la notificación: ' + e.message, true);
    const hint = document.getElementById('notif-hint');
    hint.textContent = 'No se pudo guardar la notificación.';
    hint.className = 'hint err';
  }
}

/* ================================================================
   INVENTARIO (PRODUCTOS)  ->  /api/products
   ================================================================ */

async function loadProductos(){
  try{
    const data = await apiFetch('/api/products');
    state.productos = data.products || [];
    populateProductoCategoriasDropdown();
    renderProductos();
  }catch(e){ showToast('Error cargando inventario: ' + e.message, true); }
}

function populateProductoCategoriasDropdown(){
  const select = document.getElementById('prod-categoria');
  if (!select) return;

  const categorias = Array.from(new Set(
    state.productos
      .map(p => String(p.categoria || '').trim())
      .filter(c => c && c.toLowerCase() !== 'pack')
  ));

  categorias.sort((a,b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  select.innerHTML = '<option value="">Seleccionar categoría</option>' +
    categorias.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// Estado de stock de un producto, solo tiene sentido si "aplicar_stock" está
// habilitado (si no, el stock guardado es informativo y no se avisa de nada).
function estadoStockProducto(p){
  if (!p.aplicar_stock) return 'na';
  const stock = Number(p.stock ?? 0);
  if (stock <= 0) return 'sin';
  if (stock <= state.stockUmbral) return 'bajo';
  return 'ok';
}

function contarProductosPorStock(){
  let bajo = 0, sin = 0;
  state.productos.forEach(p => {
    const estado = estadoStockProducto(p);
    if (estado === 'bajo') bajo++;
    if (estado === 'sin') sin++;
  });
  return { bajo, sin };
}

function actualizarBadgeInventario(){
  const { sin } = contarProductosPorStock();
  const badge = document.getElementById('badge-inventario');
  if (badge) badge.textContent = sin;
}

function renderProductos(){
  const term = document.getElementById('inv-search').value.trim().toLowerCase();
  const grid = document.getElementById('inv-grid');

  const conEstado = state.productos.map(p => ({ p, estado: estadoStockProducto(p) }));
  const { bajo, sin } = contarProductosPorStock();
  setText('inv-count-todos', state.productos.length);
  setText('inv-count-bajo', bajo);
  setText('inv-count-sin', sin);
  actualizarBadgeInventario();

  let filtrados = conEstado;
  if (state.invTab === 'bajo') filtrados = conEstado.filter(x => x.estado === 'bajo');
  if (state.invTab === 'sin') filtrados = conEstado.filter(x => x.estado === 'sin');

  const list = filtrados
    .map(x => x.p)
    .filter(p => !term || (p.nombre || '').toLowerCase().includes(term));

  grid.innerHTML = '';
  document.getElementById('inv-empty').hidden = list.length !== 0;

  list.forEach(p => {
    const imgUrl = cloudinaryUrl((p.imagenes || [])[0]);
    const estado = estadoStockProducto(p);
    const card = document.createElement('article');
    card.className = 'product-card' + (estado === 'bajo' ? ' stock-bajo' : estado === 'sin' ? ' stock-sin' : '') + (p.aplicar_stock ? ' stock-control-on' : ' stock-control-off');
    const available = p.disponibilidad !== false;
    const stockPill = estado === 'sin'
      ? `<span class="pill pill-danger">Sin stock</span>`
      : estado === 'bajo'
        ? `<span class="pill pill-warn">Stock bajo</span>`
        : '';
    const controlPill = p.aplicar_stock
      ? `<span class="pill pill-control-on">Control stock</span>`
      : `<span class="pill pill-control-off">Sin control</span>`;
    card.innerHTML = `
      <div class="product-card-img">
        ${imgUrl ? `<img class="product-thumb" src="${imgUrl}" alt="${escapeHtml(p.nombre)}">` : `<div class="thumb-placeholder">📦</div>`}
        ${imgUrl ? `<div class="image-meta">Cargando...</div>` : ''}
        ${imgUrl ? `<button class="img-detail-btn" title="Ver detalle de imagen" data-img-detail="${p.id}">🔍</button>` : ''}
      </div>
      <div class="product-card-body">
        <div class="product-card-title">
          <div>
            <h3>${escapeHtml(p.nombre)}</h3>
            <p class="product-card-category">${escapeHtml(p.categoria || '—')}</p>
          </div>
          <div class="product-card-statuses">
            <span class="pill ${available ? 'pill-yes' : 'pill-no'}">${available ? 'Disponible' : 'Oculto'}</span>
            ${controlPill}
          </div>
        </div>
        <div class="product-card-meta">
          <div><span>Precio</span><strong>$${Number(p.precio || 0).toFixed(2)}</strong></div>
          <div><span>Stock</span><strong>${p.stock ?? 0} ${stockPill}</strong></div>
          <div><span>Oferta</span><strong>${p.oferta ? `-${p.descuento || 0}%` : 'No'}</strong></div>
          <div><span>Más vendido</span><strong>${p.mas_vendido ? 'Sí' : 'No'}</strong></div>
        </div>
        <div class="product-card-actions">
          <button class="btn btn-ghost btn-small" data-edit="${p.id}">Editar</button>
          <button class="btn btn-danger btn-small" data-del="${p.id}">Eliminar</button>
        </div>
      </div>`;
    grid.appendChild(card);

    const imgEl = card.querySelector('img.product-thumb');
    const labelEl = card.querySelector('.image-meta');
    if (imgEl && labelEl) {
      const updateMeta = () => setImageMetaInfo(imgEl, labelEl);
      imgEl.addEventListener('load', updateMeta);
      imgEl.addEventListener('error', () => { labelEl.textContent = 'Imagen no disponible'; });
      if (imgEl.complete && imgEl.naturalWidth) {
        updateMeta();
      }
    }
    const detailBtn = card.querySelector('[data-img-detail]');
    if (detailBtn) {
      detailBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showImageDetail((p.imagenes || [])[0], 'products');
      });
    }
  });

  grid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openProductoModal(b.dataset.edit)));
  grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteProducto(b.dataset.del)));
}

document.getElementById('inv-search').addEventListener('input', renderProductos);
document.getElementById('inv-new').addEventListener('click', () => openProductoModal(null));

document.querySelectorAll('#inv-tabs [data-itab]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.invTab = btn.dataset.itab;
    document.querySelectorAll('#inv-tabs [data-itab]').forEach(b => b.classList.toggle('active', b === btn));
    renderProductos();
  });
});

const invUmbralInput = document.getElementById('inv-umbral');
invUmbralInput.value = state.stockUmbral;
invUmbralInput.addEventListener('change', () => {
  const val = Math.max(0, Number(invUmbralInput.value || 0));
  state.stockUmbral = val;
  localStorage.setItem('panel_stock_umbral', String(val));
  renderProductos();
});

function openProductoModal(id){
  const p = id ? state.productos.find(x => x.id === id) : null;
  setText('prod-modal-title', p ? 'Editar producto' : 'Nuevo producto');
  document.getElementById('prod-id').value = p ? (p.id ?? '') : '';
  document.getElementById('prod-nombre').value = p ? (p.nombre ?? '') : '';
  document.getElementById('prod-categoria').value = p ? (p.categoria ?? '') : '';
  if (p && p.categoria){
    const select = document.getElementById('prod-categoria');
    if (select && !Array.from(select.options).some(opt => opt.value === p.categoria)){
      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(p.categoria)}">${escapeHtml(p.categoria)}</option>`);
    }
  }
  document.getElementById('prod-descripcion').value = p ? (p.descripcion ?? '') : '';
  document.getElementById('prod-precio').value = p ? (p.precio ?? 0) : '';
  document.getElementById('prod-stock').value = p ? (p.stock ?? 0) : '';
  document.getElementById('prod-aplicar-stock').checked = p ? !!p.aplicar_stock : false;
  document.getElementById('prod-oferta').checked = p ? !!p.oferta : false;
  const productoDisponible = p
    ? (p.disponibilidad !== undefined ? p.disponibilidad !== false : p.disponible !== false)
    : true;
  document.getElementById('prod-activo').checked = productoDisponible;
  document.getElementById('prod-mas-vendido').checked = p ? !!p.mas_vendido : false;
  document.getElementById('prod-delete').hidden = !p;

  // Precio con descuento: se reconstruye a partir de precio + descuento(%)
  // guardados, para que el usuario vuelva a ver el precio final en vez del
  // porcentaje crudo.
  const precioOferta = (p && p.oferta && p.precio && p.descuento)
    ? (Number(p.precio) * (1 - Number(p.descuento) / 100)).toFixed(2)
    : '';
  document.getElementById('prod-precio-oferta').value = precioOferta;
  recalcProdOferta();

  state.prodImages = p ? [...(p.imagenes || [])] : [];
  renderImageGrid('prod-image-grid', state.prodImages);

  openModal('modal-producto');
}

function renderImageGrid(gridId, images, folder = 'products'){
  const grid = document.getElementById(gridId);
  grid.innerHTML = '';
  images.forEach((img, idx) => {
    const url = cloudinaryUrl(img, folder);
    const tile = document.createElement('div');
    tile.className = 'image-tile';
    if (url) {
      const imgEl = document.createElement('img');
      imgEl.src = url;
      imgEl.alt = 'Imagen';
      imgEl.className = 'clickable-image';
      imgEl.addEventListener('click', () => showImageDetail(img, folder));
      imgEl.addEventListener('error', () => {
        imgEl.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb-placeholder', textContent: '⚠' }));
      });
      tile.appendChild(imgEl);
    } else {
      tile.innerHTML = `<div class="thumb-placeholder">🖼</div>`;
    }
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.dataset.idx = String(idx);
    rm.textContent = '✕';
    tile.appendChild(rm);
    grid.appendChild(tile);
  });
  grid.querySelectorAll('.rm').forEach(btn => {
    btn.addEventListener('click', () => {
      const arr = gridId === 'prod-image-grid' ? state.prodImages : state.packImages;
      arr.splice(Number(btn.dataset.idx), 1);
      renderImageGrid(gridId, arr, gridId === 'prod-image-grid' ? 'products' : 'packs');
    });
  });
}

document.getElementById('prod-file-input').addEventListener('change', async (e) => {
  const hint = document.getElementById('prod-image-hint');
  hint.textContent = 'Procesando imagen(es)...';
  try{
    for (const file of e.target.files){
      const dataUrl = await compressImage(file);
      state.prodImages.push(dataUrl);
    }
    renderImageGrid('prod-image-grid', state.prodImages);
    hint.textContent = '';
  }catch(err){
    hint.textContent = 'No se pudo procesar la imagen: ' + err.message;
    hint.className = 'hint err';
  }
  e.target.value = '';
});

document.getElementById('prod-save').addEventListener('click', async () => {
  const id = document.getElementById('prod-id').value;
  const oferta = document.getElementById('prod-oferta').checked;
  const descuento = Number(document.getElementById('prod-descuento').value || 0);
  if (oferta && descuento <= 0){
    showToast('Define un precio con descuento válido antes de guardar.', true);
    return;
  }
  const disponibilidadValue = document.getElementById('prod-activo').checked;
  const payload = {
    nombre: document.getElementById('prod-nombre').value.trim(),
    categoria: document.getElementById('prod-categoria').value.trim(),
    descripcion: document.getElementById('prod-descripcion').value.trim(),
    precio: Number(document.getElementById('prod-precio').value || 0),
    stock: Number(document.getElementById('prod-stock').value || 0),
    aplicar_stock: document.getElementById('prod-aplicar-stock').checked,
    descuento,
    oferta,
    disponible: disponibilidadValue,
    disponibilidad: disponibilidadValue,
    activo: disponibilidadValue,
    mas_vendido: document.getElementById('prod-mas-vendido').checked,
    imagenes: state.prodImages
  };
  if (!payload.nombre){
    showToast('El nombre es obligatorio.', true);
    return;
  }
  try{
    if (id){
      await apiFetch(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('Producto actualizado.');
    } else {
      await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Producto creado.');
    }
    closeModal('modal-producto');
    loadProductos();
  }catch(e){ showToast('Error guardando producto: ' + e.message, true); }
});

document.getElementById('prod-delete').addEventListener('click', async () => {
  const id = document.getElementById('prod-id').value;
  if (!id) return;
  deleteProducto(id);
  closeModal('modal-producto');
});

async function deleteProducto(id){
  if (!confirm('¿Eliminar este producto? También se borrarán sus imágenes de Cloudinary.')) return;
  try{
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    showToast('Producto eliminado.');
    loadProductos();
  }catch(e){ showToast('Error eliminando: ' + e.message, true); }
}

/* ================================================================
   PACKS  ->  /api/packs
   ================================================================ */

async function loadPacks(){
  try{
    const packsData = await apiFetch('/api/packs');
    state.packs = packsData.packs || [];
    renderPacks();
  }catch(e){ showToast('Error cargando packs: ' + e.message, true); }
}

function renderPacks(){
  const term = document.getElementById('pack-search').value.trim().toLowerCase();
  const tbody = document.getElementById('pack-tbody');
  const list = state.packs.filter(p => !term || (p.nombre || '').toLowerCase().includes(term));
  tbody.innerHTML = '';
  document.getElementById('pack-empty').hidden = list.length !== 0;

  list.forEach(p => {
    const tr = document.createElement('tr');
    const imgUrl = cloudinaryUrl((p.imagenes || [])[0] || p.imagen, 'packs');
    const caracteristicas = Array.isArray(p.caracteristicas)
      ? p.caracteristicas
      : (p.caracteristicas ? String(p.caracteristicas).split(/\r?\n/) : []);
    const caracteristicasHtml = caracteristicas.length
      ? `<ul class="pack-features">${caracteristicas.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '—';
    tr.innerHTML = `
      <td data-label="Imagen">
        <div class="thumb-wrap">
          <div class="thumb-img-box">
            ${imgUrl ? `<img class="thumb" src="${imgUrl}" alt="${escapeHtml(p.nombre)}">` : `<div class="thumb-placeholder">🎁</div>`}
            ${imgUrl ? `<button class="img-detail-btn" title="Ver detalle de imagen" data-pack-img-detail="${p.id}">🔍</button>` : ''}
          </div>
          <div class="thumb-label">${imgUrl ? 'Cargando...' : 'Sin imagen'}</div>
        </div>
      </td>
      <td data-label="Nombre">${escapeHtml(p.nombre)}</td>
      <td data-label="Categoría">${escapeHtml(p.categoria || '—')}</td>
      <td data-label="Precio">$${Number(p.precio || 0).toFixed(2)}</td>
      <td class="pack-included" data-label="Incluye">${caracteristicasHtml}</td>
      <td data-label="Estado">${p.disponible !== false ? `<span class="pill pill-yes">Disponible</span>` : `<span class="pill pill-no">Oculto</span>`}</td>
      <td data-label="Acciones">
        <div class="row-actions">
          <button class="icon-btn" title="Editar" data-edit="${p.id}">✎</button>
          <button class="icon-btn" title="Eliminar" data-del="${p.id}">🗑</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
    const thumbImg = tr.querySelector('img.thumb');
    const thumbLabel = tr.querySelector('.thumb-label');
    if (thumbImg && thumbLabel) {
      const updateMeta = () => setImageMetaInfo(thumbImg, thumbLabel);
      thumbImg.addEventListener('load', updateMeta);
      thumbImg.addEventListener('error', () => { thumbLabel.textContent = 'Imagen no disponible'; });
      if (thumbImg.complete && thumbImg.naturalWidth) {
        updateMeta();
      }
    }
    const packDetailBtn = tr.querySelector('[data-pack-img-detail]');
    if (packDetailBtn) {
      packDetailBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showImageDetail((p.imagenes || [])[0] || p.imagen, 'packs');
      });
    }
  });

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openPackModal(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deletePack(b.dataset.del)));
}

document.getElementById('pack-search').addEventListener('input', renderPacks);
document.getElementById('pack-new').addEventListener('click', () => openPackModal(null));

function openPackModal(id){
  const p = id ? state.packs.find(x => x.id === id) : null;
  setText('pack-modal-title', p ? 'Editar pack' : 'Nuevo pack');
  document.getElementById('pack-id').value = p ? (p.id ?? '') : '';
  document.getElementById('pack-nombre').value = p ? (p.nombre ?? '') : '';
  document.getElementById('pack-categoria').value = p ? (p.categoria ?? 'Pack') : 'Pack';
  document.getElementById('pack-descripcion').value = p ? (p.descripcion ?? '') : '';
  document.getElementById('pack-precio').value = p ? (p.precio ?? 0) : '';
  document.getElementById('pack-oferta').checked = p ? !!p.oferta : false;
  document.getElementById('pack-disponible').checked = p ? p.disponible !== false : true;
  document.getElementById('pack-top').checked = p ? !!p.top : false;
  document.getElementById('pack-nuevo').checked = p ? !!p.nuevo : false;
  document.getElementById('pack-caracteristicas').value = p && Array.isArray(p.caracteristicas) ? p.caracteristicas.join('\n') : '';
  document.getElementById('pack-delete').hidden = !p;

  const precioOferta = (p && p.oferta && p.precio && p.descuento)
    ? (Number(p.precio) * (1 - Number(p.descuento) / 100)).toFixed(2)
    : '';
  document.getElementById('pack-precio-oferta').value = precioOferta;
  recalcPackOferta();

  state.packImages = p ? [...(p.imagenes || (p.imagen ? [p.imagen] : []))] : [];
  renderImageGrid('pack-image-grid', state.packImages, 'packs');

  openModal('modal-pack');
}

document.getElementById('pack-file-input').addEventListener('change', async (e) => {
  const hint = document.getElementById('pack-image-hint');
  hint.textContent = 'Procesando imagen(es)...';
  try{
    for (const file of e.target.files){
      const dataUrl = await compressImage(file);
      state.packImages.push(dataUrl);
    }
    renderImageGrid('pack-image-grid', state.packImages, 'packs');
    hint.textContent = '';
  }catch(err){
    hint.textContent = 'No se pudo procesar la imagen: ' + err.message;
    hint.className = 'hint err';
  }
  e.target.value = '';
});

document.getElementById('pack-save').addEventListener('click', async () => {
  const id = document.getElementById('pack-id').value;
  const oferta = document.getElementById('pack-oferta').checked;
  const descuento = Number(document.getElementById('pack-descuento').value || 0);
  if (oferta && descuento <= 0){
    showToast('Define un precio con descuento válido antes de guardar.', true);
    return;
  }
  const caracteristicas = document.getElementById('pack-caracteristicas').value
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const payload = {
    nombre: document.getElementById('pack-nombre').value.trim(),
    categoria: document.getElementById('pack-categoria').value.trim() || 'Pack',
    descripcion: document.getElementById('pack-descripcion').value.trim(),
    precio: Number(document.getElementById('pack-precio').value || 0),
    descuento,
    oferta,
    disponible: document.getElementById('pack-disponible').checked,
    top: document.getElementById('pack-top').checked,
    nuevo: document.getElementById('pack-nuevo').checked,
    caracteristicas,
    imagenes: state.packImages,
    imagen: state.packImages[0] || ''
  };
  if (!payload.nombre){
    showToast('El nombre es obligatorio.', true);
    return;
  }
  try{
    if (id){
      await apiFetch(`/api/packs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('Pack actualizado.');
    } else {
      await apiFetch('/api/packs', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Pack creado.');
    }
    closeModal('modal-pack');
    loadPacks();
  }catch(e){ showToast('Error guardando pack: ' + e.message, true); }
});

document.getElementById('pack-delete').addEventListener('click', async () => {
  const id = document.getElementById('pack-id').value;
  if (!id) return;
  deletePack(id);
  closeModal('modal-pack');
});

async function deletePack(id){
  if (!confirm('¿Eliminar este pack? También se borrarán sus imágenes de Cloudinary.')) return;
  try{
    await apiFetch(`/api/packs/${id}`, { method: 'DELETE' });
    showToast('Pack eliminado.');
    loadPacks();
  }catch(e){ showToast('Error eliminando: ' + e.message, true); }
}

function attachOfertaCalc(prefix){
  const oferta = document.getElementById(`${prefix}-oferta`);
  const box = document.getElementById(`${prefix}-oferta-box`);
  const precio = document.getElementById(`${prefix}-precio`);
  const precioOferta = document.getElementById(`${prefix}-precio-oferta`);
  const descuentoView = document.getElementById(`${prefix}-descuento-view`);
  const descuentoHidden = document.getElementById(`${prefix}-descuento`);
  const info = document.getElementById(`${prefix}-oferta-info`);

  function recalc(){
    box.hidden = !oferta.checked;
    if (!oferta.checked){
      descuentoHidden.value = 0;
      descuentoView.value = '';
      info.textContent = 'Marca "en oferta" para definir un precio con descuento.';
      info.className = 'hint';
      return;
    }
    const pNormal = Number(precio.value || 0);
    const pOferta = Number(precioOferta.value || 0);
    if (!pNormal){
      descuentoHidden.value = 0;
      descuentoView.value = '';
      info.textContent = 'Primero define el precio normal.';
      info.className = 'hint';
      return;
    }
    if (!pOferta){
      descuentoHidden.value = 0;
      descuentoView.value = '';
      info.textContent = 'Escribe el precio con descuento que quieres cobrar.';
      info.className = 'hint';
      return;
    }
    if (pOferta >= pNormal){
      descuentoHidden.value = 0;
      descuentoView.value = '';
      info.textContent = 'El precio con descuento debe ser menor al precio normal.';
      info.className = 'hint err';
      return;
    }
    const pct = ((pNormal - pOferta) / pNormal) * 100;
    descuentoHidden.value = pct.toFixed(2);
    descuentoView.value = pct.toFixed(0) + '%';
    info.textContent = `Ahorra $${(pNormal - pOferta).toFixed(2)} respecto al precio normal (${pct.toFixed(0)}% de descuento).`;
    info.className = 'hint ok';
  }

  oferta.addEventListener('change', recalc);
  precio.addEventListener('input', recalc);
  precioOferta.addEventListener('input', recalc);

  return recalc;
}

const recalcProdOferta = attachOfertaCalc('prod');
const recalcPackOferta = attachOfertaCalc('pack');

// Misma lógica que usa el backend (ordersBelongToSameUser) para decidir si
// dos pedidos son del mismo cliente: mismo teléfono, mismo correo, o mismo id.
function ordersBelongToSameUser(a, b){
  if (!a || !b) return false;
  const telA = String(a.telefono_comprador || '').trim();
  const telB = String(b.telefono_comprador || '').trim();
  if (telA && telB && telA === telB) return true;

  const mailA = String(a.correo_comprador || '').trim().toLowerCase();
  const mailB = String(b.correo_comprador || '').trim().toLowerCase();
  if (mailA && mailA !== 'n/a' && mailA === mailB) return true;

  const idA = a.usuarioId || a.userId || a.id_usuario;
  const idB = b.usuarioId || b.userId || b.id_usuario;
  if (idA && idB && String(idA) === String(idB)) return true;

  return false;
}

function esClienteReincidente(pedido, historial){
  return historial.some(item => item.id !== pedido.id && ordersBelongToSameUser(item, pedido));
}

function pedidosSearchTerm(){
  return document.getElementById('pedidos-search').value.trim().toLowerCase();
}

function getPedidoNumero(p){
  return String(p.numero_orden || p.orderNumber || p.order_number || '').trim();
}

function coincideBusquedaPedido(p, term){
  if (!term) return true;
  const nombre = (p.nombre_comprador || '').toLowerCase();
  const telefono = (p.telefono_comprador || '').toLowerCase();
  const orden = getPedidoNumero(p).toLowerCase();
  return nombre.includes(term) || telefono.includes(term) || orden.includes(term);
}

function toBoolean(value){
  return value === true || value === 'true' || value === 1 || value === '1';
}

function getOriginalPedidoId(p){
  return String(p.pedido_origen_id || p.id || '').trim();
}

function getPedidoFecha(p){
  return p.fecha_registro_backend || p.fecha_asignacion || p.fecha_hora_entrada || null;
}

function normalizePedidoState(p){
  return {
    ...p,
    aceptado: toBoolean(p.aceptado),
    entregado: toBoolean(p.entregado),
    pendiente_pago: toBoolean(p.pendiente_pago),
    pagado: toBoolean(p.pagado)
  };
}

async function loadPedidosSection(){
  try{
    const [nuevosData, asignadosData] = await Promise.all([
      apiFetch('/api/pedidos'),
      apiFetch('/api/pedidos-asignados').catch(() => ({ pedidosAsignados: [] }))
    ]);
    const asignados = asignadosData.pedidosAsignados || [];
    const asignadosIds = new Set(asignados.map(p => p.pedido_origen_id || p.id));
    state.pedidosNuevos = (nuevosData.pedidos || []).filter(p => !asignadosIds.has(p.id));
    state.pedidosSeguimiento = asignados.map(p => normalizePedidoState({
      ...p,
      fecha_asignacion: p.fecha_asignacion || p.fecha_registro_backend || '—'
    }));

    renderPedidosNuevos();
    renderPedidosGuardados();
    renderPedidosSeguimiento();
    actualizarBadgesPedidos();
  }catch(e){ showToast('Error cargando pedidos: ' + e.message, true); }
}

document.getElementById('pedidos-refresh').addEventListener('click', loadPedidosSection);
document.getElementById('pedidos-search').addEventListener('input', () => {
  renderPedidosNuevos();
  renderPedidosGuardados();
  renderPedidosSeguimiento();
});

/* -------------------------- Pestañas Nuevos / Guardados / Seguimiento -------------------------- */

let pedidosTabActual = 'nuevos';

document.querySelectorAll('#pedidos-tabs .seg-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    pedidosTabActual = btn.dataset.ptab;
    document.querySelectorAll('#pedidos-tabs .seg-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('pedidos-panel-nuevos').classList.toggle('active', pedidosTabActual === 'nuevos');
    document.getElementById('pedidos-panel-guardados').classList.toggle('active', pedidosTabActual === 'guardados');
    document.getElementById('pedidos-panel-seguimiento').classList.toggle('active', pedidosTabActual === 'seguimiento');
    if (pedidosTabActual === 'guardados') renderPedidosGuardados();
    if (pedidosTabActual === 'seguimiento') renderPedidosSeguimiento();
  });
});

/* -------------------------------- Pedidos nuevos -------------------------------- */

function renderPedidosNuevos(){
  const term = pedidosSearchTerm();
  const historial = [...state.pedidosNuevos, ...state.pedidosSeguimiento];
  const list = state.pedidosNuevos.filter(p => coincideBusquedaPedido(p, term));

  const tbody = document.getElementById('nuevos-tbody');
  tbody.innerHTML = '';
  document.getElementById('nuevos-empty').hidden = list.length !== 0;

  list.forEach(p => {
    const reincidente = esClienteReincidente(p, historial);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Fecha">${escapeHtml(p.fecha_registro_backend ? new Date(p.fecha_registro_backend).toLocaleString() : '—')}</td>
      <td data-label="Orden">${escapeHtml(getPedidoNumero(p) || '—')}</td>
      <td data-label="Comprador">${escapeHtml(p.nombre_comprador || '—')}</td>
      <td data-label="Teléfono">${escapeHtml(p.telefono_comprador || '—')}</td>
      <td data-label="Dirección">${escapeHtml(p.direccion_envio || '—')}</td>
      <td data-label="Total">$${Number(p.precio_compra_total || 0).toFixed(2)}</td>
      <td data-label="Cliente">${reincidente ? `<span class="pill pill-warn">Ya compró</span>` : `<span class="pill pill-yes">Nuevo</span>`}</td>
      <td data-label="Acciones">
        <div class="row-actions">
          <button class="icon-btn" title="Ver detalle" data-view="${p.id}">👁</button>
          ${reincidente ? `<button class="icon-btn" title="Ver pedido anterior de este cliente" data-prev="${p.id}">🕓</button>` : ''}
          <button class="btn btn-primary btn-small" data-assign="${p.id}">Dar Seguimiento</button>
          <button class="icon-btn" title="Eliminar" data-del="${p.id}">🗑</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showPedidoDetalle(state.pedidosNuevos.find(x => x.id === b.dataset.view))));
  tbody.querySelectorAll('[data-prev]').forEach(b => b.addEventListener('click', () => {
    const actual = state.pedidosNuevos.find(x => x.id === b.dataset.prev);
    const anterior = historial.find(item => item.id !== actual.id && ordersBelongToSameUser(item, actual));
    if (anterior) showPedidoDetalle(anterior);
  }));
  tbody.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => asignarPedido(b.dataset.assign)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deletePedidoNuevo(b.dataset.del)));
}

function renderPedidosGuardados(){
  const term = pedidosSearchTerm();
  const list = state.pedidosSeguimiento.filter(p => coincideBusquedaPedido(p, term));
  const tbody = document.getElementById('guardados-tbody');
  tbody.innerHTML = '';
  document.getElementById('guardados-empty').hidden = list.length !== 0;

  list.forEach(p => {
    const marcador = MARCADOR[estadoPedidoKey(p)];
    const reincidente = esClienteReincidente(p, [...state.pedidosNuevos, ...state.pedidosSeguimiento]);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Fecha asignación">${escapeHtml(p.fecha_asignacion || '—')}</td>
      <td data-label="Orden">${escapeHtml(getPedidoNumero(p) || '—')}</td>
      <td data-label="Comprador">${escapeHtml(p.nombre_comprador || '—')}</td>
      <td data-label="Teléfono">${escapeHtml(p.telefono_comprador || '—')}</td>
      <td data-label="Total">$${Number(p.precio_compra_total || 0).toFixed(2)}</td>
      <td data-label="Ya Compró">${reincidente ? `<span class="pill pill-warn">Sí</span>` : `<span class="pill pill-no">No</span>`}</td>
      <td data-label="Estado"><span class="pill ${marcador.cls}">${marcador.text}</span></td>`;
    tbody.appendChild(tr);
  });
}

async function asignarPedido(id){
  try{
    // Al asignar, el pedido arranca en seguimiento con los 4 estados en falso.
    await apiFetch(`/api/pedidos/${id}/asignar`, {
      method: 'POST',
      body: JSON.stringify({ aceptado: false, entregado: false, pendiente_pago: false, pagado: false })
    });
    showToast('Pedido guardado.');
    loadPedidosSection();
  }catch(e){ showToast('Error asignando pedido: ' + e.message, true); }
}

async function deletePedidoNuevo(id){
  if (!confirm('¿Eliminar este pedido nuevo?')) return;
  try{
    await apiFetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    showToast('Pedido eliminado.');
    loadPedidosSection();
  }catch(e){ showToast('Error eliminando: ' + e.message, true); }
}

/* ------------------------------ Pedidos guardados ------------------------------- */

const ESTADO_FIELDS = [
  { key: 'aceptado',       short: 'Aceptado',    label: 'Aceptado' },
  { key: 'entregado',      short: 'Entregado',   label: 'Entregado' },
  { key: 'pendiente_pago', short: 'Pend. pago',  label: 'Pendiente de pago' },
  { key: 'pagado',         short: 'Pagado',      label: 'Pagado' },
];

function estadoPedidoKey(p){
  if (toBoolean(p.entregado) && toBoolean(p.pagado)) return 'completado';
  if (toBoolean(p.pagado) && !toBoolean(p.entregado)) return 'pagado';
  if (toBoolean(p.aceptado) || toBoolean(p.entregado) || toBoolean(p.pendiente_pago)) return 'proceso';
  return 'pendiente';
}
const MARCADOR = {
  pendiente:  { text: 'Pendiente',  cls: 'pill-no' },
  proceso:    { text: 'En proceso', cls: 'pill-warn' },
  pagado:     { text: 'Pagado',     cls: 'pill-yes' },
  completado: { text: 'Completado', cls: 'pill-yes' },
};

function isPedidoPagadoNoEntregado(p){
  return toBoolean(p.pagado) && !toBoolean(p.entregado);
}

function isPedidoVisibleEnSeguimiento(p){
  return !isPedidoPagadoNoEntregado(p);
}

let segTabActual = 'proceso';

function renderPedidosSeguimiento(){
  const term = pedidosSearchTerm();
  const historial = [...state.pedidosNuevos, ...state.pedidosSeguimiento];
  const list = state.pedidosSeguimiento.filter(p => {
    if (!isPedidoVisibleEnSeguimiento(p)) return false;
    const key = estadoPedidoKey(p);
    const enPestaña = segTabActual === 'completado' ? key === 'completado' : key !== 'completado';
    return enPestaña && coincideBusquedaPedido(p, term);
  });

  const tbody = document.getElementById('seg-tbody');
  tbody.innerHTML = '';
  document.getElementById('seg-empty').hidden = list.length !== 0;

  list.forEach(p => {
    const reincidente = esClienteReincidente(p, historial);
    const tr = document.createElement('tr');
    const marcador = MARCADOR[estadoPedidoKey(p)];
    tr.innerHTML = `
      <td data-label="Fecha asignación">${escapeHtml(p.fecha_asignacion || '—')}</td>
      <td data-label="Orden">${escapeHtml(getPedidoNumero(p) || '—')}</td>
      <td data-label="Comprador">${escapeHtml(p.nombre_comprador || '—')}</td>
      <td data-label="Teléfono">${escapeHtml(p.telefono_comprador || '—')}</td>
      <td data-label="Total">$${Number(p.precio_compra_total || 0).toFixed(2)}</td>
      <td data-label="Ya Compró">${reincidente ? `<span class="pill pill-warn">Sí</span>` : `<span class="pill pill-no">No</span>`}</td>
      <td data-label="Estados">
        <div class="estado-checks" data-estados="${p.id}">
          ${ESTADO_FIELDS.map(f => {
            if (f.key === 'pendiente_pago' && toBoolean(p.pagado)) return '';
            const checked = toBoolean(p[f.key]);
            return `
            <label class="estado-check" title="${f.label}">
              <input type="checkbox" data-campo="${f.key}" ${checked ? 'checked' : ''}>
              ${f.short}
            </label>`;
          }).join('')}
        </div>
      </td>
      <td data-label="Marcador"><span class="pill ${marcador.cls}">${marcador.text}</span></td>
      <td data-label="Acciones">
        <div class="row-actions">
          <button class="icon-btn" title="Ver detalle" data-view="${p.id}">👁</button>
          <button class="icon-btn" title="Eliminar" data-del="${p.id}">🗑</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-estados]').forEach(container => {
    const id = container.dataset.estados;
    container.querySelectorAll('input[type=checkbox]').forEach(chk => {
      chk.addEventListener('change', () => {
        const campo = chk.dataset.campo;
        const cambios = { [campo]: chk.checked };
        if (campo === 'pagado' && chk.checked) cambios.pendiente_pago = false;
        if (campo === 'pendiente_pago' && chk.checked) cambios.pagado = false;
        updateEstadosPedido(id, cambios);
      });
    });
  });
  tbody.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showPedidoDetalle(state.pedidosSeguimiento.find(x => x.id === b.dataset.view))));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deletePedidoSeguimiento(b.dataset.del)));

  actualizarBadgesPedidos();
}

document.querySelectorAll('#seg-tabs .seg-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    segTabActual = btn.dataset.tab;
    document.querySelectorAll('#seg-tabs .seg-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderPedidosSeguimiento();
  });
});

async function updateEstadosPedido(id, cambios){
  try{
    await apiFetch(`/api/pedidos-asignados/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cambios)
    });
    showToast('Estado actualizado.');
    loadPedidosSection();
  }catch(e){
    showToast('Error actualizando estado: ' + e.message, true);
    renderPedidosSeguimiento(); // revierte el checkbox visualmente si falló
  }
}

async function deletePedidoSeguimiento(id){
  if (!confirm('¿Eliminar este pedido guardado?')) return;
  try{
    await apiFetch(`/api/pedidos-asignados/${id}`, { method: 'DELETE' });
    showToast('Pedido eliminado.');
    loadPedidosSection();
  }catch(e){ showToast('Error eliminando: ' + e.message, true); }
}

/* --------------------------- Badges (sidebar + pestañas) --------------------------- */

function actualizarBadgesPedidos(){
  const nuevosCount = state.pedidosNuevos.length;
  const guardadosCount = state.pedidosSeguimiento.length;
  const enProceso = state.pedidosSeguimiento.filter(p => isPedidoVisibleEnSeguimiento(p) && estadoPedidoKey(p) !== 'completado').length;
  const completados = state.pedidosSeguimiento.filter(p => estadoPedidoKey(p) === 'completado').length;

  setText('tab-count-nuevos', nuevosCount);
  setText('tab-count-guardados', guardadosCount);
  setText('tab-count-seguimiento', enProceso);
  setText('seg-count-proceso', enProceso);
  setText('seg-count-completado', completados);
  setText('badge-pedidos', nuevosCount + enProceso);
}

/* -------------------------- Detalle de pedido -------------------------- */

// Referencia al pedido abierto actualmente en el modal y estado de edición
// de su listado de productos (compras). Se resetean cada vez que se abre
// el modal desde showPedidoDetalle.
let pedidoDetalleActual = null;
let pedidoDetalleEditando = false;
let pedidoDetalleComprasEdit = [];

function pedidoDetalleEsSeguimiento(p){
  return !!(p && p.fecha_asignacion);
}

function endpointPedidoDetalle(){
  const id = pedidoDetalleActual && pedidoDetalleActual.id;
  return pedidoDetalleEsSeguimiento(pedidoDetalleActual) ? `/api/pedidos-asignados/${id}` : `/api/pedidos/${id}`;
}

function showPedidoDetalle(p){
  if (!p) return;
  pedidoDetalleActual = p;
  pedidoDetalleEditando = false;
  pedidoDetalleComprasEdit = [];
  renderPedidoDetalleBody();
  openModal('modal-pedido');
}

function totalComprasEdit(){
  return pedidoDetalleComprasEdit.reduce((acc, c) => acc + (Number(c.unitPrice) || 0) * (Number(c.quantity) || 0), 0);
}

function renderPedidoDetalleBody(){
  const body = document.getElementById('pedido-detalle-body');
  const p = pedidoDetalleActual;
  if (!p || !body) return;

  const compras = Array.isArray(p.compras) ? p.compras : [];

  const cabecera = `
    <dl class="detail-grid">
      <dt>Número de orden</dt><dd>${escapeHtml(getPedidoNumero(p) || '—')}</dd>
      <dt>Comprador</dt><dd>${escapeHtml(p.nombre_comprador || '—')}</dd>
      <dt>Teléfono</dt><dd>${escapeHtml(p.telefono_comprador || '—')}</dd>
      <dt>Correo</dt><dd>${escapeHtml(p.correo_comprador || '—')}</dd>
      <dt>Dirección</dt><dd>${escapeHtml(p.direccion_envio || '—')}</dd>
      <dt>Entrega a</dt><dd>${escapeHtml(p.nombre_persona_entrega || '—')} (${escapeHtml(p.telefono_persona_entrega || '—')})</dd>
      <dt>Total</dt><dd id="pedido-detalle-total">$${Number(p.precio_compra_total || 0).toFixed(2)}</dd>
    </dl>
  `;

  if (!pedidoDetalleEditando){
    body.innerHTML = `
      ${cabecera}
      <div class="compras-list">
        <div class="compras-list-header">
          <strong>Productos comprados</strong>
          <button class="btn btn-ghost btn-small" id="pedido-editar-compras-btn">Editar productos</button>
        </div>
        ${compras.length ? `
          <table>
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th></tr></thead>
            <tbody>
              ${compras.map(c => `<tr><td>${escapeHtml(c.name || c.nombre || '—')}</td><td>${c.quantity ?? c.cantidad ?? 1}</td><td>$${Number(c.unitPrice ?? c.precio ?? 0).toFixed(2)}</td></tr>`).join('')}
            </tbody>
          </table>` : `<p class="hint">Este pedido no tiene productos registrados.</p>`}
      </div>
    `;
    const editBtn = document.getElementById('pedido-editar-compras-btn');
    if (editBtn) editBtn.addEventListener('click', iniciarEdicionComprasPedido);
    return;
  }

  const totalEdit = totalComprasEdit();
  body.innerHTML = `
    ${cabecera}
    <div class="compras-list compras-list-edit">
      <div class="compras-list-header">
        <strong>Editar productos</strong>
        <button class="btn btn-ghost btn-small" id="pedido-agregar-producto-btn" ${state.productos.length ? '' : 'disabled'}>+ Agregar producto</button>
      </div>
      ${!state.productos.length ? `<p class="hint err">No se pudo cargar el inventario para editar productos.</p>` : ''}
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th><th></th></tr></thead>
        <tbody>
          ${pedidoDetalleComprasEdit.map((c, idx) => `
            <tr data-row="${idx}">
              <td>
                <select class="pedido-edit-select" data-idx="${idx}">
                  ${state.productos.map(prod => `<option value="${escapeHtml(String(prod.id))}" ${String(prod.id) === String(c.id) ? 'selected' : ''}>${escapeHtml(prod.nombre)}</option>`).join('')}
                </select>
              </td>
              <td><input type="number" min="1" step="1" class="pedido-edit-qty" data-idx="${idx}" value="${Number(c.quantity) || 1}"></td>
              <td><input type="number" min="0" step="0.01" class="pedido-edit-price" data-idx="${idx}" value="${Number(c.unitPrice) || 0}"></td>
              <td>$${((Number(c.unitPrice) || 0) * (Number(c.quantity) || 0)).toFixed(2)}</td>
              <td><button class="icon-btn" title="Quitar producto" data-remove-row="${idx}">🗑</button></td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="hint">Sin productos. Usa "Agregar producto" para añadir uno.</td></tr>`}
        </tbody>
      </table>
      <div class="compras-edit-total">Total: <strong>$${totalEdit.toFixed(2)}</strong></div>
      <div class="compras-edit-actions">
        <button class="btn btn-ghost btn-small" id="pedido-cancelar-edicion-btn">Cancelar</button>
        <button class="btn btn-primary btn-small" id="pedido-guardar-edicion-btn">Guardar cambios</button>
      </div>
    </div>
  `;

  document.getElementById('pedido-agregar-producto-btn')?.addEventListener('click', agregarProductoAEdicionPedido);
  document.getElementById('pedido-cancelar-edicion-btn')?.addEventListener('click', () => {
    pedidoDetalleEditando = false;
    renderPedidoDetalleBody();
  });
  document.getElementById('pedido-guardar-edicion-btn')?.addEventListener('click', guardarEdicionComprasPedido);

  body.querySelectorAll('.pedido-edit-select').forEach(sel => sel.addEventListener('change', (e) => {
    const idx = Number(e.target.dataset.idx);
    const prod = state.productos.find(x => String(x.id) === String(e.target.value));
    if (!prod) return;
    pedidoDetalleComprasEdit[idx] = {
      ...pedidoDetalleComprasEdit[idx],
      id: prod.id,
      name: prod.nombre,
      unitPrice: Number(prod.precio) || 0
    };
    renderPedidoDetalleBody();
  }));
  body.querySelectorAll('.pedido-edit-qty').forEach(inp => inp.addEventListener('input', (e) => {
    const idx = Number(e.target.dataset.idx);
    pedidoDetalleComprasEdit[idx].quantity = Math.max(1, Math.floor(Number(e.target.value) || 1));
    renderPedidoDetalleBody();
  }));
  body.querySelectorAll('.pedido-edit-price').forEach(inp => inp.addEventListener('input', (e) => {
    const idx = Number(e.target.dataset.idx);
    pedidoDetalleComprasEdit[idx].unitPrice = Math.max(0, Number(e.target.value) || 0);
    renderPedidoDetalleBody();
  }));
  body.querySelectorAll('[data-remove-row]').forEach(btn => btn.addEventListener('click', (e) => {
    const idx = Number(e.target.dataset.removeRow);
    pedidoDetalleComprasEdit.splice(idx, 1);
    renderPedidoDetalleBody();
  }));
}

async function iniciarEdicionComprasPedido(){
  if (!state.productos.length){
    try{ await loadProductos(); }catch(e){ /* loadProductos ya muestra el toast de error */ }
  }
  const compras = Array.isArray(pedidoDetalleActual.compras) ? pedidoDetalleActual.compras : [];
  pedidoDetalleComprasEdit = compras.map(c => ({
    id: c.id ?? c.productId ?? c.product_id ?? null,
    name: c.name || c.nombre || 'Producto',
    unitPrice: Number(c.unitPrice ?? c.precio ?? 0) || 0,
    quantity: Number(c.quantity ?? c.cantidad ?? 1) || 1
  }));
  pedidoDetalleEditando = true;
  renderPedidoDetalleBody();
}

function agregarProductoAEdicionPedido(){
  const primero = state.productos[0];
  if (!primero) return;
  pedidoDetalleComprasEdit.push({
    id: primero.id,
    name: primero.nombre,
    unitPrice: Number(primero.precio) || 0,
    quantity: 1
  });
  renderPedidoDetalleBody();
}

async function guardarEdicionComprasPedido(){
  try{
    const compras = pedidoDetalleComprasEdit
      .filter(c => (Number(c.quantity) || 0) > 0)
      .map(c => ({ id: c.id, name: c.name, unitPrice: Number(c.unitPrice) || 0, quantity: Number(c.quantity) || 0 }));

    const data = await apiFetch(endpointPedidoDetalle(), { method: 'PATCH', body: JSON.stringify({ compras }) });
    const actualizado = data.pedido;
    if (!actualizado) throw new Error('El servidor no devolvió el pedido actualizado.');

    const listaKey = pedidoDetalleEsSeguimiento(pedidoDetalleActual) ? 'pedidosSeguimiento' : 'pedidosNuevos';
    const idx = state[listaKey].findIndex(x => x.id === pedidoDetalleActual.id);
    if (idx !== -1) state[listaKey][idx] = actualizado;

    pedidoDetalleActual = actualizado;
    pedidoDetalleEditando = false;
    renderPedidoDetalleBody();

    if (listaKey === 'pedidosNuevos') renderPedidosNuevos();
    else { renderPedidosGuardados(); renderPedidosSeguimiento(); }
    actualizarBadgesPedidos();

    showToast('Pedido actualizado.');
  }catch(e){ showToast('Error guardando cambios: ' + e.message, true); }
}

async function loadUsuarios(){
  try{
    const data = await apiFetch('/obtener-estadisticas');
    state.usuarios = Array.isArray(data) ? data : [];
    renderUsuarios();
  }catch(e){ showToast('Error cargando estadísticas: ' + e.message, true); }
}

function renderUsuarios(){
  const tbody = document.getElementById('usr-tbody');
  tbody.innerHTML = '';
  document.getElementById('usr-empty').hidden = state.usuarios.length !== 0;

  // Mostrar los más recientes primero
  const list = [...state.usuarios].reverse();
  list.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.fecha_hora_entrada || '—')}</td>
      <td>${escapeHtml(u.ip || '—')}</td>
      <td>${escapeHtml(u.pais || '—')}</td>
      <td>${u.tipo_usuario === 'Recurrente' ? `<span class="pill pill-warn">Recurrente</span>` : `<span class="pill pill-yes">Único</span>`}</td>
      <td>${escapeHtml(u.origen || u.fuente_trafico || '—')}</td>
      <td>${escapeHtml(u.navegador || '—')}</td>
      <td>${escapeHtml(u.sistema_operativo || '—')}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('usr-refresh').addEventListener('click', loadUsuarios);

/* --------------------------------- Utils --------------------------------- */

function escapeHtml(str){
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------- Autenticación -------------------------------- */
// Este panel corre en un dominio distinto al backend (GitHub Pages vs.
// Render), así que necesita iniciar sesión igual que el panel de
// administración: la sesión viaja como cookie cross-site (requiere
// `credentials: 'include'` en cada fetch, ya aplicado en apiFetch).

async function checkAuth(){
  if (!apiUrlOk()) return false;
  if (!state.authToken) return false; // sin token guardado no hay sesión válida (no confiamos solo en la cookie por iOS)
  try {
    const base = state.apiUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/me', { credentials: 'include', headers: authHeaders() });
    const data = await res.json();
    if (!(data && data.authenticated)) setAuthToken(null);
    return !!(data && data.authenticated);
  } catch (e) {
    return false;
  }
}

/* --- Bloqueo real del panel ------------------------------------------------
   El panel completo (sidebar, vistas, datos) arranca con la clase "locked"
   puesta directamente en el HTML, que lo pone en display:none. Esa clase
   SOLO se quita desde unlockApp(), que solo se llama tras un login válido
   contra el backend. Así, aunque alguien abra devtools y borre a mano el
   overlay de login (o le cambie el CSS), no hay nada debajo que mostrar: el
   contenedor .app sigue oculto y goToView() sigue rechazando la navegación
   porque state.authenticated sigue en false.

   Importante: esto es una barrera de interfaz, pensada para que no se pueda
   "colar" con un truco de un clic en el navegador. La seguridad real de los
   datos la sigue dando el backend (cookie de sesión + verificación en cada
   endpoint) — eso no cambia y sigue siendo indispensable. */

function lockApp(){
  state.authenticated = false;
  const appEl = document.querySelector('.app');
  if (appEl) appEl.classList.add('locked');
}

function unlockApp(){
  state.authenticated = true;
  const appEl = document.querySelector('.app');
  if (appEl) appEl.classList.remove('locked');
}

function showBackendGate(){
  const gate = document.getElementById('backend-gate');
  if (gate) gate.classList.add('open');
}

function hideBackendGate(){
  const gate = document.getElementById('backend-gate');
  if (gate) gate.classList.remove('open');
}

function showAuthGate(){
  const gate = document.getElementById('auth-gate');
  if (gate) gate.classList.add('open');
}

function hideAuthGate(){
  const gate = document.getElementById('auth-gate');
  if (gate) gate.classList.remove('open');
}

async function doSaveBackend(){
  const urlEl = document.getElementById('backend-url-input');
  const errEl = document.getElementById('backend-error');
  const btn = document.getElementById('backend-save');
  const url = urlEl.value.trim();

  if (!url){
    errEl.textContent = 'Ingresa la URL de tu backend.';
    errEl.style.display = 'block';
    return;
  }
  if (!/^https?:\/\//i.test(url)){
    errEl.textContent = 'La URL debe empezar con http:// o https://';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  state.apiUrl = url.replace(/\/$/, '');
  localStorage.setItem('panel_api_url', state.apiUrl);

  btn.disabled = false;
  btn.textContent = 'Guardar y continuar';

  hideBackendGate();
  await proceedPastBackendGate();
}

async function proceedPastBackendGate(){
  initConfigFields();
  // Puede que ya exista una sesión válida (cookie viva de una visita
  // anterior); si no, se pide login. Si el backend no responde, también
  // se pide login y el usuario verá el error de conexión al intentar entrar.
  const authenticated = await checkAuth();
  if (authenticated){
    unlockApp();
    await bootPanel();
  } else {
    showAuthGate();
  }
}

async function doLogin(){
  const userEl = document.getElementById('auth-username');
  const passEl = document.getElementById('auth-password');
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit');
  const username = userEl.value.trim();
  const password = passEl.value;

  if (!apiUrlOk()){
    // No debería poder llegar aquí sin backend configurado, pero por las
    // dudas lo mandamos de vuelta al primer paso.
    hideAuthGate();
    showBackendGate();
    return;
  }
  if (!username || !password){
    errEl.textContent = 'Usuario y contraseña son obligatorios.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const base = state.apiUrl.replace(/\/$/, '');
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success){
      setAuthToken(data.token || null);
      passEl.value = '';
      hideAuthGate();
      unlockApp();
      await bootPanel();
    } else {
      errEl.textContent = data.message || 'No se pudo iniciar sesión.';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Error de conexión con el backend.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function doLogout(){
  lockApp();
  if (apiUrlOk()){
    try {
      const base = state.apiUrl.replace(/\/$/, '');
      await fetch(base + '/api/auth/logout', { method: 'POST', credentials: 'include', headers: authHeaders() });
    } catch (e) { /* no pasa nada */ }
  }
  setAuthToken(null);
  showAuthGate();
}

document.getElementById('backend-save')?.addEventListener('click', doSaveBackend);
document.getElementById('backend-url-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSaveBackend();
});
document.getElementById('auth-submit')?.addEventListener('click', doLogin);
document.getElementById('auth-password')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('logout-btn')?.addEventListener('click', doLogout);

/* --------- Login: panel avanzado (URL del backend + borrar datos) --------- */

document.getElementById('auth-toggle-advanced')?.addEventListener('click', () => {
  const panel = document.getElementById('auth-advanced-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening){
    const urlEl = document.getElementById('auth-api-url');
    if (urlEl) urlEl.value = state.apiUrl || '';
  }
});

document.getElementById('auth-save-url')?.addEventListener('click', () => {
  const urlEl = document.getElementById('auth-api-url');
  const resultEl = document.getElementById('auth-advanced-result');
  const url = urlEl.value.trim().replace(/\/$/, '');
  if (!url || !/^https?:\/\//i.test(url)){
    resultEl.textContent = 'Ingresa una URL válida (debe empezar con http:// o https://).';
    resultEl.className = 'hint err';
    return;
  }
  state.apiUrl = url;
  localStorage.setItem('panel_api_url', url);
  setAuthToken(null); // el backend puede ser otro: cualquier token viejo ya no sirve
  resultEl.textContent = '✓ URL guardada. Intenta iniciar sesión de nuevo.';
  resultEl.className = 'hint ok';
});

document.getElementById('auth-clear-storage')?.addEventListener('click', async () => {
  const resultEl = document.getElementById('auth-advanced-result');
  const confirmed = confirm('Esto va a borrar todos los datos guardados del panel en este navegador (sesión, URL del backend configurada, caché) y va a recargar la página. ¿Continuar?');
  if (!confirmed) return;

  try { localStorage.clear(); } catch (e) { /* no pasa nada */ }
  try { sessionStorage.clear(); } catch (e) { /* no pasa nada */ }

  try {
    if ('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { /* no pasa nada */ }

  try {
    if ('serviceWorker' in navigator){
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
  } catch (e) { /* no pasa nada */ }

  if (resultEl){
    resultEl.textContent = 'Datos borrados. Recargando...';
    resultEl.className = 'hint ok';
  }
  setTimeout(() => { window.location.reload(); }, 600);
});

/* --------------------------------- Init ---------------------------------- */

async function bootPanel(){
  initConfigFields();
  if (apiUrlOk()){
    const ok = await testConnection();
    if (ok){
      renderNotificationIconPicker();
      loadProductos();
      loadPedidosSection();
      loadNotificationBanner();
      loadResumen();
    } else {
      renderNotificationIconPicker();
      goToView('config');
    }
  } else {
    goToView('config');
  }
}

(async function init(){
  // Arranque siempre bloqueado. El panel (.app) ya nace oculto por CSS
  // (clase "locked" en el HTML) — esto es solo el respaldo en JS.
  lockApp();

  if (!apiUrlOk()){
    // Primer uso / navegador nuevo: todavía no hay backend guardado.
    // Lo primero que se ve es el cartel para configurarlo, nada más.
    showBackendGate();
    return;
  }

  // Ya hay backend guardado de una visita anterior: saltamos directo
  // a comprobar sesión / pedir login.
  await proceedPastBackendGate();
})();

function esDelMesActual(fechaStr){
  if (!fechaStr) return false;
  const f = new Date(fechaStr);
  if (isNaN(f)) return false;
  const now = new Date();
  return f.getFullYear() === now.getFullYear() && f.getMonth() === now.getMonth();
}

function fechaAyer(fechaStr){
  if (!fechaStr) return false;
  const f = new Date(fechaStr);
  if (isNaN(f)) return false;
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  return f.getFullYear() === ayer.getFullYear() && f.getMonth() === ayer.getMonth() && f.getDate() === ayer.getDate();
}

function fechaHoy(fechaStr){
  if (!fechaStr) return false;
  const f = new Date(fechaStr);
  if (isNaN(f)) return false;
  const hoy = new Date();
  return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth() && f.getDate() === hoy.getDate();
}

function esDelMesAnterior(fechaStr){
  if (!fechaStr) return false;
  const f = new Date(fechaStr);
  if (isNaN(f)) return false;
  const hoy = new Date();
  const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return f.getFullYear() === mesAnterior.getFullYear() && f.getMonth() === mesAnterior.getMonth();
}

function sumaCompras(pedidos){
  return pedidos.reduce((acc, p) => {
    const compras = Array.isArray(p.compras) ? p.compras : [];
    return acc + compras.reduce((a, c) => a + Number(c.quantity ?? c.cantidad ?? 1), 0);
  }, 0);
}

function parseTimeToSeconds(timeStr){
  if (!timeStr) return null;
  const parts = timeStr.replace('.', ':').split(':').map(x => Number(x.trim()));
  if (parts.length !== 2 || parts.some(n => Number.isNaN(n))) return null;
  return parts[0] * 3600 + parts[1] * 60;
}

function parseDurationValue(val){
  if (val == null) return 0;
  if (typeof val === 'number' && !Number.isNaN(val)) return Number(val);
  if (typeof val === 'string'){
    const normalized = val.trim().replace(/\s+/g, ' ').toLowerCase();
    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) return numeric;

    const rangeMatch = normalized.match(/(\d{1,2}[:.]\d{2})\s*(?:-|–|—|a|al|hasta)\s*(\d{1,2}[:.]\d{2})/);
    if (rangeMatch){
      const start = parseTimeToSeconds(rangeMatch[1]);
      const end = parseTimeToSeconds(rangeMatch[2]);
      if (start != null && end != null){
        return end >= start ? end - start : (24 * 3600 - start + end);
      }
    }

    const parts = normalized.split(':').map(x => Number(x.trim()));
    if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2 && parts.every(n => !Number.isNaN(n))) return parts[0] * 60 + parts[1];
  }
  return 0;
}

function parseSessionDuration(u){
  if (u == null) return 0;
  if (typeof u === 'object' && u.duracion_sesion_segundos != null){
    const val = Number(u.duracion_sesion_segundos);
    if (!Number.isNaN(val) && val > 0) return val;
  }
  if (typeof u !== 'object') return parseDurationValue(u);
  const candidato = u.horario_de_conexion ?? u.horario_conexion ?? u.horario ?? u.conexion_horario ?? u.duracion ?? u.duration ?? u.tiempo ?? u.tiempo_conexion ?? u.sessionDuration ?? u.session_length ?? u.duracion_sesion;
  return parseDurationValue(candidato);
}

function horaDeEntrada(u){
  const f = u && (u.fecha_hora_entrada || u.fecha_hora || u.fecha);
  if (!f) return null;
  const fecha = new Date(String(f).replace(' ', 'T'));
  if (isNaN(fecha)) return null;
  return fecha.getHours();
}

function formatDuration(seconds){
  if (!seconds || seconds <= 0) return '—';
  const horas = Math.floor(seconds / 3600);
  const minutos = Math.round((seconds % 3600) / 60);
  if (horas > 0) return `${horas}h ${minutos}m`;
  return `${minutos}m`;
}

function renderVentasMesChart(pedidos){
  const dias = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const diasDelMes = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= diasDelMes; d++) {
    dias.push({ dia: d, total: 0 });
  }
  pedidos.forEach(p => {
    const fecha = new Date(getPedidoFecha(p));
    if (isNaN(fecha) || fecha.getFullYear() !== year || fecha.getMonth() !== month) return;
    const idx = fecha.getDate() - 1;
    dias[idx].total += Number(p.precio_compra_total || 0);
  });
  const hayVentas = dias.some(d => d.total > 0);
  const cards = dias.map(day => `
    <div class="chart-card" title="Día ${day.dia}: $${day.total.toFixed(2)}">
      <span class="chart-card-day">${day.dia}</span>
      <span class="chart-card-value"${day.total > 0 ? '' : ' data-zero="true"'}>$${day.total.toFixed(2)}</span>
    </div>`).join('');
  const chart = document.getElementById('resu-ventas-mes-chart');
  if (chart){
    chart.innerHTML = `
      <div class="chart-legend">
        <span>Ventas por día</span>
        <strong>${hayVentas ? `${dias.filter(d => d.total > 0).length} días con ventas` : 'Sin ventas'}</strong>
      </div>
      ${hayVentas ? `<div class="chart-grid-cards">${cards}</div>` : `<div class="chart-empty">No hay ventas registradas este mes.</div>`}`;
  }
}

function renderHorasConexionChart(usuarios){
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
  for (let i = 0; i < usuarios.length; i++) {
    const h = horaDeEntrada(usuarios[i]);
    if (h != null) horas[h].total++;
  }
  const hayDatos = horas.some(h => h.total > 0);
  const mejorHora = hayDatos ? horas.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const max = hayDatos ? Math.max(...horas.map(h => h.total)) : 1;
  const cards = horas.map(h => {
    const width = hayDatos ? Math.max(10, Math.round((h.total / max) * 100)) : 10;
    return `
      <div class="hour-card" title="${h.hora}:00 — ${h.total} visita(s)">
        <div class="hour-card-top">
          <span class="hour-card-hour">${h.hora}:00</span>
          <span class="hour-card-count">${h.total}</span>
        </div>
        <div class="hour-card-bar" style="width:${width}%"></div>
      </div>`;
  }).join('');
  const chart = document.getElementById('resu-horas-chart');
  if (!chart) return;
  chart.innerHTML = `
    <div class="chart-legend">
      <span>Visitas por hora del día (hora de Cuba)</span>
      <strong>${mejorHora ? `Pico: ${mejorHora.hora}:00 h` : '—'}</strong>
    </div>
    ${hayDatos ? `<div class="hour-grid">${cards}</div>` : `<div class="chart-empty">Todavía no hay registros suficientes para calcular horas pico.</div>`}`;
}

function calcularRangoFechas(){
  const { preset, desde, hasta } = state.resumenRango;
  const hoy = new Date();
  const inicioDia = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const finDia = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

  if (preset === 'custom' && desde && hasta){
    return { desde: inicioDia(new Date(desde)), hasta: finDia(new Date(hasta)), etiqueta: `${desde} a ${hasta}` };
  }
  if (preset === 'ayer'){
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
    return { desde: inicioDia(ayer), hasta: finDia(ayer), etiqueta: 'Ayer' };
  }
  if (preset === '7dias'){
    const inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 6);
    return { desde: inicioDia(inicio), hasta: finDia(hoy), etiqueta: 'Últimos 7 días' };
  }
  if (preset === '30dias'){
    const inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 29);
    return { desde: inicioDia(inicio), hasta: finDia(hoy), etiqueta: 'Últimos 30 días' };
  }
  if (preset === 'mes'){
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: inicioDia(inicio), hasta: finDia(hoy), etiqueta: 'Este mes' };
  }
  if (preset === 'mesanterior'){
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: inicioDia(inicio), hasta: finDia(fin), etiqueta: 'Mes anterior' };
  }
  // 'hoy' por defecto
  return { desde: inicioDia(hoy), hasta: finDia(hoy), etiqueta: 'Hoy' };
}

function renderRangoChart(pedidosEnRango, desde, hasta){
  const dias = [];
  const cursor = new Date(desde);
  cursor.setHours(0,0,0,0);
  const fin = new Date(hasta);
  fin.setHours(0,0,0,0);
  while (cursor <= fin && dias.length < 62){
    dias.push({ fecha: new Date(cursor), total: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  pedidosEnRango.forEach(p => {
    const fecha = new Date(getPedidoFecha(p));
    if (isNaN(fecha)) return;
    const dia = dias.find(d => d.fecha.getFullYear() === fecha.getFullYear() && d.fecha.getMonth() === fecha.getMonth() && d.fecha.getDate() === fecha.getDate());
    if (dia) dia.total += Number(p.precio_compra_total || 0);
  });
  const hayVentas = dias.some(d => d.total > 0);
  const cards = dias.map(day => {
    const label = `${day.fecha.getDate()}/${day.fecha.getMonth() + 1}`;
    return `
      <div class="chart-card" title="${label}: $${day.total.toFixed(2)}">
        <span class="chart-card-day">${label}</span>
        <span class="chart-card-value"${day.total > 0 ? '' : ' data-zero="true"'}>$${day.total.toFixed(2)}</span>
      </div>`;
  }).join('');
  const chart = document.getElementById('resu-rango-chart');
  if (!chart) return;
  chart.innerHTML = dias.length ? `
    <div class="chart-legend">
      <span>Ventas por día</span>
      <strong>${hayVentas ? 'Detalle del rango' : 'Sin ventas'}</strong>
    </div>
    ${hayVentas ? `<div class="chart-grid-cards">${cards}</div>` : `<div class="chart-empty">No hay ventas registradas en este rango.</div>`}`
    : `<div class="chart-empty">Selecciona un rango válido.</div>`;
}

async function loadResumen(){
  try{
    const [nuevosData, asignadosData, estadisticasData, productosData] = await Promise.all([
      apiFetch('/api/pedidos'),
      apiFetch('/api/pedidos-asignados').catch(() => ({ pedidosAsignados: [] })),
      apiFetch('/obtener-estadisticas').catch(() => []),
      apiFetch('/api/products').catch(() => ({ products: [] }))
    ]);
    const nuevos = nuevosData.pedidos || [];
    const asignados = asignadosData.pedidosAsignados || [];
    const usuarios = Array.isArray(estadisticasData) ? estadisticasData : [];
    if (Array.isArray(productosData.products)) state.productos = productosData.products;
    const asignadosIds = new Set(asignados.map(p => getOriginalPedidoId(p)));
    const nuevosSinAsignar = nuevos.filter(p => !asignadosIds.has(getOriginalPedidoId(p)));

    const pedidosUnicosMap = new Map();
    [...nuevosSinAsignar, ...asignados].forEach(p => {
      const id = getOriginalPedidoId(p) || `tmp-${Math.random()}`;
      if (!pedidosUnicosMap.has(id) || p.fecha_asignacion) {
        pedidosUnicosMap.set(id, p);
      }
    });
    const pedidosUnicos = Array.from(pedidosUnicosMap.values());

    const delMes = pedidosUnicos.filter(p => esDelMesActual(getPedidoFecha(p)));
    const ventasMes = delMes.reduce((acc, p) => acc + Number(p.precio_compra_total || 0), 0);
    const ventasHoy = pedidosUnicos.filter(p => fechaHoy(getPedidoFecha(p))).reduce((acc, p) => acc + Number(p.precio_compra_total || 0), 0);
    const ventasAyer = pedidosUnicos.filter(p => fechaAyer(getPedidoFecha(p))).reduce((acc, p) => acc + Number(p.precio_compra_total || 0), 0);
    const ventasMesAnterior = pedidosUnicos.filter(p => esDelMesAnterior(getPedidoFecha(p))).reduce((acc, p) => acc + Number(p.precio_compra_total || 0), 0);
    const productosVendidosMes = sumaCompras(delMes);
    const recurrentes = usuarios.filter(u => u.tipo_usuario === 'Recurrente').length;
    const seguimientoAbierto = asignados.filter(p => estadoPedidoKey(p) !== 'completado').length;
    const allDurations = usuarios.map(u => parseSessionDuration(u));
    const validDurations = allDurations.filter(v => v > 0);
    const promedioSegundos = validDurations.length ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length : 0;
    const seguimientoNoPagado = asignados.filter(p => !toBoolean(p.pagado)).length;
    const crecimientoPorcentaje = ventasMesAnterior > 0
      ? ((ventasMes - ventasMesAnterior) / ventasMesAnterior) * 100
      : (ventasMes > 0 ? null : 0);
    const crecimientoTexto = crecimientoPorcentaje === null
      ? 'Nuevo mes'
      : crecimientoPorcentaje === 0
        ? '0%'
        : `${crecimientoPorcentaje > 0 ? '▲ +' : '▼ '}${Math.abs(crecimientoPorcentaje).toFixed(1)}%`;
    const crecimientoClase = crecimientoPorcentaje > 0
      ? 'growth-positive'
      : crecimientoPorcentaje < 0
        ? 'growth-negative'
        : 'growth-neutral';

    setText('resu-ventas-mes', '$' + ventasMes.toFixed(2));
    setText('resu-pedidos-mes', delMes.length);
    setText('resu-pedidos-nuevos', nuevosSinAsignar.length);
    setText('resu-pedidos-seguimiento', seguimientoNoPagado);
    const elCrecimiento = setText('resu-crecimiento-mes', crecimientoTexto);
    if (elCrecimiento) elCrecimiento.className = `stat-value ${crecimientoClase}`;
    setText('resu-ventas-ayer', '$' + ventasAyer.toFixed(2));
    setText('resu-ventas-hoy', '$' + ventasHoy.toFixed(2));
    setText('resu-productos-mes', productosVendidosMes);
    setText('resu-usuarios', usuarios.length);
    setText('resu-usuarios-sub', usuarios.length ? `${recurrentes} recurrentes` : '—');

    const recientes = [...pedidosUnicos]
      .sort((a, b) => new Date(getPedidoFecha(b)) - new Date(getPedidoFecha(a)))
      .slice(0, 6);
    const listaRecientes = document.getElementById('resu-recientes');
    if (listaRecientes){
      listaRecientes.innerHTML = recientes.length ? recientes.map(p => `
        <div class="mini-row" data-resu-pedido="${getOriginalPedidoId(p)}" style="cursor:pointer;">
          <span class="k">${escapeHtml(p.nombre_comprador || '—')}</span>
          <span class="v">$${Number(p.precio_compra_total || 0).toFixed(2)}</span>
        </div>`).join('') : `<p class="hint">Todavía no hay pedidos.</p>`;
      listaRecientes.querySelectorAll('[data-resu-pedido]').forEach(row => {
        row.addEventListener('click', () => {
          const p = pedidosUnicos.find(x => getOriginalPedidoId(x) === row.dataset.resuPedido);
          if (p) showPedidoDetalle(p);
        });
      });
    }

    const origenes = {};
    usuarios.forEach(u => {
      const key = u.origen || u.fuente_trafico || 'Desconocido';
      origenes[key] = (origenes[key] || 0) + 1;
    });
    const listaOrigenes = document.getElementById('resu-origenes');
    if (listaOrigenes){
      const origenesOrdenados = Object.entries(origenes).sort((a, b) => b[1] - a[1]).slice(0, 6);
      listaOrigenes.innerHTML = origenesOrdenados.length ? origenesOrdenados.map(([k, v]) => `
        <div class="mini-row"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`).join('') : `<p class="hint">Sin datos todavía.</p>`;
    }

    renderVentasMesChart(delMes);

    /* ---------------- Productos más vendidos (del mes) ---------------- */
    const ventasPorProducto = new Map();
    delMes.forEach(p => {
      const compras = Array.isArray(p.compras) ? p.compras : [];
      compras.forEach(c => {
        const nombre = c.name || c.nombre || 'Producto sin nombre';
        const cantidad = Number(c.quantity ?? c.cantidad ?? 1) || 0;
        ventasPorProducto.set(nombre, (ventasPorProducto.get(nombre) || 0) + cantidad);
      });
    });
    const topProductos = Array.from(ventasPorProducto.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const listaTopProductos = document.getElementById('resu-top-productos');
    if (listaTopProductos){
      listaTopProductos.innerHTML = topProductos.length ? topProductos.map(([nombre, cant]) => `
        <div class="mini-row"><span class="k">${escapeHtml(nombre)}</span><span class="v">${cant} und.</span></div>`).join('')
        : `<p class="hint">Sin ventas este mes todavía.</p>`;
    }

    /* ---------------- Stock bajo / sin stock ---------------- */
    const { bajo: bajoCount, sin: sinCount } = contarProductosPorStock();
    setText('resu-stock-bajo', bajoCount);
    setText('resu-stock-sin', sinCount);
    const listaStock = document.getElementById('resu-stock-lista');
    if (listaStock){
      const conProblema = state.productos
        .map(p => ({ p, estado: estadoStockProducto(p) }))
        .filter(x => x.estado === 'sin' || x.estado === 'bajo')
        .sort((a, b) => (a.estado === b.estado ? Number(a.p.stock) - Number(b.p.stock) : (a.estado === 'sin' ? -1 : 1)))
        .slice(0, 6);
      listaStock.innerHTML = conProblema.length ? conProblema.map(({ p, estado }) => `
        <div class="mini-row">
          <span class="k">${escapeHtml(p.nombre)}</span>
          <span class="v">${estado === 'sin' ? `<span class="pill pill-danger">Sin stock</span>` : `<span class="pill pill-warn">${p.stock} und.</span>`}</span>
        </div>`).join('') : `<p class="hint">Todo el inventario con control de stock está en buen nivel.</p>`;
    }

    /* ---------------- Rango de fechas seleccionado ---------------- */
    const { desde, hasta, etiqueta } = calcularRangoFechas();
    const pedidosEnRango = pedidosUnicos.filter(p => {
      const fecha = new Date(getPedidoFecha(p));
      return !isNaN(fecha) && fecha >= desde && fecha <= hasta;
    });
    const ventasRango = pedidosEnRango.reduce((acc, p) => acc + Number(p.precio_compra_total || 0), 0);
    const productosRango = sumaCompras(pedidosEnRango);
    const ticketPromedio = pedidosEnRango.length ? ventasRango / pedidosEnRango.length : 0;
    setText('resu-rango-ventas', '$' + ventasRango.toFixed(2));
    setText('resu-rango-label', etiqueta);
    setText('resu-rango-pedidos', pedidosEnRango.length);
    setText('resu-rango-productos', productosRango);
    setText('resu-rango-ticket', '$' + ticketPromedio.toFixed(2));

    /* ---------------- Horas buenas de entrada ---------------- */
    renderHorasConexionChart(usuarios);
  }catch(e){
    showToast('Error cargando el resumen: ' + e.message, true);
  }
}

/* ---------------- Filtro de rango de fechas (Resumen) ---------------- */

document.querySelectorAll('#resu-rango-presets [data-rango]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.resumenRango = { preset: btn.dataset.rango, desde: null, hasta: null };
    document.querySelectorAll('#resu-rango-presets [data-rango]').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('resu-desde').value = '';
    document.getElementById('resu-hasta').value = '';
    loadResumen();
  });
});

document.getElementById('resu-rango-aplicar')?.addEventListener('click', () => {
  const desde = document.getElementById('resu-desde').value;
  const hasta = document.getElementById('resu-hasta').value;
  if (!desde || !hasta){
    showToast('Selecciona fecha de inicio y de fin.', true);
    return;
  }
  if (desde > hasta){
    showToast('La fecha "Desde" no puede ser posterior a "Hasta".', true);
    return;
  }
  state.resumenRango = { preset: 'custom', desde, hasta };
  document.querySelectorAll('#resu-rango-presets [data-rango]').forEach(b => b.classList.remove('active'));
  loadResumen();
});

document.querySelectorAll('[data-goto-inv]').forEach(card => {
  card.addEventListener('click', () => {
    const tab = card.dataset.gotoInv;
    goToView('inventario');
    const btn = document.querySelector(`#inv-tabs [data-itab="${tab}"]`);
    if (btn) btn.click();
  });
});

const resumenBtn = document.querySelector('.nav-item[data-view="resumen"]');
if (resumenBtn) resumenBtn.addEventListener('click', loadResumen);
// (Se quitó la llamada automática a loadResumen() de aquí: ahora la
// dispara bootPanel() una vez confirmada la sesión, para no llamar a la
// API antes de tiempo y disparar un 401 innecesario.)

/* ---------------------- Menú lateral en móvil ---------------------- */

(function initMobileNav(){
  const menuBtn = document.getElementById('menu-btn');
  const overlay = document.getElementById('nav-overlay');
  const sidebar = document.getElementById('sidebar');
  if (!menuBtn || !overlay || !sidebar) return;

  const toggle = (open) => {
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
  };
  menuBtn.addEventListener('click', () => toggle(true));
  overlay.addEventListener('click', () => toggle(false));
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => toggle(false)));

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle){
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => { topbarTitle.textContent = btn.textContent.trim(); });
    });
  }
})();
