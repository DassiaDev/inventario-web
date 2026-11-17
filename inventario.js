/**
 * LÓGICA DE CONTROL DE INVENTARIO - SECCIÓN DE PRODUCTOS
 * Universidad Tecnológica de San Juan del Río (UTSJR)
 *
 * Funcionalidades integradas dentro de la misma sección de productos:
 * 1. Base de datos persistente (LocalStorage con esquema idéntico a MySQL).
 * 2. Guardado de nuevos productos con validación estricta de casos alternos.
 * 3. Modificación de productos mediante ventana modal interactiva.
 * 4. Eliminación de productos con confirmación de seguridad.
 * 5. Búsqueda y filtrado dinámico en tiempo real.
 * 6. Generación y exportación de reportes a Excel (.xlsx / CSV UTF-8).
 */

const STORAGE_KEY = 'inventario_db_productos_v2';

// Catálogo inicial por defecto (Exactamente los productos originales del sistema)
const DATOS_INICIALES = [
    {
        id: 1,
        nombre: "Lápiz",
        categoria: "Papelería",
        descripcion: "Lápiz para escritura",
        existencia: 120,
        fecha_registro: "2026-11-10"
    },
    {
        id: 2,
        nombre: "Cuaderno",
        categoria: "Papelería",
        descripcion: "Cuaderno de notas",
        existencia: 50,
        fecha_registro: "2026-11-11"
    },
    {
        id: 3,
        nombre: "Borrador",
        categoria: "Papelería",
        descripcion: "Borrador para lápiz",
        existencia: 35,
        fecha_registro: "2026-11-12"
    },
    {
        id: 4,
        nombre: "Regla",
        categoria: "Papelería",
        descripcion: "Regla de 30 cm",
        existencia: 40,
        fecha_registro: "2026-11-13"
    }
];

/* ============================================================
   UTILIDADES Y SEGURIDAD (SANITIZACIÓN CONTRA XSS)
   ============================================================ */

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function calcularEstadoStock(cantidad) {
    const cant = Number(cantidad);
    if (cant <= 0) {
        return { texto: 'Agotado', clase: 'badge-agotado' };
    } else if (cant <= 10) {
        return { texto: 'Stock bajo', clase: 'badge-bajo' };
    } else {
        return { texto: 'En existencia', clase: 'badge-disponible' };
    }
}

/* ============================================================
   ACCESO A LA BASE DE DATOS LOCAL
   ============================================================ */

function obtenerProductosBD() {
    try {
        // Limpiar versiones previas de pruebas si existían
        localStorage.removeItem('inventario_db_productos');
        localStorage.removeItem('inventario_web_productos_v1');

        const guardados = localStorage.getItem(STORAGE_KEY);
        if (!guardados) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(DATOS_INICIALES));
            return [...DATOS_INICIALES];
        }
        const data = JSON.parse(guardados);
        return Array.isArray(data) ? data : [...DATOS_INICIALES];
    } catch (e) {
        console.error("Error al leer la base de datos:", e);
        return [...DATOS_INICIALES];
    }
}

function guardarProductosBD(productos) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(productos));
        return true;
    } catch (e) {
        console.error("Error al persistir en la base de datos:", e);
        return false;
    }
}

function generarNuevoId(productos) {
    if (!productos || productos.length === 0) return 1;
    const maxId = Math.max(...productos.map(p => Number(p.id) || 0));
    return maxId + 1;
}

/* ============================================================
   VALIDACIONES ROBUSTAS Y CASOS ALTERNOS
   ============================================================ */

/**
 * Valida todos los campos de un producto cubriendo los casos alternos:
 * - Nombre vacío o solo espacios.
 * - Nombre con menos de 2 caracteres o más de 100.
 * - Nombres duplicados (insensible a mayúsculas/minúsculas y espacios).
 * - Categoría vacía o solo espacios.
 * - Existencia vacía, nula, NaN, negativa, con decimales o exorbitante.
 */
