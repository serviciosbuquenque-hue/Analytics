/* =========================================================================
   Panel de gestión — se conecta directamente a los endpoints del backend
   (Express + Firebase RTDB + Cloudinary) ya existentes.
   ========================================================================= */

const state = {
  apiUrl: localStorage.getItem('panel_api_url') || '',
  cloudName: localStorage.getItem('panel_cloud_name') || 'vgvdzqql',
  productos: [],
  packs: [],
  pedidosNuevos: [],
  pedidosSeguimiento: [],
  usuarios: [],
  prodImages: [],   // imágenes en edición del modal de producto (public_id o dataURL)
  packImages: [],   // imágenes en edición del modal de pack
  invTab: 'todos',  // pestaña activa en Inventario: todos | bajo | sin
  stockUmbral: Number(localStorage.getItem('panel_stock_umbral') || 5),
  resumenRango: { preset: 'hoy', desde: null, hasta: null }, // rango activo en Resumen
};

/* ---------------------------- Helpers de red ---------------------------- */

function apiUrlOk(){
  return state.apiUrl && state.apiUrl.trim().length > 0;
}

async function apiFetch(path, options = {}){
  if (!apiUrlOk()){
    showToast('Configura primero la URL del backend en "Conexión".', true);
    goToView('config');
    throw new Error('API URL no configurada');
  }
  const base = state.apiUrl.replace(/\/$/, '');
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
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

// Redimensiona/comprime la imagen en el navegador antes de convertirla a
// base64. Esto es clave: el backend usa express.json() con un límite de
// tamaño de body (por defecto 100kb), y una foto de cámara sin comprimir
// (varios MB) supera ese límite y provoca un error 500/413 al guardar.
// Con esto, cada imagen queda en unos pocos cientos de KB como máximo y
// se sube ya en formato WebP para ahorrar ancho de banda.
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
  document.getElementById('connStatusText').textContent = text;
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
  const cloud = document.getElementById('cfg-cloud-name').value.trim();
  state.apiUrl = url;
  state.cloudName = cloud;
  localStorage.setItem('panel_api_url', url);
  localStorage.setItem('panel_cloud_name', cloud);

  const result = document.getElementById('cfg-result');
  result.textContent = 'Probando conexión...';
  result.className = 'hint';
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
  document.getElementById('cfg-cloud-name').value = state.cloudName;
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
  document.getElementById('inv-count-todos').textContent = state.productos.length;
  document.getElementById('inv-count-bajo').textContent = bajo;
  document.getElementById('inv-count-sin').textContent = sin;
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
      <div class="product-card-img">${imgUrl ? `<img src="${imgUrl}" alt="${escapeHtml(p.nombre)}">` : `<div class="thumb-placeholder">📦</div>`}</div>
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
  document.getElementById('prod-modal-title').textContent = p ? 'Editar producto' : 'Nuevo producto';
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
    tile.innerHTML = `${url ? `<img src="${url}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb-placeholder',textContent:'⚠'}))">` : `<div class="thumb-placeholder">🖼</div>`}<button class="rm" data-idx="${idx}">✕</button>`;
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
      <td data-label="Imagen">${imgUrl ? `<img class="thumb" src="${imgUrl}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb-placeholder',textContent:'⚠'}))">` : `<div class="thumb-placeholder">🎁</div>`}</td>
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
  });

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openPackModal(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deletePack(b.dataset.del)));
}

document.getElementById('pack-search').addEventListener('input', renderPacks);
document.getElementById('pack-new').addEventListener('click', () => openPackModal(null));

