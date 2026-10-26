/* =====================================================================
   Formato de Inocuidad RE-PL-164
   "Control de entradas y salidas de visitantes" — se llena solo con los
   registros que capturan los guardias en caseta y se entrega cada mes
   al departamento de Inocuidad, en PDF (formato oficial) y en Excel.

   Se carga desde panel.html con:
     <script src="inocuidad/re-pl-164.js"></script>
   y agrega su propia sección al panel. Usa los registros ya importados
   (ALL_ACCESOS). No modifica ningún dato.

   Librerías incluidas en esta misma carpeta (licencia MIT), se cargan solo
   al generar: pdf-lib 1.17.1 (PDF) y JSZip 3.10.1 (Excel).
   ===================================================================== */
(function(){
  'use strict';
  var BASE = new URL('./', document.currentScript.src).href;   // .../inocuidad/
  var ENTREGAS_KEY = 'control_acceso_inocuidad_entregas_v1';
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var FILAS_POR_HOJA = 30;

  // ---------- geometría del PDF oficial (puntos, origen arriba-izquierda como en el formato) ----------
  var PAG_ALTO = 612;
  // Sin la columna FIRMA (no se cuenta con esa información): su ancho se reparte entre NOMBRE, PROCEDENCIA, VISITA A y NO. GAFETE
  var COLS = [21.1, 77.8, 148.7, 318.4, 483.0, 578.9, 630.7, 687.5, 737.0];
  var FILA_Y0 = 125.8, FILA_Y1 = 565.3, FILA_H = (FILA_Y1 - FILA_Y0) / FILAS_POR_HOJA;
  // alineación por columna: c = centrado, i = izquierda
  var ALINEA = ['c','c','i','i','i','c','c','c'];

  /* ================= datos ================= */
  function pad(n){ return String(n).padStart(2,'0'); }
  function fFecha(ts){ var d = new Date(ts); return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear(); }
  function fHora(ts){ var d = new Date(ts); return pad(d.getHours())+':'+pad(d.getMinutes()); }
  function mismoDia(a,b){ var x = new Date(a), y = new Date(b); return x.getFullYear()===y.getFullYear() && x.getMonth()===y.getMonth() && x.getDate()===y.getDate(); }
  function limpio(t){ return String(t==null?'':t).replace(/\s+/g,' ').trim(); }

  function rangoMes(valorMes){ // "2026-10"
    var p = valorMes.split('-'), y = +p[0], m = +p[1]-1;
    return {desde:new Date(y,m,1).getTime(), hasta:new Date(y,m+1,1).getTime(), y:y, m:m,
      texto:'1 al '+new Date(y,m+1,0).getDate()+' de '+MESES[m]+' de '+y, corto:MESES[m]+' '+y};
  }
  function registros(){ try{ return (typeof ALL_ACCESOS!=='undefined' && Array.isArray(ALL_ACCESOS)) ? ALL_ACCESOS : []; }catch(e){ return []; } }
  function camposDisponibles(){
    var s = {}; registros().forEach(function(a){ if(a.campo) s[a.campo] = 1; });
    return Object.keys(s).sort(function(a,b){ return a.localeCompare(b,'es'); });
  }
  function delMes(campo, valorMes){
    var r = rangoMes(valorMes);
    return registros().filter(function(a){ return a.campo===campo && a.horaIngreso>=r.desde && a.horaIngreso<r.hasta; })
      .sort(function(a,b){ return a.horaIngreso-b.horaIngreso; });
  }
  // Una fila del formato por cada registro de caseta
  function fila(a){
    var placas = limpio(a.placas).toUpperCase();
    if(a.numEconomico) placas = (placas ? placas+' / ' : '')+'Unidad '+limpio(a.numEconomico);
    var nombre = limpio(a.nombre);
    if(a.numAcompanantes>0) nombre += ' (+'+a.numAcompanantes+' acomp.)';
    var salida = '';
    if(a.horaSalida){ salida = fHora(a.horaSalida); if(!mismoDia(a.horaIngreso, a.horaSalida)) salida += ' ('+pad(new Date(a.horaSalida).getDate())+'/'+pad(new Date(a.horaSalida).getMonth()+1)+')'; }
    return [fFecha(a.horaIngreso), placas, nombre, limpio(a.empresaProcedencia) || limpio(a.tipoPersona), limpio(a.areaVisita), limpio(a.gafeteNum), fHora(a.horaIngreso), salida];
  }
  // "Campo El Milagro Dos" → "CAMPO EL MILAGRO DOS"; "Empaque" → "CAMPO EMPAQUE"
  function nombreFormato(campo){
    var s = limpio(campo).toUpperCase();
    return /^CAMPO\b/.test(s) ? s : 'CAMPO '+s;
  }
  function nombreArchivo(t){ return String(t).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').toUpperCase(); }

  /* ================= carga de librerías bajo demanda ================= */
  var cargadas = {};
  function cargar(archivo, global){
    if(window[global]) return Promise.resolve();
    if(cargadas[archivo]) return cargadas[archivo];
    cargadas[archivo] = new Promise(function(ok, mal){
      var s = document.createElement('script'); s.src = BASE+archivo;
      s.onload = function(){ ok(); }; s.onerror = function(){ cargadas[archivo] = null; mal(new Error('No se pudo cargar '+archivo+'. Abra el panel una vez con internet.')); };
      document.head.appendChild(s);
    });
    return cargadas[archivo];
  }
  function bajar(url){ return fetch(BASE+url).then(function(r){ if(!r.ok) throw new Error('No se encontró '+url); return r.arrayBuffer(); }); }

  /* ================= PDF sobre el formato oficial ================= */
  async function generarPDF(grupos, mes){
    await cargar('pdf-lib.min.js', 'PDFLib');
    var L = window.PDFLib;
    var plantilla = await L.PDFDocument.load(await bajar('RE-PL-164.pdf'));
    var doc = await L.PDFDocument.create();
    doc.setTitle('RE-PL-164 Control de entradas y salidas de visitantes · '+mes.corto);
    doc.setCreator('Panel de supervisión · Control de acceso');
    var f = await doc.embedFont(L.StandardFonts.Helvetica);
    var fb = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var blanco = L.rgb(1,1,1), negro = L.rgb(0,0,0), gris = L.rgb(.35,.35,.35);

    function seguro(t){ return String(t||'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[–—]/g,'-').replace(/[^\x20-\x7E\xA0-\xFF…]/g,''); }
    function ancho(fuente, t, tam){ return fuente.widthOfTextAtSize(t, tam); }
    function ajusta(fuente, t, max, tam, min){
      while(tam>min && ancho(fuente,t,tam)>max) tam -= 0.25;
      return tam;
    }
    function recorta(fuente, t, max, tam){
      if(ancho(fuente,t,tam)<=max) return t;
      while(t.length>1 && ancho(fuente,t+'…',tam)>max) t = t.slice(0,-1);
      return t.replace(/\s+$/,'')+'…';
    }
    // reparte el texto en dos renglones; devuelve null si no cabe completo
    function dosLineas(fuente, t, max, tam){
      var pal = t.split(' '), a = '', i = 0;
      while(i<pal.length && ancho(fuente,(a?a+' ':'')+pal[i],tam)<=max){ a = (a?a+' ':'')+pal[i]; i++; }
      if(!a || i===pal.length) return null;
      var b = pal.slice(i).join(' ');
      return {lineas:[a, b], completo: ancho(fuente,b,tam)<=max};
    }
    function celda(pag, texto, col, filaIdx){
      texto = seguro(texto); if(!texto) return;
      var x0 = COLS[col]+2.4, x1 = COLS[col+1]-2.4, max = x1-x0;
      var top = FILA_Y0 + filaIdx*FILA_H, centroY = PAG_ALTO - (top + FILA_H/2);
      var tam = ajusta(f, texto, max, 8, 6.5), lineas = [texto];
      if(ancho(f,texto,tam)>max){
        // 1) dos renglones a 6.5 o 6 pt; 2) si aun así no cabe, dos renglones con el segundo recortado
        var r = dosLineas(f, texto, max, 6.5);
        if(r && r.completo){ lineas = r.lineas; tam = 6.5; }
        else { r = dosLineas(f, texto, max, 6); tam = 6;
          if(r){ lineas = [r.lineas[0], recorta(f, r.lineas[1], max, 6)]; }
          else { lineas = [recorta(f, texto, max, 6)]; } }
      }
      var alto = tam*1.0;
      lineas.forEach(function(l, k){
        var y = lineas.length===1 ? centroY - tam*0.35 : (k===0 ? centroY + alto*0.5 - tam*0.35 : centroY - alto*0.5 - tam*0.35) + 0.5;
        var w = ancho(f,l,tam);
        var x = ALINEA[col]==='c' ? x0 + (max-w)/2 : x0;
        pag.drawText(l, {x:x, y:y, size:tam, font:f, color:negro});
      });
    }

    // La plantilla oficial trae impresa la columna FIRMA. Se tapa la zona de columnas NOMBRE…NO. GAFETE
    // (de x=149.18 a 630.7, entre la línea de PLACAS y la de HORA) y se vuelve a dibujar con 3 divisiones nuevas.
    var gris_enc = L.rgb(0.906,0.902,0.902), GR = 0.48;
    var T_TOP = 101.78, T_ENC = 125.78, T_FIN = 565.3 + GR;
    function rectArr(pag, x, yTop, w, h, color){ pag.drawRectangle({x:x, y:PAG_ALTO-yTop-h, width:w, height:h, color:color, borderWidth:0}); }
    function textoEnc(pag, t, cx, cy, tam){ var w = ancho(fb,t,tam); pag.drawText(t, {x:cx-w/2, y:PAG_ALTO-cy-tam*0.35, size:tam, font:fb, color:negro}); }
    function sinFirma(pag){
      var xi = 148.7+GR, xf = 630.7;                       // zona a rehacer
      rectArr(pag, xi, T_TOP, xf-xi, T_FIN-T_TOP, blanco);
      var nuevas = [COLS[3], COLS[4], COLS[5]];            // divisiones verticales nuevas
      var ini = [xi].concat(nuevas.map(function(v){ return v+GR; })), fin = nuevas.concat([xf]);
      for(var k=0;k<4;k++) rectArr(pag, ini[k], T_TOP+GR, fin[k]-ini[k], T_ENC-T_TOP-GR, gris_enc);   // fondo gris del encabezado
      for(var k=0;k<4;k++) rectArr(pag, ini[k], T_TOP, fin[k]-ini[k], GR, negro);                      // línea superior
      var ys = [T_ENC]; for(var i=1;i<=FILAS_POR_HOJA;i++) ys.push(FILA_Y0 + i*FILA_H);              // líneas horizontales
      ys.forEach(function(y){ rectArr(pag, xi, y, xf-xi, GR, negro); });
      nuevas.forEach(function(v){ rectArr(pag, v, T_TOP, GR, T_FIN-T_TOP, negro); });                  // líneas verticales
      var tam = 9, cy = (T_TOP+T_ENC)/2;
      var c2 = (COLS[2]+COLS[3])/2, c3 = (COLS[3]+COLS[4])/2, c4 = (COLS[4]+COLS[5])/2, c5 = (COLS[5]+COLS[6])/2;
      textoEnc(pag, 'NOMBRE DEL PROVEEDOR /', c2, 108.3, tam); textoEnc(pag, 'VISITANTE', c2, 119.8, tam);
      textoEnc(pag, 'PROCEDENCIA', c3, cy, tam);
      textoEnc(pag, 'VISITA A', c4, cy, tam);
      textoEnc(pag, 'NO.', c5, 108.3, tam); textoEnc(pag, 'GAFETE', c5, 119.8, tam);
    }

    for(var g=0; g<grupos.length; g++){
      var gr = grupos[g], filas = gr.registros.map(fila);
      var hojas = Math.max(1, Math.ceil(filas.length/FILAS_POR_HOJA));
      var titulo = seguro('CONTROL DE ENTRADAS Y SALIDAS DE VISITANTES '+gr.titulo);
      for(var h=0; h<hojas; h++){
        var copia = await doc.copyPages(plantilla, [0]);
        var pag = doc.addPage(copia[0]);
        sinFirma(pag);
        // título con el campo correspondiente
        pag.drawRectangle({x:167.7, y:PAG_ALTO-78.4, width:460.3, height:20.4, color:blanco});
        var tt = ajusta(fb, titulo, 436, 12, 7);
        pag.drawText(titulo, {x:397.85 - ancho(fb,titulo,tt)/2, y:PAG_ALTO-72.6, size:tt, font:fb, color:negro});
        // número de página
        pag.drawRectangle({x:633.5, y:PAG_ALTO-78.4, width:88.4, height:10.6, color:blanco});
        pag.drawText('PAGINA: '+(h+1)+' de '+hojas, {x:634.5, y:PAG_ALTO-75.6, size:8.6, font:f, color:negro});
        // renglones
        var parte = filas.slice(h*FILAS_POR_HOJA, (h+1)*FILAS_POR_HOJA);
        parte.forEach(function(vals, i){ vals.forEach(function(v, c){ celda(pag, v, c, i); }); });
        if(!filas.length) celda(pag, 'Sin registros de visitantes en el periodo', 2, 0);
        pag.drawText(seguro('Periodo: '+mes.texto+' · '+filas.length+' registro(s) · Generado desde el panel de control de acceso el '+fFecha(Date.now())),
          {x:COLS[0], y:PAG_ALTO-578, size:6.5, font:f, color:gris});
      }
    }
    return await doc.save();
  }

  /* ================= Excel (.xlsx) con el mismo encabezado ================= */
  function x(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,''); }
  var LETRAS = 'ABCDEFGH';
  function ref(c, r){ return LETRAS[c]+r; }

  function hojaXML(gr, mes, idx){
    var filas = gr.registros.map(fila);
    var rows = [], merges = [];
    function celdaTxt(c, r, v, s){ return '<c r="'+ref(c,r)+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+x(v)+'</t></is></c>'; }
    function celdaRica(c, r, partes, s){
      return '<c r="'+ref(c,r)+'" s="'+s+'" t="inlineStr"><is>'+partes.map(function(p){
        return '<r><rPr>'+(p.b?'<b/>':'')+'<sz val="9"/><rFont val="Arial"/></rPr><t xml:space="preserve">'+x(p.t)+'</t></r>'; }).join('')+'</is></c>';
    }
    function celdaVacia(c, r, s){ return '<c r="'+ref(c,r)+'" s="'+s+'"/>'; }
    function fila_(r, alto, celdas){ rows.push('<row r="'+r+'" ht="'+alto+'" customHeight="1">'+celdas.join('')+'</row>'); }

    // 1–3: logo | REGISTRO / título | código
    fila_(1, 20, [celdaVacia(0,1,9), celdaVacia(1,1,9), celdaTxt(2,1,'REGISTRO',4), celdaVacia(3,1,4), celdaVacia(4,1,4), celdaVacia(5,1,4),
      celdaTxt(6,1,'CODIGO: RE-PL-164\nVERSIÓN: 0\nEFECTIVIDAD: 12/11/15',6), celdaVacia(7,1,6)]);
    fila_(2, 18, [celdaVacia(0,2,9), celdaVacia(1,2,9), celdaTxt(2,2,'CONTROL DE ENTRADAS Y SALIDAS DE VISITANTES '+gr.titulo,5), celdaVacia(3,2,5), celdaVacia(4,2,5), celdaVacia(5,2,5), celdaVacia(6,2,6), celdaVacia(7,2,6)]);
    fila_(3, 18, [celdaVacia(0,3,9), celdaVacia(1,3,9), celdaVacia(2,3,5), celdaVacia(3,3,5), celdaVacia(4,3,5), celdaVacia(5,3,5), celdaVacia(6,3,6), celdaVacia(7,3,6)]);
    merges.push('A1:B3','C1:F1','C2:F3','G1:H3');
    fila_(4, 13, [celdaRica(0,4,[{t:'Reg. Senasica: ',b:true},{t:'UP2022001759; UP2022001760; UP2022001761.'}],7)]);
    merges.push('A4:H4');
    fila_(5, 25, [celdaRica(0,5,[{t:'Nota: Toda persona externa que ingresa a '},{t:'RANCHO LA MEMORIA S. de R.L. de C.V.',b:true},{t:' Está obligado a cumplir con el Reglamento y Política de Inocuidad, Seguridad y Bioseguridad.'}],8)]);
    merges.push('A5:H5');
    var enc = ['FECHA','PLACAS','NOMBRE DEL PROVEEDOR / VISITANTE','PROCEDENCIA','VISITA A','NO. GAFETE','HORA',''];
    fila_(6, 15, enc.map(function(t,c){ return t ? celdaTxt(c,6,t,1) : celdaVacia(c,6,1); }));
    fila_(7, 15, enc.map(function(t,c){ return c===6 ? celdaTxt(6,7,'ENTRADA',1) : (c===7 ? celdaTxt(7,7,'SALIDA',1) : celdaVacia(c,7,1)); }));
    merges.push('A6:A7','B6:B7','C6:C7','D6:D7','E6:E7','F6:F7','G6:H6');
    // renglones (mínimo 30, como el formato)
    var anchos = [10.3, 12.8, 31.3, 29.3, 16.8, 9.8, 10.3, 9.2];
    // alto de cada renglón según cuántas líneas ocupa su texto más largo (Arial 9)
    function altoFila(v){
      if(!v) return 18;
      var lineas = 1;
      v.forEach(function(t, c){ if(!t) return; var porLinea = Math.max(4, Math.floor(anchos[c]*1.15)); lineas = Math.max(lineas, Math.ceil(String(t).length*1.08/porLinea)); });
      return Math.max(18, lineas*11.5+4);
    }
    var total = Math.max(FILAS_POR_HOJA, filas.length);
    for(var i=0;i<total;i++){
      var r = 8+i, v = filas[i];
      fila_(r, altoFila(v), LETRAS.split('').map(function(_, c){
        var s = ALINEA[c]==='c' ? 2 : 3;
        return v && v[c] ? celdaTxt(c, r, v[c], s) : celdaVacia(c, r, s);
      }));
    }
    if(!filas.length){ rows[7] = '<row r="8" ht="18" customHeight="1">'+celdaTxt(0,8,'SIN REGISTROS DE VISITANTES EN EL PERIODO',10)+'</row>'; merges.push('A8:H8'); }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'+
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"'+(idx===0?' tabSelected="1"':'')+'><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="15"/>'+
      '<cols>'+anchos.map(function(w,c){ return '<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+w+'" customWidth="1"/>'; }).join('')+'</cols>'+
      '<sheetData>'+rows.join('')+'</sheetData>'+
      '<mergeCells count="'+merges.length+'">'+merges.map(function(m){ return '<mergeCell ref="'+m+'"/>'; }).join('')+'</mergeCells>'+
      '<printOptions horizontalCentered="1"/>'+
      '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.5" header="0.2" footer="0.25"/>'+
      '<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
      '<headerFooter><oddFooter>'+x('&L&7Periodo: '+mes.texto+' · '+filas.length+' registro(s)&R&8PAGINA: &P de &N')+'</oddFooter></headerFooter>'+
      '<drawing r:id="rId1"/>'+
      '</worksheet>';
  }
  function estilosXML(){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<fonts count="6">'+
      '<font><sz val="10"/><name val="Arial"/></font>'+
      '<font><b/><sz val="10"/><name val="Arial"/></font>'+
      '<font><b/><sz val="14"/><name val="Arial"/></font>'+
      '<font><b/><sz val="12"/><name val="Arial"/></font>'+
      '<font><sz val="9"/><name val="Arial"/></font>'+
      '<font><b/><sz val="9"/><color rgb="FF595959"/><name val="Arial"/></font>'+
    '</fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'+
      '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="11">'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+                                                                                           // 0
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+ // 1 encabezado
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+ // 2 dato centrado
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+ // 3 dato izquierda
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+ // 4 REGISTRO
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+ // 5 título
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+ // 6 código
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'+ // 7 senasica
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+ // 8 nota
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'+ // 9 celda del logo
      '<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+ // 10 sin registros
    '</cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '</styleSheet>';
  }
  function dibujoXML(){
    // logo dentro de A1:B3 (159 × 72 px, reducido para caber)
    var emu = 9525, w = Math.round(146*emu), h = Math.round(66*emu);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>140000</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>40000</xdr:rowOff></xdr:from>'+
    '<xdr:ext cx="'+w+'" cy="'+h+'"/>'+
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'+
    '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'+
    '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>'+
    '<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
  }
  function nombreHoja(t, usados){
    var n = String(t).replace(/[\[\]:*?\/\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,31) || 'Campo';
    var b = n, k = 2; while(usados[n.toLowerCase()]){ n = b.slice(0,28)+' '+k++; } usados[n.toLowerCase()] = 1; return n;
  }
  async function generarXLSX(grupos, mes){
    await cargar('jszip.min.js', 'JSZip');
    var zip = new window.JSZip();
    var logo = await bajar('logo.png');
    var usados = {}, hojas = grupos.map(function(g){ return nombreHoja(g.campo, usados); });
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'+
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'+
      hojas.map(function(_,i){ return '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
        '<Override PartName="/xl/drawings/drawing'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'; }).join('')+
      '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'+
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    var ahora = new Date().toISOString().replace(/\.\d+Z$/,'Z');
    zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'+
      '<dc:title>'+x('RE-PL-164 Control de entradas y salidas de visitantes · '+mes.corto)+'</dc:title><dc:creator>Panel de control de acceso</dc:creator>'+
      '<dcterms:created xsi:type="dcterms:W3CDTF">'+ahora+'</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">'+ahora+'</dcterms:modified></cp:coreProperties>');
    zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'+hojas.map(function(n,i){ return '<sheet name="'+x(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>'; }).join('')+'</sheets>'+
      '<definedNames>'+hojas.map(function(n,i){ return '<definedName name="_xlnm.Print_Titles" localSheetId="'+i+'">\''+x(n.replace(/'/g,"''"))+'\'!$1:$7</definedName>'; }).join('')+'</definedNames></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      hojas.map(function(_,i){ return '<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>'; }).join('')+
      '<Relationship Id="rId'+(hojas.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file('xl/styles.xml', estilosXML());
    zip.file('xl/media/logo.png', logo);
    grupos.forEach(function(g, i){
      zip.file('xl/worksheets/sheet'+(i+1)+'.xml', hojaXML(g, mes, i));
      zip.file('xl/worksheets/_rels/sheet'+(i+1)+'.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing'+(i+1)+'.xml"/></Relationships>');
      zip.file('xl/drawings/drawing'+(i+1)+'.xml', dibujoXML());
      zip.file('xl/drawings/_rels/drawing'+(i+1)+'.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>');
    });
    return await zip.generateAsync({type:'uint8array', compression:'DEFLATE', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  /* ================= sección en el panel ================= */
  function descargar(bytes, nombre, tipo){
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type:tipo}));
    a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  }
  function leerLS(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function guardarLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function mesValor(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1); }
  function mesPorDefecto(){ var h = new Date(); return h.getDate()<=10 ? mesValor(new Date(h.getFullYear(), h.getMonth()-1, 1)) : mesValor(h); }

  function montar(){
    var ancla = document.getElementById('panelReporteProgramado');
    if(!ancla || document.getElementById('panelInocuidad')) return;
    var st = document.createElement('style');
    st.textContent =
      '#panelInocuidad .inoc-grid{display:grid;grid-template-columns:minmax(170px,1.2fr) minmax(140px,.8fr) minmax(220px,1.6fr);gap:12px;align-items:end;}'+
      '@media (max-width:760px){#panelInocuidad .inoc-grid{grid-template-columns:1fr;}}'+
      '#panelInocuidad input,#panelInocuidad select{width:100%;}'+
      '#panelInocuidad .inoc-info{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 4px;font-size:12.5px;color:var(--muted);}'+
      '#panelInocuidad .inoc-info b{color:var(--text);}'+
      '#panelInocuidad .inoc-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;}'+
      '#panelInocuidad .inoc-tabla{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;}'+
      '#panelInocuidad .inoc-tabla th,#panelInocuidad .inoc-tabla td{padding:6px 8px;border-bottom:1px solid var(--border-soft);text-align:left;}'+
      '#panelInocuidad .inoc-tabla th{color:var(--muted);font-weight:600;}'+
      '#panelInocuidad .inoc-tabla td.n,#panelInocuidad .inoc-tabla th.n{text-align:right;font-variant-numeric:tabular-nums;}'+
      '#panelInocuidad .inoc-ok{color:var(--verde);} #panelInocuidad .inoc-pend{color:var(--amarillo);}'+
      '#panelInocuidad .inoc-aviso{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;margin-bottom:12px;border-radius:9px;background:var(--amarillo-soft);border:1px solid rgba(227,179,65,.4);}'+
      '#panelInocuidad .inoc-aviso b{color:var(--amarillo);} #panelInocuidad .inoc-aviso .sp{flex:1;}'+
      '#btnInocMensual{background:#2E7D5B;border-color:#2E7D5B;}';
    document.head.appendChild(st);
    var p = document.createElement('div');
    p.className = 'panel'; p.id = 'panelInocuidad'; p.style.marginBottom = '14px';
    p.innerHTML =
      '<h2>🧾 Formato para Inocuidad · RE-PL-164</h2>'+
      '<div id="inocAviso"></div>'+
      '<div class="desc">Control de entradas y salidas de visitantes. Se llena solo con lo que capturan los guardias en caseta (una hoja por campo, 30 renglones por página) para entregarlo cada mes al departamento de Inocuidad.</div>'+
      '<div class="inoc-grid">'+
        '<div class="field"><label for="inocCampo">Campo</label><select id="inocCampo"></select></div>'+
        '<div class="field"><label for="inocMes">Mes</label><input type="month" id="inocMes"></div>'+
        '<div class="field"><label for="inocTitulo">Como aparece en el formato</label><input type="text" id="inocTitulo" placeholder="CAMPO EL MILAGRO DOS"></div>'+
      '</div>'+
      '<div class="inoc-info" id="inocInfo"></div>'+
      '<div class="inoc-btns">'+
        '<button type="button" class="btn-primary" id="btnInocPDF">📄 Descargar PDF (formato oficial)</button>'+
        '<button type="button" class="btn-secondary" id="btnInocXLSX">📊 Descargar Excel</button>'+
      '</div>'+
      '<div class="form-msg" id="inocMsg"></div>'+
      '<div id="inocResumen"></div>';
    ancla.parentNode.insertBefore(p, ancla);

    var $c = document.getElementById('inocCampo'), $m = document.getElementById('inocMes'), $t = document.getElementById('inocTitulo');
    $m.value = mesPorDefecto();
    var tituloEditado = {};

    // Botón principal (junto a "Generar reporte ejecutivo"): genera con un clic el formato mensual de todos los campos
    var btnEjec = document.getElementById('btnReporteEjecutivo'), btnMes = null;
    if(btnEjec && btnEjec.parentNode){
      btnMes = document.createElement('button'); btnMes.type = 'button'; btnMes.className = 'btn-primary'; btnMes.id = 'btnInocMensual';
      btnMes.title = 'Formato RE-PL-164 de Inocuidad del mes, con todos los campos (una hoja por campo)';
      btnEjec.parentNode.style.gap = '10px'; btnEjec.parentNode.style.flexWrap = 'wrap';
      btnEjec.parentNode.insertBefore(btnMes, btnEjec);
      btnMes.addEventListener('click', function(){ generarMes($m.value); });
    }
    function mesAnterior(){ var h = new Date(); return mesValor(new Date(h.getFullYear(), h.getMonth()-1, 1)); }
    function etiquetaBoton(){ if(btnMes) btnMes.textContent = '🧾 Formato mensual Inocuidad · '+($m.value ? rangoMes($m.value).corto : '—'); }
    // genera el PDF oficial del mes indicado con todos los campos que tienen registros
    function generarMes(valorMes){
      if(valorMes) $m.value = valorMes;
      var cs = camposDisponibles();
      if(cs.length>1) $c.value = '__TODOS__'; else if(cs.length===1) $c.value = cs[0];
      actualizar();
      document.getElementById('panelInocuidad').scrollIntoView({behavior:'smooth', block:'start'});
      ejecutar('pdf');
    }
    function pintarAviso(){
      var cont = document.getElementById('inocAviso'), ma = mesAnterior(), cs = camposDisponibles();
      var conDatos = cs.filter(function(c){ return delMes(c, ma).length; });
      var ent = leerLS(ENTREGAS_KEY, {})[ma] || {};
      var faltan = conDatos.filter(function(c){ return !ent[c]; });
      if(!faltan.length){ cont.innerHTML = ''; return; }
      cont.innerHTML = '<div class="inoc-aviso"><div>🗓️ Ya terminó <b>'+x(rangoMes(ma).corto)+'</b>: falta generar el formato de '+faltan.length+' campo(s) para entregarlo a Inocuidad.</div><span class="sp"></span>'+
        '<button type="button" class="btn-primary" id="btnInocAviso">Generar formato de '+x(MESES[rangoMes(ma).m])+' (PDF)</button></div>';
      document.getElementById('btnInocAviso').addEventListener('click', function(){ generarMes(ma); });
    }

    function llenarCampos(){
      var cs = camposDisponibles(), actual = $c.value;
      $c.innerHTML = cs.map(function(c){ return '<option value="'+x(c)+'">'+x(c)+'</option>'; }).join('')+
        (cs.length>1 ? '<option value="__TODOS__">Todos los campos (cada uno en sus hojas)</option>' : '');
      if(!cs.length) $c.innerHTML = '<option value="">— Importe registros primero —</option>';
      if(actual && Array.prototype.some.call($c.options, function(o){ return o.value===actual; })) $c.value = actual;
    }
    function grupos(){
      var mes = $m.value; if(!mes) return [];
      var cs = $c.value==='__TODOS__' ? camposDisponibles() : ($c.value ? [$c.value] : []);
      return cs.map(function(c){
        return {campo:c, titulo:limpio($c.value==='__TODOS__' ? (tituloEditado[c] || nombreFormato(c)) : ($t.value || nombreFormato(c))).toUpperCase(), registros:delMes(c, mes)};
      });
    }
    function actualizar(){
      var todos = $c.value==='__TODOS__';
      $t.disabled = todos || !$c.value;
      if(!todos && $c.value) $t.value = tituloEditado[$c.value] || nombreFormato($c.value);
      if(todos) $t.value = '';
      var gs = grupos(), mes = $m.value ? rangoMes($m.value) : null;
      var n = gs.reduce(function(s,g){ return s+g.registros.length; }, 0);
      var hojas = gs.reduce(function(s,g){ return s+Math.max(1, Math.ceil(g.registros.length/FILAS_POR_HOJA)); }, 0);
      var sinSalida = gs.reduce(function(s,g){ return s+g.registros.filter(function(a){ return !a.horaSalida; }).length; }, 0);
      document.getElementById('inocInfo').innerHTML = mes ?
        '<span>Periodo: <b>'+mes.texto+'</b></span><span>· <b>'+n+'</b> registro(s)</span><span>· <b>'+hojas+'</b> hoja(s) de formato</span>'+
        (sinSalida ? '<span class="inoc-pend">· '+sinSalida+' sin hora de salida</span>' : '') : '';
      document.getElementById('btnInocPDF').disabled = !gs.length;
      document.getElementById('btnInocXLSX').disabled = !gs.length;
      etiquetaBoton(); pintarAviso();
      if(btnMes) btnMes.disabled = !camposDisponibles().length;
      // resumen de entregas del mes por campo
      var ent = leerLS(ENTREGAS_KEY, {})[$m.value] || {};
      var cs = camposDisponibles();
      document.getElementById('inocResumen').innerHTML = (mes && cs.length) ?
        '<table class="inoc-tabla"><thead><tr><th>Campo</th><th class="n">Registros en '+x(mes.corto)+'</th><th>Formato generado</th></tr></thead><tbody>'+
        cs.map(function(c){ var k = delMes(c, $m.value).length, e = ent[c];
          return '<tr><td>'+x(c)+'</td><td class="n">'+k+'</td><td>'+(e ? '<span class="inoc-ok">✔ '+new Date(e).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+'</span>' : '<span class="inoc-pend">pendiente</span>')+'</td></tr>'; }).join('')+
        '</tbody></table>' : '';
    }
    function marcarEntregado(gs){
      var e = leerLS(ENTREGAS_KEY, {}); e[$m.value] = e[$m.value] || {};
      gs.forEach(function(g){ e[$m.value][g.campo] = Date.now(); }); guardarLS(ENTREGAS_KEY, e);
    }
    function nombreBase(gs){
      return 'RE-PL-164_Control_Entradas_Salidas_'+(gs.length===1 ? nombreArchivo(gs[0].titulo) : 'TODOS_LOS_CAMPOS')+'_'+$m.value;
    }
    async function ejecutar(tipo){
      var msg = document.getElementById('inocMsg'), gs = grupos();
      if(!gs.length){ msg.className = 'form-msg err'; msg.textContent = 'Elija un campo y un mes.'; return; }
      var btn = document.getElementById(tipo==='pdf' ? 'btnInocPDF' : 'btnInocXLSX'), txt = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ Generando…'; msg.className = 'form-msg'; msg.textContent = '';
      try{
        var mes = rangoMes($m.value);
        if(tipo==='pdf') descargar(await generarPDF(gs, mes), nombreBase(gs)+'.pdf', 'application/pdf');
        else descargar(await generarXLSX(gs, mes), nombreBase(gs)+'.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        marcarEntregado(gs);
        var n = gs.reduce(function(s,g){ return s+g.registros.length; }, 0);
        msg.className = 'form-msg ok'; msg.textContent = 'Listo: '+(tipo==='pdf'?'PDF':'Excel')+' con '+n+' registro(s) de '+gs.length+' campo(s).';
      }catch(err){
        console.error(err); msg.className = 'form-msg err'; msg.textContent = 'No se pudo generar: '+(err && err.message || err);
      }finally{ btn.disabled = false; btn.textContent = txt; actualizar(); }
    }
    function limpiarMsg(){ var m = document.getElementById('inocMsg'); m.className = 'form-msg'; m.textContent = ''; }
    $c.addEventListener('change', function(){ limpiarMsg(); actualizar(); });
    $m.addEventListener('change', function(){ limpiarMsg(); actualizar(); });
    $t.addEventListener('input', function(){ if($c.value && $c.value!=='__TODOS__') tituloEditado[$c.value] = $t.value; });
    document.getElementById('btnInocPDF').addEventListener('click', function(){ ejecutar('pdf'); });
    document.getElementById('btnInocXLSX').addEventListener('click', function(){ ejecutar('xlsx'); });

    // se actualiza solo cuando el panel importa registros nuevos (el filtro de campos se regenera)
    var fc = document.getElementById('fCampo');
    var refrescar = function(){ llenarCampos(); actualizar(); };
    if(fc) new MutationObserver(refrescar).observe(fc, {childList:true});
    refrescar();
  }

  window.InocuidadREPL164 = {fila:fila, nombreFormato:nombreFormato, generarPDF:generarPDF, generarXLSX:generarXLSX, rangoMes:rangoMes};
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
