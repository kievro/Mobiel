/* foto.js — één foto bij een notitie (Overdracht) of een melding/afwijking (Voertuigcontrole).
 *
 * Wat het doet
 *   - De foto wordt EERST op het toestel verkleind (langste zijde max. 1600 px, JPEG, meestal 150–400 KB, nooit boven ca. 700 KB).
 *     Zo kost een foto weinig mobiele data en weinig opslag. Het opnieuw opbouwen van het plaatje haalt ook de verborgen
 *     gegevens uit het bestand (locatie/GPS, tijdstip, type telefoon).
 *   - De foto komt in de privé-opslagruimte 'melding-fotos'. Alleen ingelogde gebruikers zien hem, via een tijdelijke link.
 *   - De database bewaart alleen het pad (kolom foto_pad). Een nachtelijke taak (ruim-fotos-op) verwijdert de foto 30 dagen
 *     nadat de melding is afgehandeld; de tekst blijft staan.
 *
 * Gebruik
 *   Foto.stijl();                                          // eenmalig, zet de opmaak (gebeurt ook vanzelf)
 *   var veld = Foto.veld(element, { client: supa, pad: 'ovd/xxx.jpg' | null });   // bouwt de knop + waarschuwing in 'element'
 *   var r = await veld.klaar(supa, 'ovd');                 // verkleint/uploadt indien nodig → { pad, oud }
 *      // sla de rij op met foto_pad = r.pad; daarna: Foto.verwijder(supa, r.oud)   (oud = vervangen/verwijderde foto of null)
 *   veld.heeftKeuze()                                      // true als de gebruiker iets met de foto heeft gedaan
 *   Foto.minHtml(pad)                                      // knopje "📷 Foto" voor in een kaart (leeg als er geen foto is)
 *   Foto.koppel(supa, rootElement)                         // eenmalig: klikken op zo'n knopje opent de foto groot
 *   Foto.toon(supa, pad)                                   // foto direct groot tonen
 */
