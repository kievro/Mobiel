/* aanwezig.js — laat Dagstaat weten dat deze app op dit moment open staat.
 *
 * Gebruik (één regel, direct na het aanmaken van de supabase-client):
 *     if (window.Aanwezig) Aanwezig.start(supa, { app: 'hub' });
 *
 * Wat het doet: zodra er een ingelogde sessie is, meldt de app elke 30 seconden via de database-functie meld_aanwezig dat hij
 * open staat. Beheer en pco zien dat in Dagstaat bij "Wie is online". Persoon en naam komen uit de inlogsessie, niet uit deze
 * code, dus niemand kan zich als een ander voordoen. Er wordt niets bewaard: bij sluiten verdwijnt de regel, anders na 90 seconden.
 *
 * Het blokkeert nooit iets: ontbreekt de database-functie, is er geen verbinding of is er niemand ingelogd, dan gebeurt er niets.
 * Staat dit bestand niet online, dan werkt de app gewoon (de aanroep hierboven slaat dan over).
 */
(function () {
  var INTERVAL_MS = 30000;
  var MIN_TUSSENPOOS_MS = 5000;     // meldt nooit vaker dan eens per 5 seconden, ook niet als de browser veel inlog-events afvuurt
  var toestand = { client: null, opties: null, timer: null, sessieId: null, gestart: false, laatsteFout: null, laatsteMelding: 0 };

  function nieuweId() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function waarde(w) { return typeof w === 'function' ? w() : w; }

  async function meld(forceer) {
    var c = toestand.client, o = toestand.opties;
    if (!c || !o) return;
    var nu = Date.now();
    if (!forceer && nu - toestand.laatsteMelding < MIN_TUSSENPOOS_MS) return;
    try {
      var s = await c.auth.getSession();
      if (!(s && s.data && s.data.session)) return;               // nog niet ingelogd: niets doorgeven
      toestand.laatsteMelding = nu;
      var r = await c.rpc('meld_aanwezig', {
        p_sessie: toestand.sessieId, p_app: o.app, p_versie: waarde(o.versie) || null,
        p_tabblad: waarde(o.tabblad) || null, p_post: waarde(o.post) || null,
        p_zichtbaar: document.visibilityState !== 'hidden'
      });
      if (r && r.error) throw r.error;
      toestand.laatsteFout = null;
    } catch (e) {
      if (!toestand.laatsteFout && window.console) console.warn('[aanwezig] niet doorgegeven (blokkeert verder niets):', e && e.message ? e.message : e);
      toestand.laatsteFout = (e && e.message) || String(e);
    }
  }
  function afmelden() {
    var c = toestand.client;
    if (!c || !toestand.sessieId) return;
    try { c.rpc('meld_afwezig', { p_sessie: toestand.sessieId }); } catch (e) {}   // best effort: de database ruimt het anders na 90 seconden op
  }
  function start(client, opties) {
    if (toestand.gestart || !client || !opties || !opties.app) return;
    toestand.gestart = true; toestand.client = client; toestand.opties = opties; toestand.sessieId = nieuweId();
    meld(true);
    toestand.timer = setInterval(function () { meld(true); }, INTERVAL_MS);
    document.addEventListener('visibilitychange', function () { meld(false); });
    window.addEventListener('pagehide', afmelden);
    // Direct na het inloggen melden in plaats van tot de volgende tik te wachten. Uitgesteld, want supabase-js raadt af om in zijn
    // eigen callback weer auth-functies aan te roepen.
    try { client.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_IN') setTimeout(function () { meld(false); }, 0); }); } catch (e) {}
  }
  function stop() { clearInterval(toestand.timer); toestand.timer = null; toestand.gestart = false; }

  window.Aanwezig = { start: start, stop: stop, _toestand: toestand, _meld: meld };
})();
