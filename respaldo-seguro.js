/* Control de Acceso — protección contra pérdida de registros.
   1) pide al navegador que NO borre los datos de la app, 2) barra fija con el estado del respaldo y botón
   "Respaldar ahora" (compartir por WhatsApp / guardar), 3) avisa en rojo si detecta que se borraron registros. */
(function () {
  'use strict';
  var K = 'control_acceso_respaldo_v1';
  var HORAS_AVISO = 4, REGISTROS_AVISO = 8;
  var persistido = null, cuota = null;
  function leer() { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { return {}; } }
  function guardar(o) { try { localStorage.setItem(K, JSON.stringify(o)); } catch (e) { } }
  var st = leer();

  // --- 1) pedir almacenamiento persistente
  if (navigator.storage && navigator.storage.persist) {
    (navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)).then(function (ya) {
      return ya ? true : navigator.storage.persist();
    }).then(function (ok) { persistido = !!ok; pintar(); }).catch(function () { persistido = false; pintar(); });
    if (navigator.storage.estimate) navigator.storage.estimate().then(function (e) { cuota = e && e.quota; pintar(); }).catch(function () { });
  }

  // --- barra fija
  var barra = document.createElement('div');
  barra.id = 'barraRespaldo';
  barra.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:8px 10px;font:600 13px system-ui,sans-serif;display:flex;gap:8px;align-items:center;justify-content:space-between;box-shadow:0 -2px 10px rgba(0,0,0,.35);color:#fff;background:#1f3a5f';
  barra.innerHTML = '<span id="rsTxt" style="flex:1;line-height:1.25"></span><button id="rsBtn" type="button" style="background:#f4a03c;color:#1b1b1b;border:0;border-radius:8px;padding:9px 12px;font:700 13px system-ui,sans-serif;white-space:nowrap">Respaldar ahora</button>';
  function montar() { if (!document.body.contains(barra)) { document.body.appendChild(barra); document.body.style.paddingBottom = '64px'; } }

  function registros() { try { return (typeof ALL_ACCESOS !== 'undefined' && ALL_ACCESOS) || []; } catch (e) { return []; } }
  function marca(r) { return Math.max(Number(r.horaIngreso) || 0, Number(r.horaSalida) || 0); }
  function sinRespaldar() { var t = st.ultimo || 0; return registros().filter(function (r) { return marca(r) > t; }).length; }
  function hace(ts) { if (!ts) return 'nunca'; var m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.floor(m / 60) + ' h' : 'hace ' + Math.floor(m / 1440) + ' d'; }

  function pintar() {
    montar();
    var n = registros().length, pend = sinRespaldar(), alerta = false, msg = '';
    if (st.n > 0 && n < st.n && !st.ignorarPerdida) {
      alerta = true; msg = '⚠️ SE BORRARON REGISTROS de este teléfono (había ' + st.n + ', ahora hay ' + n + '). Avise al supervisor y busque el último respaldo.';
    } else {
      var viejo = !st.ultimo || (Date.now() - st.ultimo) > HORAS_AVISO * 3600e3;
      alerta = n > 0 && (pend >= REGISTROS_AVISO || (viejo && pend > 0));
      msg = (n ? '💾 ' + pend + ' registro(s) sin respaldar · último respaldo ' + hace(st.ultimo) : '💾 Sin registros todavía') + (persistido === false ? ' · ⚠ memoria NO protegida' : '');
    }
    document.getElementById('rsTxt').textContent = msg;
    barra.style.background = alerta ? '#b3261e' : '#1f3a5f';
  }

  // --- 3) respaldo: compartir (WhatsApp/Drive) o guardar
  function nombre() {
    var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }, cuenta = {};
    registros().forEach(function (x) { if (x.campo) cuenta[x.campo] = (cuenta[x.campo] || 0) + 1; });
    var campo = (Object.keys(cuenta).sort(function (a, b) { return cuenta[b] - cuenta[a]; })[0] || 'SIN-CAMPO').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
    return 'control_acceso_' + campo + '_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_resp' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }
  function marcarRespaldo() { st.ultimo = Date.now(); st.n = registros().length; st.ignorarPerdida = false; guardar(st); pintar(); }
  async function respaldar() {
    var datos = registros();
    if (!datos.length) { alert('Aún no hay registros que respaldar.'); return; }
    var file = new File([JSON.stringify(datos, null, 2)], nombre(), { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Respaldo de Control de Acceso', text: 'Respaldo de accesos ' + new Date().toLocaleString('es-MX') }); marcarRespaldo(); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    var url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    marcarRespaldo();
  }
  barra.querySelector('#rsBtn').onclick = respaldar;
  // el botón "Exportar todos" que ya existía también cuenta como respaldo
  document.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('#btnExportarTodo'); if (b) setTimeout(marcarRespaldo, 300); });

  // --- 2) vigilar: recordar cuántos registros hay y detectar borrados
  function vigilar() {
    var n = registros().length;
    if (n >= (st.n || 0) || st.ignorarPerdida) { if (n !== st.n) { st.n = n; guardar(st); } }
    pintar();
  }
  // al detectar pérdida se mantiene el aviso hasta que se haga un respaldo nuevo; el máximo visto se conserva
  window.addEventListener('load', function () { setTimeout(function () { vigilar(); setInterval(vigilar, 20000); }, 1500); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') vigilar(); });
})();