function validarProducto(datos, esEdicion = false) {
    const errores = {};
    const productos = obtenerProductosBD();

    // 1. Nombre del producto
    const nombre = (datos.nombre || '').trim();
    if (!nombre) {
        errores.nombre = "El nombre del producto es obligatorio.";
    } else if (nombre.length < 2) {
        errores.nombre = "El nombre debe contener al menos 2 caracteres.";
    } else if (nombre.length > 100) {
        errores.nombre = "El nombre no puede exceder 100 caracteres.";
    } else {
        // Caso alterno: Duplicados
        const duplicado = productos.find(p =>
            p.nombre.trim().toLowerCase() === nombre.toLowerCase() &&
            (!esEdicion || Number(p.id) !== Number(datos.id))
        );
        if (duplicado) {
            errores.nombre = `Ya existe un producto con el nombre "${escapeHTML(duplicado.nombre)}" (ID #${duplicado.id}).`;
        }
    }

    // 2. Categoría
    const categoria = (datos.categoria || '').trim();
    if (!categoria) {
        errores.categoria = "La categoría es obligatoria.";
    } else if (categoria.length > 50) {
        errores.categoria = "La categoría no puede exceder 50 caracteres.";
    }

    // 3. Cantidad en existencia (Casos alternos numéricos)
    const cantRaw = datos.existencia;
    if (cantRaw === undefined || cantRaw === null || cantRaw === '' || String(cantRaw).trim() === '') {
        errores.existencia = "La cantidad en existencia es obligatoria.";
    } else {
        const num = Number(cantRaw);
        if (isNaN(num)) {
            errores.existencia = "La existencia debe ser un número válido.";
        } else if (!Number.isInteger(num)) {
            errores.existencia = "La cantidad debe ser un número entero (sin decimales).";
        } else if (num < 0) {
            errores.existencia = "La cantidad no puede ser negativa (mínimo 0).";
        } else if (num > 1000000) {
            errores.existencia = "La cantidad excede el límite máximo permitido (1,000,000).";
        }
    }

    // 4. Descripción
    const desc = (datos.descripcion || '').trim();
    if (desc.length > 300) {
        errores.descripcion = "La descripción no puede superar los 300 caracteres.";
    }

    return {
        esValido: Object.keys(errores).length === 0,
        errores
    };
}

/* ============================================================
   SISTEMA DE NOTIFICACIONES TOAST
   ============================================================ */

function notificar(mensaje, tipo = 'exito') {
    let contenedor = document.getElementById('toast-contenedor');
    if (!contenedor) {
        contenedor = document.createElement('div');
        contenedor.id = 'toast-contenedor';
        contenedor.className = 'toast-contenedor';
        document.body.appendChild(contenedor);
    }

    const toast = document.createElement('div');
    toast.className = `toast-notif ${tipo}`;

    let icono = '✅';
    if (tipo === 'error') icono = '❌';
    if (tipo === 'aviso') icono = '⚠️';

    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <span>${icono}</span>
            <span>${escapeHTML(mensaje)}</span>
        </div>
        <button type="button" style="background:none; border:none; cursor:pointer; font-size:16px; margin-left:12px;" onclick="this.parentElement.remove()">&times;</button>
    `;

    contenedor.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3500);
}

/* ============================================================
   EXPORTAR REPORTE A EXCEL (.XLSX / CSV UTF-8 BOM)
   ============================================================ */

function exportarExcelReporte() {
    const productos = obtenerProductosBD();

    if (productos.length === 0) {
        notificar("No hay productos en el inventario para exportar.", "aviso");
        return;
    }

    const fechaHoy = new Date().toISOString().split('T')[0];
    const nombreArchivo = `Reporte_Inventario_Productos_${fechaHoy}`;

    // Opción 1: Exportar con SheetJS a formato .xlsx nativo si la librería está disponible
    if (typeof XLSX !== 'undefined') {
        try {
            const filas = productos.map(p => {
                const estado = calcularEstadoStock(p.existencia);
                return {
                    "ID": p.id,
                    "Producto": p.nombre,
                    "Categoría": p.categoria,
                    "Descripción": p.descripcion || 'Sin descripción',
                    "Existencia": p.existencia,
                    "Estado": estado.texto,
                    "Fecha Registro": p.fecha_registro || fechaHoy
                };
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(filas);

            // Ajustar anchos de columnas
            ws['!cols'] = [
                { wch: 8 },
                { wch: 30 },
                { wch: 18 },
                { wch: 40 },
                { wch: 14 },
                { wch: 16 },
                { wch: 16 }
            ];

            XLSX.utils.book_append_sheet(wb, ws, "Inventario");
            XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
            notificar("Reporte de inventario descargado en Excel (.xlsx).", "exito");
            return;
        } catch (e) {
            console.warn("Error exportando con SheetJS, aplicando fallback CSV:", e);
        }
    }

    // Opción 2: Fallback compatible con Microsoft Excel (CSV con BOM UTF-8 y delimitador ;)
    try {
        const encabezados = ["ID", "Producto", "Categoría", "Descripción", "Existencia", "Estado", "Fecha Registro"];
        const lineas = [encabezados.join(";")];

        productos.forEach(p => {
            const estado = calcularEstadoStock(p.existencia);
            lineas.push([
                p.id,
                `"${(p.nombre || '').replace(/"/g, '""')}"`,
                `"${(p.categoria || '').replace(/"/g, '""')}"`,
                `"${(p.descripcion || '').replace(/"/g, '""')}"`,
                p.existencia,
                `"${estado.texto}"`,
                `"${p.fecha_registro || fechaHoy}"`
            ].join(";"));
        });

        const csvContenido = "\uFEFF" + lineas.join("\r\n");
        const blob = new Blob([csvContenido], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement("a");
        const url = URL.createObjectURL(blob);

        enlace.setAttribute("href", url);
        enlace.setAttribute("download", `${nombreArchivo}.csv`);
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        URL.revokeObjectURL(url);

        notificar("Reporte exportado exitosamente para Excel (CSV UTF-8).", "exito");
    } catch (err) {
        console.error("Error al exportar:", err);
        notificar("No se pudo generar el archivo de reporte.", "error");
    }
}

