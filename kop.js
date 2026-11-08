/* kop.js — één vaste bovenkant voor alle mobiele apps.
 *
 *   Links:  een pijl met tekst ("‹ Brandweer Mobiel"), wit en groot genoeg om goed te raken.
 *   Rechts: verversen en meldingen aanzetten (🔔 staat aan, 🔕 staat uit).
 *
 * Gebruik
 *   Kop.start({ client: supa, ververs: function(){ ... }, meldingen: function(){ ... } });
 *   Kop.plaats('kopPlek', { terug: { tekst: 'Brandweer Mobiel', href: './index.html' }, ververs: true, meldingen: true });
 *   Kop.plaatsKnoppen('kopActies', { ververs: true, meldingen: true });   // alleen de knoppen rechts (hub, geen terugknop)
 *   Kop.html(opties)                                                      // voor apps die hun bovenkant zelf met JavaScript opbouwen
 *   Kop.zetNav({ terug: { tekst: '...', actie: functie }, ververs: false, meldingen: true });   // de bovenkant onderweg aanpassen
 *
 * Zonder dit bestand werken de apps gewoon: ze houden dan hun oude "← Overzicht"-link.
 * De knop voor meldingen gebruikt de ingelogde sessie; de persoon komt uit de sessie, niet uit de pagina.
 */
