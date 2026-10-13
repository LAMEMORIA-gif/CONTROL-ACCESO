// qr-acceso.js — funciones compartidas del sistema de QR de Control de Acceso
// (panel.html crea invitaciones/pases, visita.html genera el QR del visitante, index.html lo verifica en caseta).
// Formato del código:  LMACC1.<invitación>.<firma>[.<datos del visitante>]
//   - <invitación> = JSON en base64url, firmado con HMAC-SHA256 usando la clave compartida (panel ↔ casetas)
//   - <firma>      = primeros 16 bytes del HMAC, en base64url
//   - <datos del visitante> = JSON en base64url que llena el visitante (no firmado; el guardia lo confirma con la identificación)
// Código de configuración de caseta:  LMACCKEY.<clave>
(function(global){
  'use strict';
  const PREFIJO = 'LMACC1';
  const PREFIJO_CLAVE = 'LMACCKEY';
  const CLAVE_STORAGE = 'control_acceso_qr_clave_v1';

  function utf8Bytes(str){ return new TextEncoder().encode(str); }
  function b64urlFromBytes(bytes){
    let bin = '';
    for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function bytesFromB64url(s){
    s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
    while(s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function encodeObj(obj){
    // quita campos vacíos para que el QR sea lo más pequeño posible
    const limpio = {};
    Object.keys(obj).forEach(k=>{ const v = obj[k]; if(v!==undefined && v!==null && v!=='' ) limpio[k]=v; });
    return b64urlFromBytes(utf8Bytes(JSON.stringify(limpio)));
  }
  function decodeObj(s){ return JSON.parse(new TextDecoder().decode(bytesFromB64url(s))); }

  async function firmar(clave, texto){
    if(!global.crypto || !global.crypto.subtle) throw new Error('Este navegador no permite firmar (se requiere https).');
    const key = await crypto.subtle.importKey('raw', utf8Bytes(clave), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8Bytes(PREFIJO+'.'+texto)));
    return b64urlFromBytes(sig.slice(0,16));
  }
  async function verificarFirma(clave, texto, firma){
    const esperada = await firmar(clave, texto);
    if(esperada.length !== firma.length) return false;
    let dif = 0;
    for(let i=0;i<esperada.length;i++) dif |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
    return dif === 0;
  }

  // Crea la invitación firmada. Devuelve {inv, sig, base} donde base = "<inv>.<sig>"
  async function crearInvitacion(clave, datos){
    const inv = encodeObj(datos);
    const sig = await firmar(clave, inv);
    return {inv, sig, base: inv+'.'+sig};
  }
  function codigoCompleto(base, visitante){
    return PREFIJO+'.'+base+(visitante ? '.'+encodeObj(visitante) : '');
  }
  // Separa un código escaneado sin verificarlo
  function parsearCodigo(texto){
    texto = String(texto||'').trim();
    if(texto.indexOf(PREFIJO_CLAVE+'.')===0) return {tipo:'clave', clave: texto.slice(PREFIJO_CLAVE.length+1)};
    const partes = texto.split('.');
    if(partes[0]!==PREFIJO || partes.length<3) return {tipo:'desconocido'};
    let invitacion = null, visitante = null;
    try{ invitacion = decodeObj(partes[1]); }catch(e){ return {tipo:'desconocido'}; }
    if(partes[3]){ try{ visitante = decodeObj(partes[3]); }catch(e){ visitante = null; } }
    return {tipo:'visita', inv: partes[1], sig: partes[2], invitacion, visitante};
  }
  // Base "<inv>.<sig>" a partir de un enlace o texto
  function parsearBase(texto){
    const partes = String(texto||'').trim().split('.');
    if(partes.length<2) return null;
    try{ return {inv: partes[0], sig: partes[1], invitacion: decodeObj(partes[0])}; }catch(e){ return null; }
  }

  function leerClave(){ try{ return localStorage.getItem(CLAVE_STORAGE)||''; }catch(e){ return ''; } }
  function guardarClave(c){ try{ localStorage.setItem(CLAVE_STORAGE, c); return true; }catch(e){ return false; } }
  function claveNueva(){
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    return b64urlFromBytes(b);
  }
  function codigoClave(clave){ return PREFIJO_CLAVE+'.'+clave; }

  // Normaliza nombres de campo para comparar ("Campo Palomas" = "campo palomas" = "CAMPO PALOMAS ")
  function normaliza(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toLowerCase(); }

  // Fecha local "YYYY-MM-DD" y minutos desde medianoche
  function hoyISO(d){ d = d||new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function minutosDe(hhmm){ if(!hhmm) return null; const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? (parseInt(m[1],10)*60+parseInt(m[2],10)) : null; }
  const DIAS = ['','Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  function diaSemana(d){ const x = (d||new Date()).getDay(); return x===0 ? 7 : x; } // 1=Lun … 7=Dom
  function textoDias(dw){ if(!dw || dw==='1234567') return 'Todos los días'; return dw.split('').map(n=>DIAS[+n]).join(', '); }
  function fechaLarga(iso){
    if(!iso) return '—';
    const [y,m,d] = iso.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('es-MX',{weekday:'long', day:'numeric', month:'long', year:'numeric'});
  }

  // Revisa vigencia, día, horario y campo. Devuelve lista de problemas (texto) — vacía si todo bien.
  function revisarVigencia(inv, campoCaseta, ahora){
    ahora = ahora || new Date();
    const problemas = [];
    const hoy = hoyISO(ahora);
    if(inv.t==='U'){
      if(inv.f && inv.f!==hoy) problemas.push('La visita está agendada para el '+fechaLarga(inv.f)+', no para hoy.');
    } else {
      if(inv.fi && hoy < inv.fi) problemas.push('El pase empieza a valer el '+fechaLarga(inv.fi)+'.');
      if(inv.ff && hoy > inv.ff) problemas.push('El pase venció el '+fechaLarga(inv.ff)+'.');
      if(inv.dw && inv.dw.indexOf(String(diaSemana(ahora)))===-1) problemas.push('Hoy no es un día permitido ('+textoDias(inv.dw)+').');
    }
    const mi = minutosDe(inv.hi), mf = minutosDe(inv.hf);
    const ahoraMin = ahora.getHours()*60 + ahora.getMinutes();
    if(mi!==null && ahoraMin < mi) problemas.push('Llega antes del horario permitido ('+inv.hi+(inv.hf?'–'+inv.hf:'')+').');
    if(mf!==null && ahoraMin > mf) problemas.push('Llega después del horario permitido ('+(inv.hi?inv.hi+'–':'')+inv.hf+').');
    if(inv.c && campoCaseta && normaliza(inv.c)!==normaliza(campoCaseta)) problemas.push('La invitación es para "'+inv.c+'", no para esta caseta ("'+campoCaseta+'").');
    return problemas;
  }

  // Dibuja un QR en un <canvas> (requiere qrcode.js). Devuelve el canvas.
  function dibujarQR(canvas, texto, tamano){
    if(typeof qrcode !== 'function') throw new Error('No se cargó la librería de QR.');
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const margen = 4;
    tamano = tamano || 360;
    const celda = Math.max(2, Math.floor(tamano/(n+margen*2)));
    const lado = celda*(n+margen*2);
    canvas.width = lado; canvas.height = lado;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,lado,lado);
    ctx.fillStyle = '#000000';
    for(let r=0;r<n;r++) for(let c=0;c<n;c++){ if(qr.isDark(r,c)) ctx.fillRect((c+margen)*celda,(r+margen)*celda,celda,celda); }
    return canvas;
  }
  // Imagen PNG del QR con encabezado de texto (para descargar o compartir)
  function imagenQRConTexto(texto, lineas){
    const qrCanvas = dibujarQR(document.createElement('canvas'), texto, 520);
    const ancho = Math.max(qrCanvas.width, 560);
    const alto = qrCanvas.height + 40 + (lineas||[]).length*30 + 20;
    const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,ancho,alto);
    ctx.fillStyle = '#10141b'; ctx.textAlign = 'center';
    let y = 34;
    (lineas||[]).forEach((l,i)=>{ ctx.font = (i===0?'bold 24px':'18px')+' system-ui, sans-serif'; ctx.fillText(String(l).slice(0,48), ancho/2, y); y += 30; });
    ctx.drawImage(qrCanvas, (ancho-qrCanvas.width)/2, y);
    return c.toDataURL('image/png');
  }

  function esc(t){ return String(t==null?'':t).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

  global.QRAcceso = {
    PREFIJO, PREFIJO_CLAVE, CLAVE_STORAGE,
    encodeObj, decodeObj, firmar, verificarFirma, crearInvitacion, codigoCompleto,
    parsearCodigo, parsearBase, leerClave, guardarClave, claveNueva, codigoClave,
    normaliza, hoyISO, minutosDe, diaSemana, textoDias, fechaLarga, revisarVigencia,
    dibujarQR, imagenQRConTexto, esc
  };
})(window);
