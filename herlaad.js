/* herlaad.js — laat een app zichzelf verversen (zoals F5, of de app afsluiten en opnieuw openen) zodra jij daar via een SQL-script om vraagt.
 *
 * Gebruik (één regel, direct na het aanmaken van de supabase-client):
 *     if (window.Herlaad) Herlaad.start(supa, { app: 'overdracht', veilig: function(){ return true; } });
 *
 * Hoe het werkt
 *   * In de tabel kv_store staat onder de sleutel "herlaad_signaal" een waarde met een id en een doel. De SQL-scripts in de map
 *     sql-herladen veranderen die waarde.
 *   * Elke geopende app leest die waarde bij het openen (dat is "de stand waarmee deze pagina is geladen") en daarna elke minuut en
 *     zodra je terugkeert naar de app. Is het id veranderd en geldt het doel voor deze app, dan ververst de app.
 *   * Doel: "alles", "mobiel" (alle mobiele apps), "web" (Dagstaat, PloegCompleet web en de bezettingsmonitor) of de naam van één app.
 *   * Een app die op de achtergrond staat controleert niets; hij ververst dus zodra je hem weer opent. Dat is hetzelfde als afsluiten
 *     en opnieuw openen.
 *
 * Veiligheid
 *   * Een pagina ververst nooit midden in het intypen of terwijl een venster open staat: dan wacht hij en staat er een melding met een
 *     knop "Nu verversen". De ingetypte tekst blijft dus staan tot je klaar bent.
 *   * Eén signaal ververst een pagina maar één keer, ook als de browser de oude versie nog vasthoudt. Er is dus geen oneindige lus mogelijk.
 *   * Mislukt het lezen (geen verbinding, geen rechten), dan gebeurt er niets en blokkeert er niets.
 *
 * Staat dit bestand niet online, dan werkt de app gewoon; hij ververst dan alleen niet op afstand.
 */