(function () {
  // Openbare sleutel voor pushmeldingen: dezelfde als in PloegCompleet. Een geheime sleutel staat hier nooit.
  var VAPID_PUBLIC_KEY = 'BJDM2BEeX8JJmVQIWLMrrcgoQJJp7KYWYj-5SfeTKvr_nX1DyEhTouCnDvfd6gzXneV6JB80wzovhJIl4F3qZGo';

  var CSS =
    '.navrij{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;min-height:44px;}' +
    '.nav-terug{display:inline-flex;align-items:center;gap:6px;min-height:44px;min-width:0;padding:0 12px 0 2px;margin:0;background:none;border:none;' +
    'color:#fff;font-size:15px;font-weight:600;line-height:1.2;font-family:inherit;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '.nav-terug .nav-pijl{font-size:28px;line-height:1;margin-top:-3px;flex:none;}' +
    '.nav-terug .nav-tekst{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}' +
    '.nav-leeg{flex:1;}' +
    '.nav-acties{display:inline-flex;gap:8px;flex:none;align-items:center;}' +
    '.nav-knop{width:44px;height:44px;border-radius:10px;background:var(--surface-2,#232830);border:1px solid var(--border,#2f3640);color:var(--text,#fff);' +
    'font-size:19px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;}' +
    '.nav-knop.bezig{opacity:.5;}' +
    '.kop-toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);max-width:90vw;background:#111;color:#fff;' +
    'border:1px solid #444;border-radius:10px;padding:10px 14px;font-size:14px;z-index:9999;text-align:center;}';

  var opties = { client: null, ververs: null, ververStil: false, meldingen: null };
  var status = { waarde: 'onbekend' };      // aan | uit | geweigerd | niet-beschikbaar | onbekend
  var terugActie = null;
  var gestart = false, toastTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function stijl() {
    if (document.getElementById('kop-stijl')) return;
    var el = document.createElement('style'); el.id = 'kop-stijl'; el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  var TITELS = {
    aan: 'Meldingen staan aan op dit toestel (tik om opnieuw in te stellen)',
    uit: 'Meldingen aanzetten',
    geweigerd: 'Meldingen zijn geweigerd: zet ze aan bij de instellingen van je telefoon',
    'niet-beschikbaar': 'Meldingen aanzetten (werkt alleen vanuit het icoon op je beginscherm)',
    onbekend: 'Meldingen aanzetten'
  };
  function icoon(w) { return w === 'aan' ? '\uD83D\uDD14' : '\uD83D\uDD15'; }   // 🔔 aan, 🔕 uit

  function knoppenHtml(o) {
    var s = '';
    if (o.ververs) s += '<button type="button" class="nav-knop" data-kop="ververs"' + (o.ververAttr ? ' ' + o.ververAttr : '') + ' title="Gegevens verversen" aria-label="Gegevens verversen">\u21BB</button>';
    if (o.meldingen) s += '<button type="button" class="nav-knop" data-kop="meldingen" title="' + esc(TITELS[status.waarde]) + '" aria-label="' + esc(TITELS[status.waarde]) + '">' + icoon(status.waarde) + '</button>';
    return s;
  }
  function terugHtml(t) {
    var inhoud = '<span class="nav-pijl" aria-hidden="true">\u2039</span><span class="nav-tekst">' + esc(t.tekst) + '</span>';
    if (t.href) return '<a class="nav-terug" href="' + esc(t.href) + '">' + inhoud + '</a>';
    terugActie = typeof t.actie === 'function' ? t.actie : null;
    return '<button type="button" class="nav-terug" data-kop="terug">' + inhoud + '</button>';
  }
  function html(o) {
    stijl(); o = o || {};
    return '<div class="navrij">' + (o.terug ? terugHtml(o.terug) : '<span class="nav-leeg"></span>') + '<span class="nav-acties">' + knoppenHtml(o) + '</span></div>';
  }
  function plaats(id, o) { var el = document.getElementById(id); if (el) el.innerHTML = html(o); }
  function plaatsKnoppen(id, o) { stijl(); var el = document.getElementById(id); if (el) { el.className = (el.className ? el.className + ' ' : '') + 'nav-acties'; el.innerHTML = knoppenHtml(o || {}); } }
  function zetNav(o) {
    var rij = document.querySelector('.navrij'); if (!rij) return;
    var tmp = document.createElement('div'); tmp.innerHTML = html(o);
    if (rij.parentNode && tmp.firstChild) rij.parentNode.replaceChild(tmp.firstChild, rij);
  }

  function toast(tekst) {
    stijl();
    var el = document.getElementById('kop-toast');
    if (!el) { el = document.createElement('div'); el.id = 'kop-toast'; el.className = 'kop-toast'; document.body.appendChild(el); }
    el.textContent = tekst; el.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = 'none'; }, 4500);
  }

  // ---------- meldingen ----------
  function sleutelNaarBytes(b64) {
    var padding = '='.repeat((4 - b64.length % 4) % 4), base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64), uit = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) uit[i] = raw.charCodeAt(i);
    return uit;
  }
  async function bepaalStatus() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'niet-beschikbaar';
      if (Notification.permission === 'denied') return 'geweigerd';
      var reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.pushManager) return 'uit';
      return (await reg.pushManager.getSubscription()) ? 'aan' : 'uit';
    } catch (e) { return 'onbekend'; }
  }
  function zetIconen() {
    var knoppen = document.querySelectorAll('[data-kop="meldingen"]');
    for (var i = 0; i < knoppen.length; i++) {
      knoppen[i].textContent = icoon(status.waarde);
      knoppen[i].title = TITELS[status.waarde]; knoppen[i].setAttribute('aria-label', TITELS[status.waarde]);
    }
  }
  async function ververStatus() { status.waarde = await bepaalStatus(); zetIconen(); return status.waarde; }

  // Stuurt één testmelding naar de ingelogde persoon zelf, zodat meteen te zien is dat meldingen echt aankomen. Gebruikt de bestaande
  // verstuurfunctie met de sessie van de gebruiker (via supabase-js, dus met een echte JWT); er wordt maar naar één persoon gestuurd.
  async function testmelding(client, persoonId) {
    try {
      var r = await client.functions.invoke('verstuur-batch-melding', {
        body: { ontvangerIds: [persoonId], titel: 'Testmelding', tekst: 'Meldingen werken op dit toestel \u2713' }
      });
      if (r && r.error) throw r.error;
      var tekst = r && typeof r.data === 'string' ? r.data : '';
      var m = /ok, (\d+) verstuurd, (\d+) mislukt/.exec(tekst);
      if (m && Number(m[1]) >= 1 && Number(m[2]) === 0) return { ok: true, reden: '' };
      return { ok: false, reden: tekst || 'onbekend antwoord' };
    } catch (e) { return { ok: false, reden: e && e.message ? e.message : String(e) }; }
  }

  async function aanzetten() {
    var client = opties.client;
    if (!client) { toast('Meldingen: niet beschikbaar in deze app.'); return; }
    var s = await client.auth.getSession();
    var sessie = s && s.data && s.data.session;
    var persoonId = sessie && sessie.user && sessie.user.user_metadata && sessie.user.user_metadata.persoon_id;
    if (!persoonId) { toast('Meldingen: log eerst in.'); return; }
    if (!('serviceWorker' in navigator)) { toast('Deze browser ondersteunt zelfs geen service workers \u2013 waarschijnlijk een ingebouwd mini-browsertje (bijv. vanuit WhatsApp). Open de link in Safari/Chrome zelf.'); return; }
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    try {
      await navigator.serviceWorker.register('sw.js');
      var reg = await navigator.serviceWorker.ready;
      if (!reg.pushManager) {
        toast(standalone ? 'Meldingen niet ondersteund op dit toestel/deze browser, ook al staat de app los open.'
                         : 'Meldingen niet beschikbaar \u2013 open de app via het beginscherm-icoontje, niet als gewoon tabblad.');
        return;
      }
      var toestemming = await Notification.requestPermission();
      if (toestemming !== 'granted') { toast('Meldingen: toestemming niet gegeven (' + toestemming + '). Zet ze aan bij de instellingen van je telefoon.'); return; }
      // Een bestaande registratie hoort bij de sleutel waarmee hij is aangemaakt: eerst opzeggen, anders kan de browser de nieuwe weigeren.
      var bestaand = await reg.pushManager.getSubscription();
      if (bestaand) await bestaand.unsubscribe();
      var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: sleutelNaarBytes(VAPID_PUBLIC_KEY) });
      var json = sub.toJSON();
      // Dit toestel mag maar bij één persoon tegelijk geregistreerd staan, anders krijgt een eerdere gebruiker ook meldingen die niet voor hem zijn.
      await client.from('push_subscriptions').delete().eq('subscriptie->>endpoint', json.endpoint).neq('lid_id', persoonId);
      var res = await client.from('push_subscriptions').upsert({ lid_id: persoonId, subscriptie: json, bijgewerkt_op: new Date().toISOString() }, { onConflict: 'lid_id,endpoint' });
      if (res.error) { toast('Meldingen: opslaan mislukt \u2013 ' + res.error.message); return; }
      toast('Meldingen ingeschakeld \u2713 \u2013 testmelding wordt verstuurd\u2026');
      var t = await testmelding(client, persoonId);
      toast(t.ok ? 'Testmelding verstuurd. Zie je hem op je telefoon? Zo niet, kijk dan bij de instellingen van je telefoon.'
                 : 'Meldingen staan aan, maar de testmelding kon niet worden verstuurd (' + t.reden + ').');
    } catch (e) { toast('Meldingen: instellen mislukt \u2013 ' + (e && e.message ? e.message : e)); }
  }

  async function ververs(knop) {
    if (knop && knop.classList) knop.classList.add('bezig');
    if (!opties.ververStil) toast('Bezig met verversen\u2026');
    try { await opties.ververs(); if (!opties.ververStil) toast('Bijgewerkt'); }
    catch (e) { toast('Verversen mislukt \u2013 controleer de verbinding.'); }
    if (knop && knop.classList) knop.classList.remove('bezig');
  }
  async function meldingenKlik() {
    try { if (typeof opties.meldingen === 'function') await opties.meldingen(); else await aanzetten(); }
    catch (e) { toast('Meldingen: instellen mislukt \u2013 ' + (e && e.message ? e.message : e)); }
    await ververStatus();
  }

  function klik(e) {
    var knop = e && e.target && e.target.closest ? e.target.closest('[data-kop]') : null;
    if (!knop) return;
    var soort = knop.getAttribute('data-kop');
    if (soort === 'ververs') { if (typeof opties.ververs === 'function') { e.preventDefault(); ververs(knop); } }   // zonder functie handelt de app de knop zelf af
    else if (soort === 'meldingen') { e.preventDefault(); meldingenKlik(); }
    else if (soort === 'terug') { e.preventDefault(); if (typeof terugActie === 'function') terugActie(); }
  }

  function start(o) {
    if (o) { opties.client = o.client || opties.client; if ('ververs' in o) opties.ververs = o.ververs; opties.ververStil = !!o.ververStil; if ('meldingen' in o) opties.meldingen = o.meldingen; }
    if (gestart) return;
    gestart = true;
    stijl();
    document.addEventListener('click', klik);
    ververStatus();
    // De status kan veranderen terwijl de app open staat (bijvoorbeeld na het aanpassen van de toestemming in de instellingen).
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') ververStatus(); });
  }

  window.Kop = { start: start, html: html, plaats: plaats, plaatsKnoppen: plaatsKnoppen, zetNav: zetNav, toast: toast, ververStatus: ververStatus, testmelding: testmelding,
                 _opties: opties, _status: status, _klik: klik, _aanzetten: aanzetten };
})();