(function () {
  var BUCKET = 'melding-fotos';
  var MAX_ZIJDE = 1600;          // pixels, langste zijde
  var DOEL_BYTES = 450 * 1024;   // streefgrootte
  var MAX_BYTES = 700 * 1024;    // daar blijft het hoe dan ook onder (de opslagruimte staat op 2 MB)
  var WAARSCHUWING = 'Maak en kies geen foto’s waarop personen herkenbaar zijn, en geen foto’s met medische of persoonlijke gegevens ' +
    '(patiënt, kenteken van burgers, papieren, schermen). Alleen materiaal, voertuig of schade. ' +
    'De foto wordt 30 dagen nadat de melding is afgehandeld automatisch verwijderd.';

  var KORT = 'Geen personen of medische/persoonlijke gegevens op de foto. Wordt 30 dagen na afhandelen verwijderd.';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nieuwId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  var CSS =
    '.foto-veld{margin:10px 0 4px;}' +
    '.foto-rij{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
    '.foto-knop,.foto-weg,.foto-bekijk{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--border,#2f3640);background:var(--surface-2,#232830);' +
    'color:var(--text,#fff);font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '.foto-weg{color:var(--danger,#ff6b6b);font-weight:500;}' +
    '.foto-info{font-size:13px;color:var(--text-dim,#9aa4b2);}' +
    '.foto-voorbeeld{margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}' +
    '.foto-voorbeeld img{max-width:140px;max-height:140px;border-radius:8px;border:1px solid var(--border,#2f3640);display:block;object-fit:cover;}' +
    '.foto-privacy{margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.45);' +
    'font-size:12.5px;line-height:1.4;color:var(--text,#ddd);}' +
    '.foto-mini{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--border,#2f3640);' +
    'background:var(--surface-2,#232830);color:var(--text,#fff);font-size:13px;font-family:inherit;cursor:pointer;margin:4px 6px 0 0;}' +
    '.foto-licht{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;}' +
    '.foto-licht img{max-width:100%;max-height:calc(100% - 90px);object-fit:contain;border-radius:6px;}' +
    '.foto-licht .foto-tekst{color:#ddd;font-size:14px;margin:12px 0;text-align:center;}' +
    '.foto-licht .foto-sluit{min-height:44px;padding:0 22px;border-radius:10px;border:1px solid #666;background:#222;color:#fff;font-size:16px;font-family:inherit;cursor:pointer;}';

  function stijl() {
    if (document.getElementById('fotoStijl')) return;
    var s = document.createElement('style'); s.id = 'fotoStijl'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }

  // ---------- verkleinen ----------
  function laadBeeld(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return laadViaImg(file); });
    }
    return laadViaImg(file);
  }
  function laadViaImg(file) {
    return new Promise(function (ok, fout) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); fout(new Error('Deze foto kan niet worden gelezen. Probeer een andere foto of maak er een nieuwe.')); };
      img.src = url;
    });
  }
  function naarBlob(canvas, kwaliteit) {
    return new Promise(function (ok) { canvas.toBlob(function (b) { ok(b); }, 'image/jpeg', kwaliteit); });
  }
  // Geeft een JPEG-blob terug, kleiner dan MAX_BYTES.
  async function verklein(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Dit is geen foto.');
    var beeld = await laadBeeld(file);
    var b = beeld.width || beeld.naturalWidth, h = beeld.height || beeld.naturalHeight;
    if (!b || !h) throw new Error('Deze foto kan niet worden gelezen.');
    var schaal = Math.min(1, MAX_ZIJDE / Math.max(b, h));
    var kwaliteit = 0.8, blob = null;
    for (var ronde = 0; ronde < 8; ronde++) {
      var cb = Math.max(1, Math.round(b * schaal)), ch = Math.max(1, Math.round(h * schaal));
      var canvas = document.createElement('canvas'); canvas.width = cb; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cb, ch);     // doorzichtige delen (png) wit i.p.v. zwart
      ctx.drawImage(beeld, 0, 0, cb, ch);
      blob = await naarBlob(canvas, kwaliteit);
      if (!blob) throw new Error('Foto verkleinen is niet gelukt.');
      if (blob.size <= DOEL_BYTES) break;
      if (blob.size <= MAX_BYTES && ronde >= 2) break;
      if (kwaliteit > 0.55) kwaliteit -= 0.1; else schaal *= 0.8;
    }
    if (beeld.close) try { beeld.close(); } catch (e) {}
    if (!blob || blob.size > 1.5 * 1024 * 1024) throw new Error('Foto is te groot om te bewaren. Probeer een andere foto.');
    return blob;
  }

  // ---------- opslag ----------
  async function upload(client, map, blob) {
    var pad = map + '/' + nieuwId() + '.jpg';
    var r = await client.storage.from(BUCKET).upload(pad, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (r.error) throw new Error('Foto uploaden is niet gelukt (' + (r.error.message || 'onbekende fout') + '). Controleer de verbinding.');
    return pad;
  }
  async function verwijder(client, pad) {
    if (!pad) return;
    try { await client.storage.from(BUCKET).remove([pad]); } catch (e) { /* de nachtelijke opruiming vangt dit op */ }
  }
  async function url(client, pad) {
    var r = await client.storage.from(BUCKET).createSignedUrl(pad, 300);
    if (r.error || !r.data) throw new Error('De foto is er niet meer (mogelijk automatisch opgeruimd).');
    return r.data.signedUrl;
  }

  // ---------- groot bekijken ----------
  async function toon(client, pad) {
    stijl();
    var laag = document.createElement('div'); laag.className = 'foto-licht';
    laag.innerHTML = '<div class="foto-tekst">Foto laden…</div>';
    document.body.appendChild(laag);
    function dicht() { if (laag.parentNode) laag.parentNode.removeChild(laag); document.removeEventListener('keydown', toets); }
    function toets(e) { if (e.key === 'Escape') dicht(); }
    document.addEventListener('keydown', toets);
    laag.addEventListener('click', function (e) { if (e.target === laag || e.target.className === 'foto-sluit') dicht(); });
    try {
      var u = await url(client, pad);
      laag.innerHTML = '<img alt="Foto bij melding" src="' + esc(u) + '"><div class="foto-tekst">Foto wordt 30 dagen na afhandelen automatisch verwijderd.</div>' +
        '<button type="button" class="foto-sluit">Sluiten</button>';
    } catch (e) {
      laag.innerHTML = '<div class="foto-tekst">' + esc(e.message) + '</div><button type="button" class="foto-sluit">Sluiten</button>';
    }
  }
  function minHtml(pad) {
    return pad ? '<button type="button" class="foto-mini" data-foto-pad="' + esc(pad) + '" aria-label="Foto bekijken">📷 Foto</button>' : '';
  }
  var gekoppeld = [];
  function koppel(client, root) {
    stijl();
    root = root || document;
    if (gekoppeld.indexOf(root) >= 0) return;
    gekoppeld.push(root);
    root.addEventListener('click', function (e) {
      var k = e.target.closest && e.target.closest('.foto-mini[data-foto-pad]');
      if (!k) return;
      e.stopPropagation(); e.preventDefault();
      toon(client, k.getAttribute('data-foto-pad'));
    }, true);
  }

  // ---------- invoerveld ----------
  function veld(plek, opties) {
    stijl();
    opties = opties || {};
    var client = opties.client;
    // opties.staat: een object dat de aanroeper bewaart, zodat een gekozen foto een nieuwe opbouw van het scherm overleeft.
    var st = opties.staat || {};
    if (!('blob' in st)) { st.blob = null; st.voorbeeldUrl = null; st.bestaand = opties.pad || null; st.verwijderd = false; }
    st.bezig = false;
    plek.innerHTML =
      '<div class="foto-veld">' +
      '<div class="foto-rij"><button type="button" class="foto-knop"></button><span class="foto-info"></span></div>' +
      '<div class="foto-voorbeeld" hidden></div>' +
      '<div class="foto-privacy">⚠️ ' + esc(opties.kort ? KORT : WAARSCHUWING) + '</div>' +
      '<input type="file" accept="image/*" hidden>' +
      '</div>';
    var knop = plek.querySelector('.foto-knop'), info = plek.querySelector('.foto-info'),
        voorbeeld = plek.querySelector('.foto-voorbeeld'), invoer = plek.querySelector('input[type=file]');

    function teken() {
      var heeft = !!st.blob || (!!st.bestaand && !st.verwijderd);
      knop.textContent = heeft ? '📷 Foto vervangen' : '📷 Foto toevoegen';
      voorbeeld.hidden = !heeft;
      if (!heeft) { voorbeeld.innerHTML = ''; return; }
      if (st.blob) {
        voorbeeld.innerHTML = '<img alt="Voorbeeld" src="' + esc(st.voorbeeldUrl) + '"><button type="button" class="foto-weg">Foto verwijderen</button>';
      } else {
        voorbeeld.innerHTML = '<button type="button" class="foto-bekijk">📷 Foto bekijken</button><button type="button" class="foto-weg">Foto verwijderen</button>';
        voorbeeld.querySelector('.foto-bekijk').onclick = function () { toon(client, st.bestaand); };
      }
      voorbeeld.querySelector('.foto-weg').onclick = function () {
        if (st.voorbeeldUrl) { try { URL.revokeObjectURL(st.voorbeeldUrl); } catch (e) {} }
        st.blob = null; st.voorbeeldUrl = null;
        if (st.bestaand) st.verwijderd = true;
        info.textContent = ''; invoer.value = ''; teken();
      };
    }
    knop.onclick = function () { if (!st.bezig) invoer.click(); };
    invoer.onchange = async function () {
      var f = invoer.files && invoer.files[0];
      if (!f) return;
      st.bezig = true; knop.disabled = true; info.textContent = 'Foto verkleinen…';
      try {
        var blob = await verklein(f);
        if (st.voorbeeldUrl) { try { URL.revokeObjectURL(st.voorbeeldUrl); } catch (e) {} }
        st.blob = blob; st.voorbeeldUrl = URL.createObjectURL(blob);
        info.textContent = 'Klaar: ' + kb(blob.size) + (f.size > blob.size ? ' (was ' + kb(f.size) + ')' : '');
      } catch (e) { info.textContent = e.message || 'Foto verwerken is niet gelukt.'; }
      st.bezig = false; knop.disabled = false; invoer.value = ''; teken();
    };
    teken();

    return {
      heeftKeuze: function () { return !!st.blob || st.verwijderd; },
      bezig: function () { return st.bezig; },
      // Uploadt een nieuwe foto indien nodig. Geeft het pad terug dat in de rij moet komen, en het pad van de foto die weg mag
      // zodra de rij is opgeslagen (vervangen of verwijderd).
      klaar: async function (cl, map) {
        if (st.blob) {
          var nieuw = await upload(cl || client, map, st.blob);
          return { pad: nieuw, oud: st.bestaand || null };
        }
        if (st.verwijderd) return { pad: null, oud: st.bestaand };
        return { pad: st.bestaand || null, oud: null };
      },
      // Na een mislukte opslag van de rij: de net geüploade foto weer weghalen.
      ruimOp: function (cl, pad) { return verwijder(cl || client, pad); }
    };
  }

  // Directe modus voor iets dat al in de database staat (bv. een afwijking): kiezen = meteen verkleinen, uploaden en opslaan.
  //   o: { client, pad, map, kort, uit, opslaan: async function(nieuwPad|null), klaar: function(nieuwPad|null) }
  function direct(plek, o) {
    stijl();
    var pad = o.pad || null, heeft = !!pad;
    plek.innerHTML = '<div class="foto-veld"><div class="foto-rij">' +
      (heeft ? '<span class="foto-bekijkplek">' + minHtml(pad) + '</span>' : '') +
      '<button type="button" class="foto-knop"' + (o.uit ? ' disabled' : '') + '>' + (heeft ? '📷 Vervangen' : '📷 Foto toevoegen') + '</button>' +
      (heeft && !o.uit ? '<button type="button" class="foto-weg">Verwijderen</button>' : '') +
      '<span class="foto-info"></span></div>' +
      (o.uit ? '' : '<div class="foto-privacy">⚠️ ' + esc(o.kort === false ? WAARSCHUWING : KORT) + '</div>') +
      '<input type="file" accept="image/*" hidden></div>';
    var knop = plek.querySelector('.foto-knop'), info = plek.querySelector('.foto-info'), invoer = plek.querySelector('input'), weg = plek.querySelector('.foto-weg');
    var bezig = false;
    knop.onclick = function () { if (!bezig) invoer.click(); };
    if (weg) weg.onclick = async function () {
      if (bezig) return; bezig = true; info.textContent = 'Bezig…';
      try { await o.opslaan(null); await verwijder(o.client, pad); if (o.klaar) o.klaar(null); }
      catch (e) { info.textContent = 'Verwijderen mislukt. Probeer opnieuw.'; bezig = false; }
    };
    invoer.onchange = async function () {
      var f = invoer.files && invoer.files[0]; if (!f || bezig) return;
      bezig = true; knop.disabled = true; info.textContent = 'Foto verkleinen…';
      var nieuw = null;
      try {
        var blob = await verklein(f);
        info.textContent = 'Uploaden (' + kb(blob.size) + ')…';
        nieuw = await upload(o.client, o.map, blob);
        await o.opslaan(nieuw);
        if (pad) await verwijder(o.client, pad);
        if (o.klaar) o.klaar(nieuw);
      } catch (e) {
        if (nieuw) await verwijder(o.client, nieuw);
        info.textContent = (e && e.message) || 'Foto opslaan mislukt.';
        bezig = false; knop.disabled = false;
      }
      invoer.value = '';
    };
  }

  window.Foto = { direct: direct, stijl: stijl, veld: veld, verklein: verklein, verwijder: verwijder, toon: toon, minHtml: minHtml, koppel: koppel, BUCKET: BUCKET };
})();