(function () {
  var SLEUTEL = 'herlaad_signaal';
  var INTERVAL_MS = 60000;          // eens per minuut kijken
  var MIN_TUSSENPOOS_MS = 10000;    // nooit vaker dan eens per 10 seconden lezen, ook niet als de browser veel gebeurtenissen afvuurt
  var AFTELLEN_MS = 5000;           // zo lang staat de melding in beeld voordat de pagina ververst
  var VEILIG_CONTROLE_MS = 3000;    // zolang het niet veilig is, elke 3 seconden opnieuw kijken
  var LAATSTE_SLEUTEL = 'herlaad_laatste';
  var GROEPEN = {
    mobiel: ['hub', 'start', 'dagstaat-mobiel', 'overdracht', 'voertuigcontrole', 'oefenplanning', 'ploegcompleet-mobiel'],
    web: ['dagstaat', 'ploegcompleet-web', 'bezetting']
  };
  var CSS = '#herlaad-balk{position:fixed;top:0;left:0;right:0;z-index:10000;background:#F0A93A;color:#12161B;padding:10px 14px;padding-top:calc(10px + env(safe-area-inset-top,0px));' +
    'font:600 14px/1.3 system-ui,sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,.4);}' +
    '#herlaad-balk button{background:#12161B;color:#fff;border:none;border-radius:8px;padding:8px 12px;font:600 13px system-ui,sans-serif;cursor:pointer;min-height:36px;flex:none;}';

  var st = { client: null, opties: null, basis: undefined, timer: null, gestart: false, bezig: false, laatsteLezing: 0, wachtTimer: null };

  function geldtVoor(doel, app) {
    if (!doel || doel === 'alles') return true;            // geen doel opgegeven telt als "alles"
    if (doel === app) return true;
    return !!(GROEPEN[doel] && GROEPEN[doel].indexOf(app) !== -1);
  }
  function lees() {
    return Promise.resolve().then(function () {
      return st.client.from('kv_store').select('value').eq('key', SLEUTEL).maybeSingle();
    }).then(function (r) {
      if (!r || r.error) return undefined;                  // niet gelukt: de stand blijft zoals hij was
      var w = r.data ? r.data.value : null;
      if (typeof w === 'string') { try { w = JSON.parse(w); } catch (e) { w = null; } }
      return w || null;
    }).catch(function () { return undefined; });
  }
  function laatsteVerversing() { try { return window.sessionStorage.getItem(LAATSTE_SLEUTEL); } catch (e) { return null; } }
  function onthoud(id) { try { window.sessionStorage.setItem(LAATSTE_SLEUTEL, id); } catch (e) {} }

  function veiligNu() {
    try {
      var a = document.activeElement;
      var typt = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button' && a.type !== 'submit' && a.type !== 'checkbox' && a.type !== 'radio' && a.value;
      if (typt) return false;
      if (st.opties && typeof st.opties.veilig === 'function' && !st.opties.veilig()) return false;
    } catch (e) { /* bij twijfel: veilig, anders komt een kapotte controle nooit meer van zijn melding af */ }
    return true;
  }
  function verwijderBalk() { var b = document.getElementById('herlaad-balk'); if (b && b.parentNode) b.parentNode.removeChild(b); }
  function toonBalk(tekst, metKnop, bijKlik) {
    if (!document.getElementById('herlaad-stijl')) {
      var s = document.createElement('style'); s.id = 'herlaad-stijl'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
    }
    verwijderBalk();
    var b = document.createElement('div'); b.id = 'herlaad-balk';
    var t = document.createElement('span'); t.textContent = tekst; b.appendChild(t);
    if (metKnop) { var k = document.createElement('button'); k.type = 'button'; k.textContent = 'Nu verversen'; k.addEventListener('click', bijKlik); b.appendChild(k); }
    (document.body || document.documentElement).appendChild(b);
  }
  function ververs(id) {
    onthoud(id);
    verwijderBalk();
    window.location.reload();
  }
  // Een nieuwe versie is gevraagd: wacht tot het veilig is, laat een melding zien en ververs dan.
  function plan(id) {
    if (st.bezig) return;
    st.bezig = true;
    function probeer() {
      if (!veiligNu()) {
        toonBalk('Er is een nieuwe versie. De pagina wordt ververst zodra je klaar bent.', true, function () { ververs(id); });
        st.wachtTimer = setTimeout(probeer, VEILIG_CONTROLE_MS);
        return;
      }
      toonBalk('Er is een nieuwe versie. De pagina wordt ververst…', true, function () { ververs(id); });
      st.wachtTimer = setTimeout(function () { if (veiligNu()) ververs(id); else probeer(); }, AFTELLEN_MS);
    }
    probeer();
  }

  function controleer(forceer) {
    var nu = Date.now();
    if (!forceer && nu - st.laatsteLezing < MIN_TUSSENPOOS_MS) return Promise.resolve();
    st.laatsteLezing = nu;
    return lees().then(function (w) {
      if (w === undefined) return;                           // lezen mislukt: niets doen
      var id = w && w.id ? String(w.id) : null;
      if (st.basis === undefined) { st.basis = id; return; } // eerste lezing: dit is de stand waarmee de pagina is geladen
      if (id === st.basis) return;
      st.basis = id;                                         // hetzelfde signaal nooit twee keer afhandelen
      if (!id || !geldtVoor(w.doel, st.opties.app)) return;
      if (laatsteVerversing() === id) return;                // voor dit signaal is deze pagina al ververst
      plan(id);
    });
  }

  function start(client, opties) {
    if (st.gestart || !client || !opties || !opties.app) return;
    st.gestart = true; st.client = client; st.opties = opties;
    controleer(true);
    st.timer = setInterval(function () { controleer(false); }, INTERVAL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') controleer(false); });
    window.addEventListener('online', function () { controleer(false); });
  }
  function stop() { clearInterval(st.timer); clearTimeout(st.wachtTimer); st.timer = null; st.gestart = false; st.bezig = false; }

  window.Herlaad = { start: start, stop: stop, _st: st, _controleer: controleer, _geldtVoor: geldtVoor, _plan: plan };
})();