/* ============================================================
   CONTROLADOR PRINCIPAL: SECCIÓN DE PRODUCTOS
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('tabla-productos-body');
    if (!tbody) return; // Solo actuar si estamos en la sección de productos

    // Elementos del DOM
    const btnToggleForm = document.getElementById('btn-toggle-formulario');
    const panelNuevo = document.getElementById('panel-nuevo-producto');
    const formGuardar = document.getElementById('form-guardar-producto');
    const btnCancelarGuardado = document.getElementById('btn-cancelar-guardado');
    const alertaExito = document.getElementById('alerta-guardado-exito');
    const mensajeExitoTexto = document.getElementById('mensaje-exito-texto');

    const inputBuscar = document.getElementById('input-buscar');
    const selectCategoria = document.getElementById('filtro-categoria');
    const selectStock = document.getElementById('filtro-stock');
    const btnLimpiarFiltros = document.getElementById('btn-limpiar-filtros');
    const contadorTexto = document.getElementById('contador-productos-texto');
    const mensajeSinDatos = document.getElementById('mensaje-sin-datos');
    const btnExportar = document.getElementById('btn-exportar-excel');
    const btnRestaurarDemo = document.getElementById('btn-restaurar-demo');

    // Modales
    const modalModificar = document.getElementById('modal-modificar');
    const formModificar = document.getElementById('form-modificar-producto');
    const btnCerrarModalMod = document.getElementById('btn-cerrar-modal-mod');
    const btnCancelarModalMod = document.getElementById('btn-cancelar-modal-mod');

    const modalEliminar = document.getElementById('modal-eliminar');
    const btnCerrarModalDel = document.getElementById('btn-cerrar-modal-del');
    const btnCancelarModalDel = document.getElementById('btn-cancelar-modal-del');
    const btnConfirmarDel = document.getElementById('btn-confirmar-eliminar-accion');
    const spanDelNombre = document.getElementById('eliminar-producto-nombre');
    const spanDelId = document.getElementById('eliminar-producto-id');

    let productoIdAEliminar = null;

    // Actualizar métricas KPI
    function actualizarKPIs(productos) {
        const total = productos.length;
        const unidades = productos.reduce((acc, p) => acc + (Number(p.existencia) || 0), 0);
        const bajo = productos.filter(p => Number(p.existencia) > 0 && Number(p.existencia) <= 10).length;
        const agotado = productos.filter(p => Number(p.existencia) <= 0).length;

        const elTot = document.getElementById('kpi-total');
        const elUni = document.getElementById('kpi-unidades');
        const elBaj = document.getElementById('kpi-bajo');
        const elAgo = document.getElementById('kpi-agotado');

        if (elTot) elTot.textContent = total;
        if (elUni) elUni.textContent = unidades.toLocaleString();
        if (elBaj) elBaj.textContent = bajo;
        if (elAgo) elAgo.textContent = agotado;
    }

    // Actualizar dropdown de categorías según la base de datos actual
    function actualizarFiltroCategorias(productos) {
        if (!selectCategoria) return;
        const valorSeleccionado = selectCategoria.value;
        const categorias = [...new Set(productos.map(p => p.categoria.trim()))].sort();

        selectCategoria.innerHTML = '<option value="">Todas las categorías</option>';
        categorias.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            if (cat === valorSeleccionado) opt.selected = true;
            selectCategoria.appendChild(opt);
        });
    }

    // Renderizar la tabla con filtros aplicados
    function renderizarTabla() {
        const productos = obtenerProductosBD();
        actualizarKPIs(productos);
        actualizarFiltroCategorias(productos);

        const busqueda = (inputBuscar ? inputBuscar.value : '').toLowerCase().trim();
        const catFiltro = selectCategoria ? selectCategoria.value : '';
        const stockFiltro = selectStock ? selectStock.value : '';

        const filtrados = productos.filter(p => {
            // Filtro de texto (busca en ID, nombre o categoría)
            const coincideTexto = !busqueda ||
                String(p.id).includes(busqueda) ||
                (p.nombre || '').toLowerCase().includes(busqueda) ||
                (p.categoria || '').toLowerCase().includes(busqueda) ||
                (p.descripcion || '').toLowerCase().includes(busqueda);

            // Filtro de categoría
            const coincideCat = !catFiltro || p.categoria.trim() === catFiltro;

            // Filtro de stock
            let coincideStock = true;
            const cant = Number(p.existencia);
            if (stockFiltro === 'agotado') {
                coincideStock = cant <= 0;
            } else if (stockFiltro === 'bajo') {
                coincideStock = cant > 0 && cant <= 10;
            } else if (stockFiltro === 'disponible') {
                coincideStock = cant > 10;
            }

            return coincideTexto && coincideCat && coincideStock;
        });

        if (contadorTexto) {
            contadorTexto.textContent = `Mostrando ${filtrados.length} de ${productos.length} productos`;
        }

        tbody.innerHTML = '';

        if (filtrados.length === 0) {
            if (mensajeSinDatos) mensajeSinDatos.style.display = 'block';
            return;
        }

        if (mensajeSinDatos) mensajeSinDatos.style.display = 'none';

        filtrados.forEach(p => {
            const estado = calcularEstadoStock(p.existencia);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${p.id}</strong></td>
                <td>
                    <span class="td-producto-nombre">${escapeHTML(p.nombre)}</span>
                    ${p.descripcion ? `<span class="td-producto-desc">${escapeHTML(p.descripcion)}</span>` : ''}
                </td>
                <td><span class="badge-cat">${escapeHTML(p.categoria)}</span></td>
                <td class="text-center"><strong>${p.existencia}</strong></td>
                <td class="text-center">
                    <span class="badge-status ${estado.clase}">${estado.texto}</span>
                </td>
                <td class="text-center">
                    <div class="acciones-td">
                        <button type="button" class="btn-accion-tabla btn-modificar" data-id="${p.id}" title="Modificar este producto">
                            ✏️ Modificar
                        </button>
                        <button type="button" class="btn-accion-tabla btn-eliminar" data-id="${p.id}" data-nombre="${escapeHTML(p.nombre)}" title="Eliminar este producto">
                            🗑️ Eliminar
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Asignar eventos de modificar y eliminar
        tbody.querySelectorAll('.btn-modificar').forEach(btn => {
            btn.addEventListener('click', () => abrirModalModificar(btn.dataset.id));
        });

        tbody.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', () => abrirModalEliminar(btn.dataset.id, btn.dataset.nombre));
        });
    }

    // Toggle para mostrar/ocultar panel de nuevo producto
    if (btnToggleForm && panelNuevo) {
        btnToggleForm.addEventListener('click', () => {
            const estaVisible = panelNuevo.style.display !== 'none';
            panelNuevo.style.display = estaVisible ? 'none' : 'block';
            if (!estaVisible) {
                document.getElementById('nuevo-nombre').focus();
            }
        });
    }

    if (btnCancelarGuardado && panelNuevo) {
        btnCancelarGuardado.addEventListener('click', () => {
            panelNuevo.style.display = 'none';
            formGuardar.reset();
            limpiarErroresGuardar();
        });
    }

    // -------------------------------------------------------------
    // GUARDAR PRODUCTO (DENTRO DE LA MISMA SECCIÓN)
    // -------------------------------------------------------------
    function limpiarErroresGuardar() {
        ['nuevo-nombre', 'nuevo-categoria', 'nuevo-existencia', 'nuevo-descripcion'].forEach(id => {
            const input = document.getElementById(id);
            const err = document.getElementById(`err-${id}`);
            if (input) input.classList.remove('input-invalido');
            if (err) {
                err.textContent = '';
                err.style.display = 'none';
            }
        });
    }

    if (formGuardar) {
        formGuardar.addEventListener('submit', (e) => {
            e.preventDefault();
            limpiarErroresGuardar();

            const datos = {
                nombre: document.getElementById('nuevo-nombre').value,
                categoria: document.getElementById('nuevo-categoria').value,
                existencia: document.getElementById('nuevo-existencia').value,
                descripcion: document.getElementById('nuevo-descripcion').value
            };

            const validacion = validarProducto(datos, false);

            if (!validacion.esValido) {
                // Mostrar errores en campos
                if (validacion.errores.nombre) {
                    marcarError('nuevo-nombre', validacion.errores.nombre);
                }
                if (validacion.errores.categoria) {
                    marcarError('nuevo-categoria', validacion.errores.categoria);
                }
                if (validacion.errores.existencia) {
                    marcarError('nuevo-existencia', validacion.errores.existencia);
                }
                if (validacion.errores.descripcion) {
                    marcarError('nuevo-descripcion', validacion.errores.descripcion);
                }
                notificar("Revise los datos del formulario.", "error");
                return;
            }

            // Guardar en la base de datos
            const productos = obtenerProductosBD();
            const nuevoId = generarNuevoId(productos);
            const nuevoItem = {
                id: nuevoId,
                nombre: datos.nombre.trim(),
                categoria: datos.categoria.trim(),
                existencia: parseInt(datos.existencia, 10),
                descripcion: (datos.descripcion || '').trim(),
                fecha_registro: new Date().toISOString().split('T')[0]
            };

            productos.push(nuevoItem);
            guardarProductosBD(productos);

            formGuardar.reset();
            limpiarErroresGuardar();
            renderizarTabla();

            if (alertaExito && mensajeExitoTexto) {
                mensajeExitoTexto.textContent = `¡Producto "${nuevoItem.nombre}" registrado exitosamente con ID #${nuevoId}!`;
                alertaExito.style.display = 'flex';
            }

            notificar(`Producto #${nuevoId} guardado con éxito.`, "exito");
        });
    }

    function marcarError(idInput, mensaje) {
        const input = document.getElementById(idInput);
        const err = document.getElementById(`err-${idInput}`);
        if (input) input.classList.add('input-invalido');
        if (err) {
            err.textContent = mensaje;
            err.style.display = 'block';
        }
    }

    // -------------------------------------------------------------
    // MODIFICAR PRODUCTO (DENTRO DE LA MISMA SECCIÓN)
    // -------------------------------------------------------------
    function abrirModalModificar(id) {
        const productos = obtenerProductosBD();
        const prod = productos.find(p => Number(p.id) === Number(id));
        if (!prod) {
            notificar("No se encontró el producto para modificar.", "error");
            return;
        }

        limpiarErroresModificar();
        document.getElementById('mod-id').value = prod.id;
        document.getElementById('mod-id-badge').textContent = `#${prod.id}`;
        document.getElementById('mod-nombre').value = prod.nombre;
        document.getElementById('mod-categoria').value = prod.categoria;
        document.getElementById('mod-existencia').value = prod.existencia;
        document.getElementById('mod-descripcion').value = prod.descripcion || '';

        if (modalModificar) modalModificar.classList.add('activo');
    }

    function cerrarModalModificar() {
        if (modalModificar) modalModificar.classList.remove('activo');
        limpiarErroresModificar();
    }

    function limpiarErroresModificar() {
        ['mod-nombre', 'mod-categoria', 'mod-existencia', 'mod-descripcion'].forEach(id => {
            const input = document.getElementById(id);
            const err = document.getElementById(`err-${id}`);
            if (input) input.classList.remove('input-invalido');
            if (err) {
                err.textContent = '';
                err.style.display = 'none';
            }
        });
    }

    if (btnCerrarModalMod) btnCerrarModalMod.addEventListener('click', cerrarModalModificar);
    if (btnCancelarModalMod) btnCancelarModalMod.addEventListener('click', cerrarModalModificar);

    if (formModificar) {
        formModificar.addEventListener('submit', (e) => {
            e.preventDefault();
            limpiarErroresModificar();

            const id = Number(document.getElementById('mod-id').value);
            const datos = {
                id: id,
                nombre: document.getElementById('mod-nombre').value,
                categoria: document.getElementById('mod-categoria').value,
                existencia: document.getElementById('mod-existencia').value,
                descripcion: document.getElementById('mod-descripcion').value
            };

            const validacion = validarProducto(datos, true);

            if (!validacion.esValido) {
                if (validacion.errores.nombre) marcarError('mod-nombre', validacion.errores.nombre);
                if (validacion.errores.categoria) marcarError('mod-categoria', validacion.errores.categoria);
                if (validacion.errores.existencia) marcarError('mod-existencia', validacion.errores.existencia);
                if (validacion.errores.descripcion) marcarError('mod-descripcion', validacion.errores.descripcion);
                notificar("Revise los datos modificados.", "error");
                return;
            }

            const productos = obtenerProductosBD();
            const index = productos.findIndex(p => Number(p.id) === id);

            if (index === -1) {
                notificar("El producto no existe.", "error");
                return;
            }

            productos[index] = {
                ...productos[index],
                nombre: datos.nombre.trim(),
                categoria: datos.categoria.trim(),
                existencia: parseInt(datos.existencia, 10),
                descripcion: (datos.descripcion || '').trim(),
                fecha_actualizacion: new Date().toISOString().split('T')[0]
            };

            guardarProductosBD(productos);
            cerrarModalModificar();
            renderizarTabla();
            notificar(`Producto #${id} modificado correctamente.`, "exito");
        });
    }

    // -------------------------------------------------------------
    // ELIMINAR PRODUCTO (DENTRO DE LA MISMA SECCIÓN)
    // -------------------------------------------------------------
    function abrirModalEliminar(id, nombre) {
        productoIdAEliminar = Number(id);
        if (spanDelNombre) spanDelNombre.textContent = nombre;
        if (spanDelId) spanDelId.textContent = `#${id}`;
        if (modalEliminar) modalEliminar.classList.add('activo');
    }

    function cerrarModalEliminar() {
        productoIdAEliminar = null;
        if (modalEliminar) modalEliminar.classList.remove('activo');
    }

    if (btnCerrarModalDel) btnCerrarModalDel.addEventListener('click', cerrarModalEliminar);
    if (btnCancelarModalDel) btnCancelarModalDel.addEventListener('click', cerrarModalEliminar);

    if (btnConfirmarDel) {
        btnConfirmarDel.addEventListener('click', () => {
            if (!productoIdAEliminar) return;

            const productos = obtenerProductosBD();
            const nuevosProductos = productos.filter(p => Number(p.id) !== productoIdAEliminar);
            guardarProductosBD(nuevosProductos);

            cerrarModalEliminar();
            renderizarTabla();
            notificar(`Producto eliminado del inventario.`, "exito");
        });
    }

    // -------------------------------------------------------------
    // FILTROS Y RESTAURAR DEMO
    // -------------------------------------------------------------
    if (inputBuscar) inputBuscar.addEventListener('input', renderizarTabla);
    if (selectCategoria) selectCategoria.addEventListener('change', renderizarTabla);
    if (selectStock) selectStock.addEventListener('change', renderizarTabla);

    if (btnLimpiarFiltros) {
        btnLimpiarFiltros.addEventListener('click', () => {
            if (inputBuscar) inputBuscar.value = '';
            if (selectCategoria) selectCategoria.value = '';
            if (selectStock) selectStock.value = '';
            renderizarTabla();
            notificar("Filtros restablecidos.", "aviso");
        });
    }

    if (btnRestaurarDemo) {
        btnRestaurarDemo.addEventListener('click', () => {
            guardarProductosBD(DATOS_INICIALES);
            renderizarTabla();
            notificar("Catálogo inicial restaurado correctamente.", "exito");
        });
    }

    // -------------------------------------------------------------
    // EXPORTAR A EXCEL
    // -------------------------------------------------------------
    if (btnExportar) {
        btnExportar.addEventListener('click', exportarExcelReporte);
    }

    // Cerrar modales con Escape o clic en fondo
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            cerrarModalModificar();
            cerrarModalEliminar();
        }
    });

    [modalModificar, modalEliminar].forEach(m => {
        if (m) {
            m.addEventListener('click', (e) => {
                if (e.target === m) {
                    cerrarModalModificar();
                    cerrarModalEliminar();
                }
            });
        }
    });

    // Carga inicial
    renderizarTabla();
});