function openPackModal(id){
  const p = id ? state.packs.find(x => x.id === id) : null;
  document.getElementById('pack-modal-title').textContent = p ? 'Editar pack' : 'Nuevo pack';
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

/* ================================================================
   OFERTA -> DESCUENTO (nuevo)
   En vez de escribir el porcentaje a mano, el usuario escribe el precio
   final que quiere cobrar y acá se calcula solo el % que hay que guardar
   (el backend/tienda sigue usando el campo "descuento" tal cual). Se usa
   la misma lógica para producto y para pack, cambiando solo el prefijo de
   ids ("prod" / "pack").
   ================================================================ */

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

/* ================================================================
   PEDIDOS  ->  /api/pedidos  (+ /api/pedidos/:id/asignar)
              /api/pedidos-asignados

   Antes "Pedidos nuevos" y "Pedidos guardados (seguimiento)" vivían en
   dos vistas separadas, cada una haciendo su propio fetch por su lado.
   Eso producía dos problemas:
     1) el filtro de "quién ya es asignado" se calculaba en dos lugares
        distintos (loadCounts y loadPedidosNuevos) y podía desincronizarse.
     2) "reincidente" solo se calculaba dentro de Nuevos, así que un
        cliente que volvía a comprar ya con su pedido en Guardados no se
        marcaba como reincidente ahí.
   Ahora todo vive en un solo panel "Pedidos" con dos pestañas (Nuevos /
   Guardados) que comparten una sola carga de datos y un solo historial
   para detectar clientes reincidentes en cualquiera de las dos pestañas.
   ================================================================ */

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

// Carga única para toda la sección "Pedidos": trae /api/pedidos y
// /api/pedidos-asignados juntos, calcula qué pedidos nuevos ya fueron
// asignados y deja ambas listas listas para las dos pestañas.
async function loadPedidosSection(){
  try{
    const [nuevosData, asignadosData] = await Promise.all([
      apiFetch('/api/pedidos'),
      apiFetch('/api/pedidos-asignados').catch(() => ({ pedidosAsignados: [] }))
    ]);
    const asignados = asignadosData.pedidosAsignados || [];
    // El registro asignado tiene su PROPIO id (push-id nuevo generado al
    // asignar); el id del pedido original queda en "pedido_origen_id". Hay
    // que excluir por ese campo, no por "id", o el pedido queda duplicado
    // (sigue en Nuevos y también aparece en Guardados).
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

// Los 4 estados son independientes (checkboxes). "pagado" y "pendiente_pago"
// son mutuamente excluyentes: no tiene sentido que un pedido esté pagado
// y pendiente de pago a la vez, así que marcar uno desmarca el otro.
const ESTADO_FIELDS = [
  { key: 'aceptado',       short: 'Aceptado',    label: 'Aceptado' },
  { key: 'entregado',      short: 'Entregado',   label: 'Entregado' },
  { key: 'pendiente_pago', short: 'Pend. pago',  label: 'Pendiente de pago' },
  { key: 'pagado',         short: 'Pagado',      label: 'Pagado' },
];

// Un pedido se considera "completado" cuando ya fue entregado y pagado.
// Esa es la línea que separa la pestaña "En proceso" de "Completados".
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

// Pestaña activa dentro de "Guardados". 'proceso' agrupa pendiente + en
// proceso (todo lo que todavía no está completado y pagado).
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
    // Reincidente calculado contra TODO el historial (nuevos + guardados),
    // no solo contra el campo que pudiera venir del backend.
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

  document.getElementById('tab-count-nuevos').textContent = nuevosCount;
  document.getElementById('tab-count-guardados').textContent = guardadosCount;
  document.getElementById('tab-count-seguimiento').textContent = enProceso;
  document.getElementById('seg-count-proceso').textContent = enProceso;
  document.getElementById('seg-count-completado').textContent = completados;
  // Badge del sidebar: todo lo que todavía necesita atención (pedidos nuevos
  // sin asignar + guardados en proceso no pagados).
  document.getElementById('badge-pedidos').textContent = nuevosCount + enProceso;
}

/* -------------------------- Detalle de pedido -------------------------- */

function showPedidoDetalle(p){
  if (!p) return;
  const body = document.getElementById('pedido-detalle-body');
  const compras = Array.isArray(p.compras) ? p.compras : [];
  body.innerHTML = `
    <dl class="detail-grid">
      <dt>Número de orden</dt><dd>${escapeHtml(getPedidoNumero(p) || '—')}</dd>
      <dt>Comprador</dt><dd>${escapeHtml(p.nombre_comprador || '—')}</dd>
      <dt>Teléfono</dt><dd>${escapeHtml(p.telefono_comprador || '—')}</dd>
      <dt>Correo</dt><dd>${escapeHtml(p.correo_comprador || '—')}</dd>
      <dt>Dirección</dt><dd>${escapeHtml(p.direccion_envio || '—')}</dd>
      <dt>Entrega a</dt><dd>${escapeHtml(p.nombre_persona_entrega || '—')} (${escapeHtml(p.telefono_persona_entrega || '—')})</dd>
      <dt>Total</dt><dd>$${Number(p.precio_compra_total || 0).toFixed(2)}</dd>
    </dl>
    ${compras.length ? `
      <div class="compras-list">
        <strong>Productos comprados</strong>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th></tr></thead>
          <tbody>
            ${compras.map(c => `<tr><td>${escapeHtml(c.name || c.nombre || '—')}</td><td>${c.quantity ?? c.cantidad ?? 1}</td><td>$${Number(c.unitPrice ?? c.precio ?? 0).toFixed(2)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
  `;
  openModal('modal-pedido');
}

/* ================================================================
   REGISTRO DE USUARIOS (ESTADÍSTICAS)  ->  /obtener-estadisticas
   ================================================================ */

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

/* --------------------------------- Init ---------------------------------- */

(async function init(){
  initConfigFields();
  if (apiUrlOk()){
    const ok = await testConnection();
    if (ok){
      renderNotificationIconPicker();
      loadProductos();
      loadPedidosSection();
      loadNotificationBanner();
    } else {
      renderNotificationIconPicker();
      goToView('config');
    }
  } else {
    goToView('config');
  }
})();

/* ================================================================
   RESUMEN  ->  construido con los mismos endpoints que ya usa el panel
   (/api/pedidos, /api/pedidos-asignados, /obtener-estadisticas).
   ================================================================ */

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

// El backend guarda la duración real de la sesión en
// "duracion_sesion_segundos" (número de segundos) — ese es el campo que hoy
// devuelve /obtener-estadisticas, así que es la fuente principal. El resto
// de nombres de campo se mantienen solo como respaldo por si el registro
// viene de una versión anterior del frontend de la tienda.
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

// Hora de entrada (0-23) de un registro de usuario, para saber a qué horas
// del día suele conectarse la gente. Usa "fecha_hora_entrada"
// (formato "yyyy-MM-dd HH:mm:ss", hora de Cuba) tal como lo guarda el backend.
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

// Fechas límite (inclusive) de un rango, según el preset elegido o un rango
// personalizado. Devuelve objetos Date normalizados a inicio/fin de día.
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

    document.getElementById('resu-ventas-mes').textContent = '$' + ventasMes.toFixed(2);
    document.getElementById('resu-pedidos-mes').textContent = delMes.length;
    document.getElementById('resu-pedidos-nuevos').textContent = nuevosSinAsignar.length;
    document.getElementById('resu-pedidos-seguimiento').textContent = seguimientoNoPagado;
    document.getElementById('resu-crecimiento-mes').textContent = crecimientoTexto;
    document.getElementById('resu-crecimiento-mes').className = `stat-value ${crecimientoClase}`;
    document.getElementById('resu-ventas-ayer').textContent = '$' + ventasAyer.toFixed(2);
    document.getElementById('resu-ventas-hoy').textContent = '$' + ventasHoy.toFixed(2);
    document.getElementById('resu-productos-mes').textContent = productosVendidosMes;
    document.getElementById('resu-usuarios').textContent = usuarios.length;
    document.getElementById('resu-usuarios-sub').textContent = usuarios.length ? `${recurrentes} recurrentes` : '—';

    const recientes = [...pedidosUnicos]
      .sort((a, b) => new Date(getPedidoFecha(b)) - new Date(getPedidoFecha(a)))
      .slice(0, 6);
    const listaRecientes = document.getElementById('resu-recientes');
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

    const origenes = {};
    usuarios.forEach(u => {
      const key = u.origen || u.fuente_trafico || 'Desconocido';
      origenes[key] = (origenes[key] || 0) + 1;
    });
    const listaOrigenes = document.getElementById('resu-origenes');
    const origenesOrdenados = Object.entries(origenes).sort((a, b) => b[1] - a[1]).slice(0, 6);
    listaOrigenes.innerHTML = origenesOrdenados.length ? origenesOrdenados.map(([k, v]) => `
      <div class="mini-row"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`).join('') : `<p class="hint">Sin datos todavía.</p>`;

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
    document.getElementById('resu-stock-bajo').textContent = bajoCount;
    document.getElementById('resu-stock-sin').textContent = sinCount;
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
    document.getElementById('resu-rango-ventas').textContent = '$' + ventasRango.toFixed(2);
    document.getElementById('resu-rango-label').textContent = etiqueta;
    document.getElementById('resu-rango-pedidos').textContent = pedidosEnRango.length;
    document.getElementById('resu-rango-productos').textContent = productosRango;
    document.getElementById('resu-rango-ticket').textContent = '$' + ticketPromedio.toFixed(2);

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
if (apiUrlOk()) loadResumen();

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
