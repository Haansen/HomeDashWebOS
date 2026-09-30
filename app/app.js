// ---- app ----

if (typeof document !== "undefined") (function () {
  const $ = id => document.getElementById(id);
  const el = (tag, props) => Object.assign(document.createElement(tag), props);
  const sys = window.webOSSystem || window.PalmSystem;
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } };
  const save = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} };

  const states = {}, tiles = {};
  let auth = load("auth", null); // { url, client_id, refresh_token } or { url, token } (long-lived token)
  // All settings in one object. Older versions stored them separately, hence the individual keys.
  let cfg = Object.assign({}, DEFAULTS, { domains: load("domains", DEFAULTS.domains), hidden: load("hidden", []), favorites: load("favorites", []),
    side: load("side", "right"), startMenu: load("startMenu", false) }, load("cfg", {}));
  let settingsSection = null, pickingKey = null, lastKey = null; // open submenu under Settings, shortcut button being assigned
  let saverTimer = null, saverOn = false, saverSwitch = null, saverIndex = 0, saverLayer = 0, saverLaunched = false; // launched by HA just for the screensaver
  let mode = "full"; // full = the whole app, notice = just the notification card, menu = just the quick menu. The last two are drawn on top of whatever the TV shows.
  let notice = null, noticeTimer = null, menuTimer = null, menuReady = false, menuTouched = false, shownAt = 0;
  const rows = {};
  let page = load("page", "home"), homeSet = new Set();
  let reg = {}, devArea = {}, areas = [], tr = {};
  let ws, gen = 0, msgId = 0, pending = {}, subs = {}, services = {}, bearer = "", haBusy = "", haDone = {};
  let forecast = [], forecastFor = null, wallPage = 0, wallOpen = false, ptz = false;
  let viewing = null, pip = false, lastFocus = null;
  let dimming = null, dimArmed = false, panelRows = [], panelCode = ""; // the long-press panel
  let pressed = null, pressTimer = null, toastTimer = null, confirming = null, confirmTimer = null, railKey = "";
  let setupUrl = "", flow = null, keyboardUp = false, keyboardClosed = 0;
  let pairing = null; // open subscription to the pairing service while the QR code is shown
  let wanted = null; // camera to open as soon as we are connected

  const roomOf = id => "room:" + (areaOf(reg[id], devArea) || "");
  const shown = s => domainOf(s.entity_id) !== "weather" && isVisible(s, reg[s.entity_id], cfg.domains, cfg.hidden);
  const favFirst = (a, b) => cfg.favorites.includes(b.entity_id) - cfg.favorites.includes(a.entity_id);
  const visible = () => Object.values(states).filter(shown).sort(byName);
  const isCam = s => domainOf(s.entity_id) === "camera";
  const onHome = s => shown(s) && isActive(s) && HOME_DOMAINS.includes(domainOf(s.entity_id));
  const title = d => TEXT[LANG].domains[d] || tr[`component.${d}.title`] || d;
  const rank = d => (ORDER.indexOf(d) + 1) || 99;
  const byRank = (a, b) => rank(a) - rank(b) || title(a).localeCompare(title(b), LANG);
  const svg = name => `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${ICONS[name]}"/></svg>`;
  const camIds = () => visible().filter(isCam).map(s => s.entity_id);
  const isDemo = () => !!auth && auth.url === DEMO_URL;
  const demoSeed = id => [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const snapshot = id => isDemo() ? demoPicture(nameOf(states[id]), demoSeed(id)) : `${auth.url}/api/camera_proxy/${id}?token=${states[id].attributes.access_token}&t=${Date.now()}`;
  const stream = id => isDemo() ? demoPicture(nameOf(states[id]), demoSeed(id)) : `${auth.url}/api/camera_proxy_stream/${id}?token=${states[id].attributes.access_token}`;
  const status = text => { $("status").textContent = text; };
  const inSetup = () => !$("setup").hidden;
  const weatherAll = () => Object.values(states).filter(s => domainOf(s.entity_id) === "weather").sort(byName);
  // chosen weather source, otherwise the first one available
  const weatherEntity = () => (cfg.weather && states[cfg.weather] && states[cfg.weather].state !== "unavailable" ? states[cfg.weather] : null) || weatherAll().find(s => s.state !== "unavailable") || null;
  const isImage = s => domainOf(s.entity_id) === "image";
  const picture = id => isDemo() ? demoPicture(nameOf(states[id]), demoSeed(id) + 7) : `${auth.url}/api/image_proxy/${id}?token=${states[id].attributes.access_token}&t=${Date.parse(states[id].state) || 0}`;

  // daily forecast from the chosen weather source, via HA's subscription
  function subscribeForecast() {
    const w = weatherEntity(), id = w && w.entity_id;
    if (id === forecastFor) return;
    forecastFor = id; forecast = [];
    if (!id) return renderIfHome();
    subscribe({ type: "weather/subscribe_forecast", entity_id: id, forecast_type: "daily" }, e => {
      if (forecastFor !== id) return;
      forecast = (e.forecast || []).slice(0, 5);
      renderIfHome();
    });
  }
  const renderIfHome = () => { if (page === "home") renderMain(); };

  function forecastTile(f, i) {
    const b = el("button", { className: "tile dev readonly forecast", innerHTML: svg(WEATHER_ICON[f.condition] || "wCloudy") });
    b.dataset.key = "forecast:" + i;
    const day = new Date(f.datetime), label = i === 0 ? t("today") : i === 1 ? t("tomorrow") : day.toLocaleDateString(locale(), { weekday: "long" });
    b.append(el("span", { className: "name", textContent: label.charAt(0).toUpperCase() + label.slice(1) }),
      el("small", { textContent: [f.temperature != null && num(f.temperature, 0) + "°", f.templow != null && num(f.templow, 0) + "°"].filter(Boolean).join(" / ") + (TEXT[LANG].weather[f.condition] ? " · " + TEXT[LANG].weather[f.condition] : "") }));
    return b;
  }

  function toast(text, info) {
    $("toast").textContent = text; $("toast").hidden = false;
    $("toast").classList.toggle("info", !!info);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
  }

  function focus(target) {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }
  const focusRail = () => focus(document.querySelector(".rail-item.active") || document.querySelector(".rail-item"));
  const focusMain = () => { const tile = document.querySelector("main .tile"); if (tile) focus(tile); return !!tile; };
  const fallbackFocus = () => (lastFocus && document.contains(lastFocus) && lastFocus) || document.querySelector("main .tile") || document.querySelector(".rail-item.active");

  async function http(url, options, ms) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), ms || 8000);
    try { return await fetch(url, Object.assign({ signal: abort.signal }, options)); } finally { clearTimeout(timer); }
  }
  const postJson = (url, body) => http(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const postForm = (url, body) => http(url, { method: "POST", body: new URLSearchParams(body) });

  // Settings are stored on the TV and in Home Assistant (per user), so they survive reinstalls and follow the user to other TVs
  function saveSettings() {
    save("cfg", cfg);
    applyTheme();
    send({ type: "frontend/set_user_data", key: "homedash", value: cfg }).catch(() => {});
  }

  function applyTheme() {
    document.documentElement.dataset.theme = THEMES.includes(cfg.theme) ? cfg.theme : "dark";
  }

  // ---- connection ----

  async function accessToken() {
    if (auth.token) return auth.token;
    const r = await postForm(auth.url + "/auth/token", { grant_type: "refresh_token", refresh_token: auth.refresh_token, client_id: auth.client_id });
    if (r.status >= 400 && r.status < 500) throw Object.assign(new Error("expired"), { expired: true });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.json()).access_token;
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error(t("offline")));
      msg.id = ++msgId;
      pending[msg.id] = { resolve, reject };
      ws.send(JSON.stringify(msg));
    });
  }

  async function connect() {
    const mine = ++gen; // a new connection or a sign-out invalidates older retries
    const retry = () => { if (mine !== gen) return; status(t("offline")); setTimeout(() => { if (mine === gen) connect(); }, 5000); };
    status(t("connecting"));
    let token;
    try { token = await accessToken(); } catch (e) { if (mine !== gen) return; return e.expired ? signOut(t("expired")) : retry(); }
    if (mine !== gen) return;
    bearer = token;
    msgId = 0; pending = {};
    const sock = ws = isDemo() ? new DemoSocket() : new WebSocket(auth.url.replace(/^http/, "ws") + "/api/websocket");
    sock.onclose = retry;
    sock.onmessage = e => {
      if (mine !== gen) return;
      const m = JSON.parse(e.data);
      if (m.type === "auth_required") sock.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (m.type === "auth_ok") start();
      else if (m.type === "auth_invalid") signOut(t("expired")); // do not retry: repeated failures can make HA ban the TV's IP
      else if (m.type === "result" && pending[m.id]) {
        const p = pending[m.id]; delete pending[m.id];
        m.success ? p.resolve(m.result) : p.reject(m.error);
      } else if (m.type === "event" && subs[m.id]) subs[m.id](m.event);
    };
  }

  function subscribe(msg, handler) {
    return send(msg).then(() => { subs[msg.id] = handler; }, () => {});
  }

  async function start() {
    subs = {};
    subscribe({ type: "subscribe_events", event_type: "state_changed" }, e => onState(e.data));
    send({ type: "get_services" }).then(r => { services = r || {}; }, () => {});
    const list = type => send({ type }).catch(() => []); // without the registry everything ends up under "Other"
    const words = category => send({ type: "frontend/get_translations", language: HA_LANG, category }).then(r => r.resources, () => ({}));
    const [all, areaList, entList, devList, ...translations] = await Promise.all([send({ type: "get_states" }),
      list("config/area_registry/list"), list("config/entity_registry/list"), list("config/device_registry/list"),
      words("entity_component"), words("entity"), words("title")]);
    const remote = await send({ type: "frontend/get_user_data", key: "homedash" }).then(r => r && r.value, () => null);
    if (remote && Array.isArray(remote.domains)) { cfg = Object.assign({}, DEFAULTS, remote); save("cfg", cfg); applyTheme(); }
    Object.keys(states).forEach(k => delete states[k]);
    all.forEach(s => { states[s.entity_id] = s; });
    areas = areaList; reg = {}; devArea = {}; tr = Object.assign({}, ...translations);
    entList.forEach(e => { reg[e.entity_id] = e; });
    devList.forEach(d => { devArea[d.id] = d.area_id; });
    status(isDemo() ? t("demoInfo") : "");
    resetHome();
    subscribeForecast();
    renderRail(); renderMain(); updateClock();
    if (mode === "full" && !document.activeElement.dataset.key && !document.activeElement.dataset.page) focusMain() || focusRail();
    if (wanted === "saver") openSaver(); else if (wanted) openCamera(wanted);
    wanted = null;
    if (notice) noticeImage();
    if (mode === "menu" || menuReady) renderMenu();
    idle();
  }

  // Runs for every change in all of HA (sensors update often), so most of it is filtered out early
  function onState({ entity_id: id, new_state: s }) {
    const was = states[id];
    if (s) states[id] = s; else delete states[id];
    if (domainOf(id) === "weather") return updateClock();
    const before = !!was && shown(was), now = !!s && shown(s);
    if (!before && !now) return;
    let redraw = before !== now;
    // Home shows what is on; new items are added but switched-off ones stay so you can undo
    if (now && onHome(s) && !homeSet.has(id)) { homeSet.add(id); redraw = redraw || page === "home"; }
    if (redraw) {
      renderRail();
      if (["home", "cameras", roomOf(id)].includes(page)) renderMain();
    } else if (tiles[id]) update(tiles[id], s);
    if (rows[id] && s) updateRow(rows[id], s);
    if (redraw || (before && isActive(was)) !== (now && isActive(s))) updateRail();
    if (dimming === id) { if (now) refreshPanel(); else closeDimmer(); }
  }

  function signOut(message) {
    gen++;
    if (ws) { ws.onclose = null; ws.close(); }
    if (viewing) closeCamera();
    closeDimmer();
    auth = null; save("auth", null);
    hideNotice(); closeMenu(); setMode("full");
    Object.keys(states).forEach(k => delete states[k]);
    status("");
    renderRail(); renderMain();
    showSetup(message);
  }

  // ---- first start: find the server and sign in ----

  const luna = (uri, params) => new Promise(resolve => {
    const Bridge = window.WebOSServiceBridge || window.PalmServiceBridge;
    if (!Bridge) return resolve({});
    const bridge = new Bridge();
    bridge.onservicecallback = msg => resolve(parseParams(msg));
    bridge.call(uri, JSON.stringify(params || {}));
    setTimeout(() => resolve({}), 3000);
  });

  async function isHomeAssistant(url, ms) {
    try { return (await (await http(url + "/manifest.json", {}, ms)).json()).name === "Home Assistant"; } catch (e) { return false; }
  }

  // Only scans the TV's own /24 network on port 8123. Other networks and ports must be entered by hand.
  async function discover() {
    const net = await luna("luna://com.webos.service.connectionmanager/getStatus");
    const ip = (net.wired && net.wired.ipAddress) || (net.wifi && net.wifi.ipAddress);
    if (!ip) return [];
    const base = ip.replace(/\d+$/, ""), found = [];
    await Promise.all(Array.from({ length: 254 }, (_, i) => {
      const url = `http://${base}${i + 1}:8123`;
      return isHomeAssistant(url, PROBE_MS).then(ok => { if (ok) found.push(url); });
    }));
    return found.sort();
  }

  // ---- sign in from the phone via QR code ----

  function startPairing(serverHint) {
    stopPairing();
    const Bridge = window.WebOSServiceBridge || window.PalmServiceBridge;
    if (!Bridge || typeof qrcode === "undefined") return;
    const bridge = pairing = new Bridge();
    bridge.onservicecallback = raw => {
      if (bridge !== pairing) return;
      const m = parseParams(raw);
      if (m.credentials) return usePairing(m.credentials);
      if (!m.returnValue || !m.ip || !m.port) return; // without the service no QR code is shown; signing in on the TV still works
      const qr = qrcode(0, "M");
      qr.addData(`http://${m.ip}:${m.port}/${m.code}`);
      qr.make();
      $("pair-qr").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
      $("pair").hidden = false;
    };
    bridge.call(PAIR_SERVICE + "/start", JSON.stringify({ subscribe: true, server: serverHint || "" }));
  }

  function stopPairing() {
    if (pairing) pairing.cancel();
    pairing = null;
    $("pair").hidden = true;
    $("pair-qr").textContent = "";
  }

  async function usePairing(c) {
    if (c.token) {
      if (!provision(c)) return setupMessage(t("pairBad"), true);
      stopPairing();
      $("setup").hidden = true;
      return connect();
    }
    await pickServer(c.url);
    if ($("login-form").hidden) return; // the address could not be reached, the error is already shown
    $("login-user").value = c.username; $("login-pass").value = c.password;
    login();
  }

  function setupMessage(text, error) {
    $("setup-msg").textContent = text || "";
    $("setup-msg").classList.toggle("error", !!error);
  }

  async function showSetup(message) {
    $("setup").hidden = false;
    $("login-form").hidden = true; $("server-form").hidden = false; $("setup-servers").hidden = false;
    $("setup-title").textContent = t("welcome");
    $("setup-servers").textContent = "";
    flow = null;
    setupMessage(message || t("searching"), !!message);
    focus($("server-url"));
    stopPairing();
    const found = await discover();
    if (!inSetup()) return;
    startPairing(found[0]);
    if (!$("login-form").hidden) return;
    found.forEach(url => $("setup-servers").append(el("button", { type: "button", textContent: url.replace(/^http:\/\//, ""), onclick: () => pickServer(url) })));
    if (!message) setupMessage(t(found.length ? "pick" : "none"));
    if (found.length && !$("server-url").value) focus($("setup-servers").firstChild);
  }

  async function pickServer(input) {
    const url = normalizeUrl(input);
    if (!url || !(await isHomeAssistant(url, 6000))) return setupMessage(t("unreachable", url || input), true);
    try {
      const { providers } = await (await http(url + "/auth/providers")).json();
      if (!providers.some(p => p.type === "homeassistant")) return setupMessage(t("noPassword"), true);
    } catch (e) { return setupMessage(t("unreachable", url), true); }
    setupUrl = url; flow = null;
    $("setup-title").textContent = t("loginTo", url.replace(/^https?:\/\//, ""));
    setupMessage("");
    $("server-form").hidden = true; $("setup-servers").hidden = true; $("login-form").hidden = false;
    $("login-code").hidden = true; $("login-user").hidden = false; $("login-pass").hidden = false;
    $("login-pass").value = $("login-code").value = "";
    focus($("login-user"));
  }

  // Only HA's own username/password login (plus two-factor code). Other auth providers are not supported.
  async function login() {
    const client_id = setupUrl + "/";
    const mfa = flow && flow.mfa;
    if (mfa ? !$("login-code").value : !$("login-user").value || !$("login-pass").value) return focus(mfa ? $("login-code") : $("login-user").value ? $("login-pass") : $("login-user"));
    try {
      if (!flow) flow = { id: (await (await postJson(setupUrl + "/auth/login_flow", { client_id, handler: ["homeassistant", null], redirect_uri: client_id })).json()).flow_id };
      const step = await (await postJson(setupUrl + "/auth/login_flow/" + flow.id,
        mfa ? { code: $("login-code").value.trim(), client_id } : { username: $("login-user").value.trim(), password: $("login-pass").value, client_id })).json();
      if (step.type === "form" && step.errors && Object.keys(step.errors).length) {
        setupMessage(t(mfa ? "badCode" : "badLogin"), true);
        return focus(mfa ? $("login-code") : $("login-pass"));
      }
      if (step.type === "form") { // the next step is a two-factor code
        flow.mfa = true;
        $("login-user").hidden = $("login-pass").hidden = true; $("login-code").hidden = false;
        setupMessage("");
        return focus($("login-code"));
      }
      if (step.type !== "create_entry") throw new Error(step.type);
      const r = await postForm(setupUrl + "/auth/token", { grant_type: "authorization_code", code: step.result, client_id });
      const tokens = await r.json();
      if (!r.ok || !tokens.refresh_token) throw new Error("token");
      auth = { url: setupUrl, client_id, refresh_token: tokens.refresh_token };
      save("auth", auth);
      $("login-pass").value = $("login-code").value = "";
      stopPairing();
      $("setup").hidden = true;
      connect();
    } catch (e) {
      flow = null;
      $("login-code").hidden = true; $("login-user").hidden = false; $("login-pass").hidden = false;
      setupMessage(t("loginFailed"), true);
      focus($("login-pass"));
    }
  }

  $("server-form").onsubmit = e => { e.preventDefault(); pickServer($("server-url").value); };
  $("login-form").onsubmit = e => { e.preventDefault(); login(); };
  $("login-back").onclick = () => showSetup();
  $("demo-btn").onclick = () => { auth = { url: DEMO_URL, token: "demo" }; save("auth", auth); stopPairing(); $("setup").hidden = true; connect(); };

  // Ready-made sign-in via launch parameters, e.g. ares-launch -p '{"url":"…","token":"…"}'
  function provision(params) {
    const url = normalizeUrl(params.url);
    if (!url || !params.token) return false;
    auth = { url, token: String(params.token) };
    save("auth", auth);
    return true;
  }

  // ---- setting up Home Assistant from the TV: the TV integration, scripts and blueprints ----

  async function haRest(method, path, body) {
    const r = await http(auth.url + path, { method, headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) }, 120000);
    if (r.status === 401 || r.status === 403) throw new Error(t("needsAdmin"));
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.status === 204 ? null : r.json();
  }

  const tvEntities = () => Object.keys(reg).filter(id => domainOf(id) === "media_player" && reg[id].platform === "webostv" && states[id]);
  const chosenTv = () => (cfg.tv && states[cfg.tv] ? cfg.tv : tvEntities()[0]) || "";

  // Adds this TV to Home Assistant through the webOS TV integration's own config flow. The TV asks the user to accept the connection.
  async function addTv() {
    if (isDemo()) return toast(t("notInDemo"));
    if (haBusy) return;
    const net = await luna("luna://com.webos.service.connectionmanager/getStatus");
    const ip = (net.wired && net.wired.ipAddress) || (net.wifi && net.wifi.ipAddress);
    if (!ip) return toast(t("tvNoIp"));
    haBusy = "tv"; renderMain();
    try {
      let step = await haRest("POST", "/api/config/config_entries/flow", { handler: "webostv", show_advanced_options: false });
      for (let i = 0; i < 4 && step && step.type === "form"; i++) {
        if (step.step_id === "pairing") toast(t("tvAdding"), true);
        const data = {};
        (step.data_schema || []).forEach(f => { if (f.name === "host") data.host = ip; });
        step = await haRest("POST", "/api/config/config_entries/flow/" + step.flow_id, data);
      }
      if (!step || step.type !== "create_entry") throw new Error(step && (step.reason || step.type) || "?");
      haDone.tv = true;
      toast(t("tvAdded"), true);
      const entList = await send({ type: "config/entity_registry/list" }).catch(() => []); // the new entities
      entList.forEach(e => { reg[e.entity_id] = e; });
    } catch (e) { toast(t("tvFailed", (e && e.message) || "?")); }
    haBusy = ""; renderMain();
  }

  async function createScripts() {
    if (isDemo()) return toast(t("notInDemo"));
    const tv = chosenTv();
    if (!tv) return toast(t("tvMissing"));
    haBusy = "scripts"; renderMain();
    try {
      const scripts = haScripts(tv), names = [];
      for (const id of Object.keys(scripts)) { await haRest("POST", "/api/config/script/config/" + id, scripts[id]); names.push(scripts[id].alias.replace("HomeDash: ", "")); }
      haDone.scripts = true;
      toast(t("scriptsDone", names.join(", ")), true);
    } catch (e) { toast((e && e.message) || t("failed")); }
    haBusy = ""; renderMain();
  }

  async function saveBlueprints() {
    if (isDemo()) return toast(t("notInDemo"));
    haBusy = "blueprints"; renderMain();
    try {
      for (const path of Object.keys(HA_BLUEPRINTS)) await send({ type: "blueprint/save", domain: "automation", path, yaml: HA_BLUEPRINTS[path], allow_override: true });
      haDone.blueprints = true;
      toast(t("blueprintsDone"), true);
    } catch (e) { toast((e && (e.message || e.code)) === "unauthorized" ? t("needsAdmin") : (e && e.message) || t("failed")); }
    haBusy = ""; renderMain();
  }

  // ---- pages ----

  function resetHome() {
    homeSet = new Set(Object.values(states).filter(onHome).map(s => s.entity_id));
  }

  function actionTile(key, label, sub, on, run) {
    const b = el("button", { className: "tile dev action" + (on ? " on" : ""), onclick: run });
    b.dataset.key = key;
    b.append(el("span", { className: "name", textContent: label }), el("small", { textContent: sub }));
    return b;
  }

  const option = (key, label, values, format, run) => actionTile("set:" + key, label, format(cfg[key]), false, () => {
    cfg[key] = nextOption(values, cfg[key]); saveSettings(); if (run) run(); renderMain();
  });
  const rerender = () => { resetHome(); renderRail(); renderMain(); };

  function settingsSections() {
    const count = {}; // every type present in this installation
    Object.values(states).forEach(s => { const d = domainOf(s.entity_id); if (d !== "camera" && d !== "weather" && isVisible(s, reg[s.entity_id], [d])) count[d] = (count[d] || 0) + 1; });
    const hiddenIds = cfg.hidden.filter(id => states[id]);
    const menu = {
      look: [t("look"), () => [
        ...THEMES.map(k => actionTile("theme:" + k, TEXT[LANG].themes[k], t("theme"), cfg.theme === k, () => { cfg.theme = k; saveSettings(); renderMain(); })),
        // language is read at startup, so the app reloads after a change
        actionTile("lang", t("language"), LANG_OVERRIDE ? LANGUAGE_NAMES[LANG] : t("languageAuto"), false, () => {
          const all = ["", ...Object.keys(TEXT)], next = all[(all.indexOf(LANG_OVERRIDE) + 1) % all.length];
          try { next ? localStorage.setItem("lang", next) : localStorage.removeItem("lang"); } catch (e) {}
          location.reload();
        }),
      ]],
      show: [t("show"), () => Object.keys(count).sort(byRank).map(d => actionTile("show:" + d, title(d), count[d] + " · " + t(cfg.domains.includes(d) ? "shown" : "hidden"), cfg.domains.includes(d), () => {
        cfg.domains = cfg.domains.includes(d) ? cfg.domains.filter(x => x !== d) : [...cfg.domains, d];
        saveSettings(); rerender();
      }))],
      hiddenOnes: [t("hiddenOnes"), () => hiddenIds.map(id => actionTile("unhide:" + id, nameOf(states[id]), t("showAgain"), false, () => {
        cfg.hidden = cfg.hidden.filter(x => x !== id);
        saveSettings(); rerender();
      }))],
      overTv: [t("overTv"), () => [
        option("startMenu", t("startWith"), [false, true], v => t(v ? "quickMenu" : "fullApp")),
        option("side", t("menuSide"), ["right", "left"], v => t(v)),
      ]],
      weather: [t("weatherSource"), () => [
        actionTile("weather:", t("weatherAuto"), t("weatherAutoInfo"), !cfg.weather, () => { cfg.weather = ""; saveSettings(); renderMain(); updateClock(); subscribeForecast(); }),
        ...weatherAll().map(w => actionTile("weather:" + w.entity_id, nameOf(w), stateText(w, reg[w.entity_id], tr), cfg.weather === w.entity_id, () => { cfg.weather = w.entity_id; saveSettings(); renderMain(); updateClock(); subscribeForecast(); })),
      ]],
      hotkeys: [t("hotkeys"), () => pickingKey != null
        ? [actionTile("key:none", t("clearKey"), "", !cfg.keys[pickingKey], () => assignKey(pickingKey, null)),
           ...visible().filter(x => isCam(x) || action(x)).sort(favFirst).map(x => actionTile("key:" + x.entity_id, nameOf(x), title(domainOf(x.entity_id)), cfg.keys[pickingKey] === x.entity_id, () => assignKey(pickingKey, x.entity_id)))]
        : HOTKEYS.map(([code, name]) => actionTile("hotkey:" + code, keyName(name), cfg.keys[code] && states[cfg.keys[code]] ? nameOf(states[cfg.keys[code]]) : t("noHotkey"), !!cfg.keys[code], () => { pickingKey = code; renderMain(); focusMain(); }))],
      ha: [t("haSection"), () => {
        const tvs = tvEntities(), tv = chosenTv();
        return [
          ...(tvs.length > 1 ? tvs.map(id => actionTile("tv:" + id, nameOf(states[id]), t("chooseTv"), tv === id, () => { cfg.tv = id; saveSettings(); renderMain(); })) : []),
          actionTile("ha:tv", t("tvInHa"), haBusy === "tv" ? t("tvAdding") : tv ? nameOf(states[tv]) : t("tvMissing"), !!tv, () => { if (!tv) addTv(); }),
          actionTile("ha:scripts", t("scripts"), haBusy === "scripts" ? "…" : haDone.scripts ? t("scriptsDone", 3) : t("scriptsCreate"), !!haDone.scripts, createScripts),
          actionTile("ha:blueprints", t("blueprints"), haBusy === "blueprints" ? "…" : haDone.blueprints ? t("blueprintsDone") : t("blueprintsCreate"), !!haDone.blueprints, saveBlueprints),
        ];
      }],
      saver: [t("saver"), () => [
        option("saverAfter", t("saverAfter"), SAVER_AFTER, v => v ? t("minutes", v) : t("saverOff"), idle),
        option("saverContent", t("saverContent"), ["cameras", "clock"], v => t(v === "clock" ? "saverClock" : "saverCameras")),
        option("saverInterval", t("saverInterval"), SAVER_INTERVAL, v => t("seconds", v)),
        option("saverEffect", t("saverEffect"), ["slide", "fade"], v => t(v)),
        actionTile("saverNow", t("saverNow"), "", false, openSaver),
      ]],
      account: [t("account"), () => [actionTile("logout", t("logout"), auth ? auth.url.replace(/^https?:\/\//, "") : "", false, () => {
        if (auth && auth.refresh_token) postForm(auth.url + "/auth/token", { action: "revoke", token: auth.refresh_token }).catch(() => {});
        signOut();
      })]],
    };
    if (!OVERLAY_WINDOW) delete menu.overTv;
    if (settingsSection === "hotkeys") {
      const key = HOTKEYS.find(([c]) => c === pickingKey);
      return [[key ? t("pickFor", keyName(key[1])) : t("hotkeys") + " · " + (lastKey != null ? t("lastKey", lastKey) : t("hotkeyInfo")), menu.hotkeys[1](), "grid"]];
    }
    if (settingsSection && menu[settingsSection]) return [[menu[settingsSection][0], menu[settingsSection][1](), "grid"]];
    const summary = { look: TEXT[LANG].themes[cfg.theme] || "", show: t("typesShown", cfg.domains.filter(d => count[d]).length), hiddenOnes: hiddenIds.length ? t("nHidden", hiddenIds.length) : t("nothing"),
      overTv: t(cfg.startMenu ? "quickMenu" : "fullApp"), weather: weatherEntity() ? nameOf(weatherEntity()) : t("noWeather"),
      hotkeys: t("nOn", Object.keys(cfg.keys).filter(k => cfg.keys[k]).length),
      ha: chosenTv() ? nameOf(states[chosenTv()]) : t("tvMissing"),
      saver: cfg.saverAfter ? t("minutes", cfg.saverAfter) : t("saverOff"), account: auth ? auth.url.replace(/^https?:\/\//, "") : "" };
    return [[t("settings"), Object.keys(menu).map(k => actionTile("settings:" + k, menu[k][0], summary[k], false, () => { settingsSection = k; renderMain(); focusMain(); })), "grid"]];
  }

  // same shape as a camera tile, so the arrow keys move correctly in the grid
  function wallTile(n) {
    const b = el("button", { className: "tile cam wall", innerHTML: svg("grid"), onclick: openWall });
    b.dataset.key = "wall";
    b.append(el("span", { className: "name", textContent: t("wall") + " · " + n }));
    return b;
  }

  const keyName = name => /^\d$/.test(name) ? name : t(name);

  function assignKey(code, id) {
    if (id) cfg.keys[code] = id; else delete cfg.keys[code];
    saveSettings();
    pickingKey = null;
    renderMain();
    focus([...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "hotkey:" + code));
  }

  // a mapped button does the same as OK on the tile, wherever you are in the app
  function hotkey(code) {
    const id = cfg.keys[code];
    if (!id || !states[id] || inSetup() || dimming) return false;
    if (saverOn) closeSaver();
    if (mode !== "full") { hideNotice(); closeMenu(); setMode("full"); }
    activate(id);
    return true;
  }

  function sections() {
    if (page === "settings") return settingsSections();
    const all = visible(), cams = all.filter(isCam), images = all.filter(isImage).sort((a, b) => (Date.parse(b.state) || 0) - (Date.parse(a.state) || 0));
    const devs = all.filter(s => !isCam(s) && !isImage(s)), fav = s => cfg.favorites.includes(s.entity_id);
    cams.sort(favFirst); // the sort is stable, so the name order is kept within favorites and the rest
    if (page === "home") return [[t("cameras"), cams.map(tile), "row"], [t("forecast"), forecast.map(forecastTile), "grid"],
      [t("scenes"), devs.filter(s => domainOf(s.entity_id) === "scene").map(tile), "grid"], [t("favorites"), devs.filter(fav).map(tile), "grid"],
      [t("onNow"), devs.filter(s => homeSet.has(s.entity_id) && !fav(s)).map(tile), "grid"]];
    if (page === "cameras") return [[t("cameras"), [...(cams.length > 1 ? [wallTile(cams.length)] : []), ...cams.map(tile)], "grid cams"],
      [t("latestImages"), images.map(tile), "grid cams"]];
    const here = s => roomOf(s.entity_id) === page;
    const mine = devs.filter(here);
    return [[t("cameras"), cams.filter(here).map(tile), "grid cams"], [t("latestImages"), images.filter(here).map(tile), "grid cams"],
      ...[...new Set(mine.map(s => domainOf(s.entity_id)))].sort(byRank).map(d => [title(d), mine.filter(s => domainOf(s.entity_id) === d).map(tile), "grid"])];
  }

  function go(id) {
    if (page === id) return;
    page = id;
    settingsSection = null; pickingKey = null;
    save("page", id);
    if (id === "home") resetHome();
    document.querySelectorAll(".rail-item").forEach(b => b.classList.toggle("active", b.dataset.page === id));
    renderMain();
    $("main").scrollTop = 0;
  }

  function renderRail() {
    const rail = $("rail"), hadFocus = document.activeElement.dataset.page;
    const used = new Set(visible().map(s => roomOf(s.entity_id)));
    const items = [["home", t("home")], ["cameras", t("cameras")],
      ...areas.filter(a => used.has("room:" + a.area_id)).sort((a, b) => a.name.localeCompare(b.name, LANG)).map(a => ["room:" + a.area_id, a.name])];
    if (used.has("room:")) items.push(["room:", t("other")]);
    items.push(["settings", t("settings")]);
    if (!items.some(i => i[0] === page)) page = "home";
    const key = JSON.stringify([items, page]);
    if (key === railKey && rail.firstChild) return updateRail(); // the menu is unchanged, keep the buttons
    railKey = key;
    rail.textContent = "";
    items.forEach(([id, label]) => {
      const b = el("button", { className: "rail-item" + (id === page ? " active" : ""), onfocus: () => go(id), onclick: () => { go(id); focusMain(); } });
      b.dataset.page = id;
      b.append(el("span", { textContent: label }), el("small"));
      rail.append(b);
    });
    updateRail();
    if (hadFocus) focusRail();
  }

  function updateRail() {
    const on = {};
    Object.values(states).forEach(s => { if (onHome(s)) on[roomOf(s.entity_id)] = (on[roomOf(s.entity_id)] || 0) + 1; });
    const total = Object.values(on).reduce((a, b) => a + b, 0);
    document.querySelectorAll(".rail-item").forEach(b => {
      const n = b.dataset.page === "home" ? total : on[b.dataset.page];
      b.querySelector("small").textContent = n ? t("nOn", n) : "";
    });
  }

  function renderMain() {
    const main = $("main"), key = document.activeElement.dataset.key, top = main.scrollTop;
    main.textContent = "";
    sections().forEach(([title, list, cls]) => {
      if (!list.length) return;
      const box = el("div", { className: cls });
      box.append(...list);
      main.append(el("h2", { textContent: title }), box);
    });
    if (!main.firstChild) main.append(el("p", { className: "empty", textContent: t("empty") }));
    main.scrollTop = top;
    if (!key || (viewing && !pip) || inSetup()) return;
    const same = [...main.querySelectorAll(".tile")].find(x => x.dataset.key === key);
    if (same) same.focus({ preventScroll: true }); else focusMain() || focusRail();
  }

  // tiles are reused between renders so camera images do not flicker
  function tile(s) {
    const id = s.entity_id;
    let b = tiles[id];
    if (!b) {
      b = tiles[id] = el("button", { className: "tile " + (isCam(s) || isImage(s) ? "cam" : "dev") });
      b.dataset.id = b.dataset.key = id;
      if (isCam(s) || isImage(s)) {
        const img = el("img");
        img.onerror = () => img.removeAttribute("src"); // black box instead of a broken-image icon
        img.src = isCam(s) ? snapshot(id) : picture(id);
        b.append(img);
      } else b.innerHTML = svg(iconOf(s));
      b.append(el("span", { className: "name" }));
      if (!isCam(s)) b.append(el("small"));
      b.onmousedown = () => pressStart(id);
      b.onmouseup = pressEnd;
      b.onmouseleave = () => { clearTimeout(pressTimer); pressed = pressTimer = null; };
    }
    update(b, s);
    return b;
  }

  function update(b, s) {
    b.querySelector(".name").textContent = nameOf(s);
    if (isCam(s)) return;
    if (isImage(s)) { // a new image has a new timestamp as its state
      b.querySelector("small").textContent = stateText(s, reg[s.entity_id], tr);
      const img = b.querySelector("img"), src = picture(s.entity_id);
      if (img.getAttribute("src") !== src) img.src = src;
      return;
    }
    const icon = ICONS[iconOf(s)], path = b.querySelector("path");
    if (path.getAttribute("d") !== icon) path.setAttribute("d", icon);
    b.classList.toggle("on", isActive(s));
    b.classList.toggle("readonly", !action(s) && !slider(s));
    const art = domainOf(s.entity_id) === "media_player" && ["playing", "paused"].includes(s.state) && s.attributes.entity_picture;
    b.style.backgroundImage = art ? `linear-gradient(#0008, #000c), url("${auth.url + art}")` : "";
    b.classList.toggle("art", !!art);
    b.querySelector("small").textContent = stateText(s, reg[s.entity_id], tr);
  }

  // ---- press: short = on/off, long = panel with sliders (brightness, temperature, volume …), favorite and hide ----

  function pressStart(id) {
    clearTimeout(pressTimer);
    pressed = id;
    pressTimer = setTimeout(() => { pressTimer = null; if (states[id]) openDimmer(id); }, LONG_PRESS_MS);
  }

  function pressEnd() {
    const id = pressed;
    pressed = null;
    if (!id || !pressTimer) return;
    clearTimeout(pressTimer); pressTimer = null;
    activate(id);
  }

  function call(domain, service, id, data) {
    send({ type: "call_service", domain, service, service_data: data || {}, target: { entity_id: id } })
      .catch(err => toast((err && err.message) || t("failed")));
  }

  function activate(id) {
    const s = states[id], act = s && action(s);
    if (!s) return;
    if (isCam(s) || isImage(s)) return openCamera(id);
    if (!act) return;
    if (act.confirm && confirming !== id) { // locks and gates need two presses
      confirming = id;
      clearTimeout(confirmTimer); confirmTimer = setTimeout(() => { confirming = null; }, 4000);
      return toast(t(act.confirm, nameOf(s)), true);
    }
    confirming = null;
    call(act.domain, act.service, id, act.data);
  }

  // ---- on top of TV: notification, pinned camera and quick menu ----
  // The app window is transparent and sits on top of whatever is showing. In "full" mode the app covers the whole screen,
  // in "notice" and "menu" modes only the card or the menu is drawn and the rest of the TV picture shows through.

  function setMode(next) {
    mode = OVERLAY_WINDOW ? next : "full"; // without an overlay window everything is shown inside the app
    document.body.className = mode;
  }

  function exitApp() {
    if (ws) { ws.onclose = null; ws.close(); }
    gen++;
    window.close();
  }

  function showNotice(p) {
    const seconds = isNum(p.timeout) ? Number(p.timeout) : NOTICE_SECONDS, card = $("card");
    notice = { camera: typeof p.camera === "string" && p.camera ? p.camera : null, image: typeof p.image === "string" ? p.image : null, named: p.title != null && p.title !== "" || p.message != null && p.message !== "" };
    card.className = CORNERS.includes(p.position) ? p.position : CORNERS[0];
    $("card-title").textContent = p.title == null ? "" : String(p.title);
    // The HA script run without any fields: show something, otherwise it looks like nothing happened
    $("card-msg").textContent = p.message != null && p.message !== "" ? String(p.message) : notice.named || notice.camera || notice.image ? "" : t("testNotice");
    $("card-time").textContent = new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    notice.actions = Array.isArray(p.actions) ? p.actions.filter(x => x && typeof x === "object" && x.label).slice(0, 4) : [];
    const box = $("card-actions");
    box.textContent = "";
    notice.actions.forEach((x, i) => box.append(el("button", { textContent: String(x.label), onclick: () => runAction(x) })));
    if (notice.actions.length && notice.camera) box.append(el("button", { textContent: t("openAction"), onclick: expandNotice }));
    box.hidden = !box.firstChild;
    $("card-hint").textContent = box.firstChild ? t("panelHint").replace(t("dimmerHint").split(" · ").pop(), "") + " · " + t("noticeHint") : t(notice.camera ? "noticeCamHint" : "noticeHint");
    if (box.firstChild && mode !== "full") setTimeout(() => box.firstChild.focus(), 50);
    $("card-media").hidden = true;
    $("card-img").removeAttribute("src");
    const bar = $("card-bar");
    bar.style.animation = "none"; void bar.offsetWidth; // restarts the countdown
    bar.style.animation = seconds > 0 ? `countdown ${seconds}s linear forwards` : "none";
    bar.hidden = seconds <= 0;
    card.hidden = false;
    clearTimeout(noticeTimer);
    if (seconds > 0) noticeTimer = setTimeout(endNotice, seconds * 1000); // 0 = stays until Back is pressed
    noticeImage();
  }

  function noticeImage() {
    const img = $("card-img"), s = notice.camera && states[notice.camera];
    img.onload = () => { $("card-media").hidden = false; };
    img.onerror = () => { $("card-media").hidden = true; };
    if (notice.image && /^(https?:|data:)/.test(notice.image)) img.src = notice.image;
    else if (notice.image && notice.image[0] === "/" && auth) img.src = auth.url + notice.image;
    else if (s) {
      // MJPEG in an <img> instead of video, so the TV's video decoder is not taken away from what is playing. Lower frame rate.
      img.src = stream(notice.camera);
      $("card-live").textContent = t("live") + " · " + nameOf(s);
      if (!notice.named) $("card-title").textContent = nameOf(s);
    }
    $("card-live").hidden = !s;
  }

  // button in a notification: a service in HA, or a "homedash_action" event an automation can listen for
  function runAction(x) {
    if (typeof x.service === "string" && x.service.includes(".")) {
      const [domain, service] = x.service.split(".");
      send({ type: "call_service", domain, service, service_data: x.data || {}, target: x.entity_id ? { entity_id: x.entity_id } : undefined }).catch(err => toast((err && err.message) || t("failed")));
    } else send({ type: "fire_event", event_type: "homedash_action", event_data: Object.assign({ action: String(x.event || x.label) }, x.data || {}) }).catch(() => {});
    endNotice();
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    notice = null;
    $("card").hidden = true;
    $("card-img").removeAttribute("src");
  }

  function endNotice() {
    hideNotice();
    if (mode === "notice") exitApp(); // back to what was playing
  }

  function expandNotice() {
    const camera = notice && notice.camera;
    hideNotice();
    setMode("full");
    if (camera && states[camera]) openCamera(camera); else focusMain() || focusRail();
  }

  function pinCamera(id) {
    if (!OVERLAY_WINDOW) return;
    closeCamera();
    closeDimmer();
    setMode("notice");
    showNotice({ camera: id, timeout: 0 });
  }

  function updateRow(b, s) {
    b.querySelector("path").setAttribute("d", ICONS[isCam(s) ? "cast" : iconOf(s)]);
    b.querySelector("span").textContent = nameOf(s);
    b.querySelector("small").textContent = isCam(s) ? "" : stateText(s, reg[s.entity_id], tr);
    b.classList.toggle("on", !isCam(s) && isActive(s));
  }

  function renderMenu() {
    const list = $("drawer-list"), had = menuTouched && document.activeElement.dataset.row; // focus is not moved for someone who has already started choosing
    const favs = cfg.favorites.map(id => states[id]).filter(s => s && s.state !== "unavailable").sort(byName);
    Object.keys(rows).forEach(k => delete rows[k]);
    list.textContent = "";
    favs.forEach(s => {
      const b = rows[s.entity_id] = el("button", { className: "fav", innerHTML: svg("bookmark"), onclick: () => menuPick(s.entity_id) });
      b.dataset.row = s.entity_id;
      b.append(el("span"), el("small"));
      updateRow(b, s);
      list.append(b);
    });
    const open = el("button", { className: "fav open", innerHTML: svg("home"), onclick: () => { closeMenu(); setMode("full"); focusMain() || focusRail(); } });
    open.dataset.row = "open";
    open.append(el("span", { textContent: t("openApp") }), el("small"));
    list.append(open);
    $("drawer").className = cfg.side;
    $("drawer-info").textContent = favs.length || !Object.keys(states).length ? "" : t("noFavorites");
    menuReady = true;
    ([...list.children].find(x => x.dataset.row === had) || list.firstChild).focus();
  }

  function openMenu() {
    hideNotice();
    setMode("menu");
    menuTouched = false;
    $("drawer").hidden = false;
    renderMenu();
    menuIdle();
  }

  function closeMenu() {
    clearTimeout(menuTimer);
    menuReady = false;
    $("drawer").hidden = true;
  }

  function menuIdle() {
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => { if (mode === "menu") exitApp(); }, MENU_IDLE_MS);
  }

  function menuPick(id) {
    const s = states[id];
    if (!s) return;
    if (isCam(s)) { closeMenu(); setMode("notice"); return showNotice({ camera: id, timeout: 0 }); }
    const act = action(s);
    if (!act) return;
    if (act.confirm && confirming !== id) { // locks and gates need two presses
      confirming = id;
      clearTimeout(confirmTimer); confirmTimer = setTimeout(() => { confirming = null; $("drawer-info").textContent = ""; }, 4000);
      return void ($("drawer-info").textContent = t(act.confirm, nameOf(s)));
    }
    confirming = null; $("drawer-info").textContent = "";
    call(act.domain, act.service, id, act.data);
  }

  // What to show, based on launch parameters. running = the app was already running.
  function route(p, running) {
    if (!auth) return setMode("full");
    if (isNotice(p)) { if (!running) setMode("notice"); return showNotice(p); }
    if (p.camera) {
      hideNotice(); closeMenu(); closeDimmer(); setMode("full");
      if (states[p.camera]) openCamera(p.camera); else wanted = p.camera;
      return;
    }
    if (p.saver) { // e.g. an HA automation that starts the screensaver when nobody is watching
      hideNotice(); closeMenu(); setMode("full");
      saverLaunched = !running;
      if (Object.keys(states).length) openSaver(); else wanted = "saver";
      return;
    }
    if (p.menu || (!running && cfg.startMenu && OVERLAY_WINDOW && cfg.favorites.length)) return openMenu();
    if (mode !== "full") { hideNotice(); closeMenu(); setMode("full"); focusMain() || focusRail(); }
  }

  // ---- panel for one entity (long press): sliders, options, buttons, PIN, history, favorite and hide ----

  const fmtValue = (row, v) => row.unit === "%" && !v && row.key === "main" && domainOf(dimming) !== "number" ? t("off") : withUnit(num(v), row.unit);

  function sliderRow(row) {
    const r = el("div", { className: "prow slider", tabIndex: 0 });
    r.dataset.key = row.key;
    r.append(el("label", { textContent: row.label }), el("i", { className: "bar", innerHTML: "<b class='fill'></b>" }), el("span", { className: "val" }));
    r.onclick = e => { const b = r.querySelector(".bar").getBoundingClientRect(); if (e.clientX >= b.left && e.clientX <= b.right) setSlider(row, row.min + (e.clientX - b.left) / b.width * (row.max - row.min)); };
    row.el = r;
    showSlider(row, row.value);
    return r;
  }

  function showSlider(row, v) {
    row.value = snap(row, v);
    row.el.querySelector(".fill").style.width = (row.value - row.min) / (row.max - row.min) * 100 + "%";
    row.el.querySelector(".val").textContent = fmtValue(row, row.value);
  }

  function setSlider(row, v) {
    showSlider(row, v);
    clearTimeout(row.timer);
    const id = dimming, request = row.call(row.value);
    row.timer = setTimeout(() => { row.timer = null; call(request[0], request[1], id, request[2]); }, 200); // quick steps are merged
  }

  function optionRow(row) {
    const r = el("div", { className: "prow option", tabIndex: 0 });
    r.dataset.key = row.key;
    r.append(el("label", { textContent: row.label }), el("span", { className: "val" }));
    row.el = r;
    showOption(row);
    return r;
  }

  const showOption = row => { row.el.querySelector(".val").textContent = "◀  " + optionText(domainOf(dimming), row.attr, row.value, tr) + "  ▶"; };

  function setOption(row, dir) {
    row.value = nextOption(dir > 0 ? row.values : [...row.values].reverse(), row.value);
    showOption(row);
    const request = row.call(row.value);
    call(request[0], request[1], dimming, request[2]);
  }

  function buttonsRow(spec) {
    const r = el("div", { className: "prow buttons" });
    spec.buttons.forEach(b => r.append(el("button", { textContent: b.label, onclick: () => { const q = b.call(panelCode || undefined); call(q[0], q[1], dimming, q[2]); panelCode = ""; showCode(); } })));
    return r;
  }

  // PIN for alarms, entered with the remote
  function codeRow() {
    const r = el("div", { className: "prow pad" });
    r.append(el("b", { className: "code" }), el("div", { className: "keys" }));
    "1234567890⌫".split("").forEach(k => r.querySelector(".keys").append(el("button", { textContent: k, onclick: () => { panelCode = k === "⌫" ? panelCode.slice(0, -1) : panelCode + k; showCode(); } })));
    return r;
  }
  const showCode = () => { const c = document.querySelector("#dimmer-rows .code"); if (c) c.textContent = t("code") + ": " + "•".repeat(panelCode.length); };

  // simple curve for the last 24 hours, fetched from HA's history
  async function chartRow(id) {
    const r = el("div", { className: "prow chart" });
    r.append(el("label", { textContent: t("history") }));
    const start = new Date(Date.now() - 86400000).toISOString();
    try {
      const h = await send({ type: "history/history_during_period", start_time: start, entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false });
      const pts = ((h && h[id]) || []).map(p => [p.lu, Number(p.s)]).filter(p => isFinite(p[1]));
      if (dimming !== id || pts.length < 2) return;
      const W = 900, H = 140, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
      const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), span = hi - lo || 1;
      const path = pts.map((p, i) => (i ? "L" : "M") + ((p[0] - t0) / (t1 - t0) * W).toFixed(1) + " " + (H - (p[1] - lo) / span * (H - 10) - 5).toFixed(1)).join(" ");
      const unit = (states[id].attributes.unit_of_measurement || "");
      r.innerHTML += `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="currentColor" stroke-width="3"/></svg>` +
        `<span class="lo">${withUnit(num(lo, 1), unit)}</span><span class="hi">${withUnit(num(hi, 1), unit)}</span>`;
      return r;
    } catch (e) { return null; }
  }

  function openDimmer(id) {
    if (!dimming) lastFocus = document.activeElement;
    dimming = id; dimArmed = false; panelCode = "";
    const s = states[id], spec = panelSpec(s), box = $("dimmer-rows");
    $("dimmer-name").textContent = nameOf(s);
    $("dimmer-state").textContent = isCam(s) ? "" : stateText(s, reg[id], tr);
    box.textContent = "";
    panelRows = [...spec.sliders.map(x => Object.assign({ kind: "slider" }, x)), ...spec.options.map(x => Object.assign({ kind: "option" }, x))];
    panelRows.forEach(row => box.append(row.kind === "slider" ? sliderRow(row) : optionRow(row)));
    if (spec.code) box.append(codeRow());
    if (spec.buttons.length) box.append(buttonsRow(spec));
    if (spec.history) { // the curve is fetched in the background and replaces the placeholder
      box.append(el("div", { className: "prow chart" }));
      chartRow(id).then(r => { const old = box.querySelector(".chart"); if (r && old && dimming === id) old.replaceWith(r); else if (old) old.remove(); });
    }
    showCode();
    $("fav-btn").textContent = t(cfg.favorites.includes(id) ? "removeFavorite" : "addFavorite");
    $("dimmer-hint").textContent = t(panelRows.length ? "dimmerHint" : "panelHint");
    $("dimmer").hidden = false;
    (box.querySelector("[tabindex], button") || $("fav-btn")).focus();
  }

  // the entity changed while the panel is open: update what is not currently being adjusted
  function refreshPanel() {
    const s = states[dimming], spec = panelSpec(s);
    $("dimmer-state").textContent = stateText(s, reg[dimming], tr);
    panelRows.forEach(row => {
      const fresh = (row.kind === "slider" ? spec.sliders : spec.options).find(x => x.key === row.key);
      if (!fresh || row.timer) return;
      row.value = fresh.value;
      if (row.kind === "slider") showSlider(row, fresh.value); else showOption(row);
    });
  }

  function closeDimmer() {
    if (!dimming) return;
    panelRows.forEach(row => clearTimeout(row.timer));
    dimming = null; panelRows = [];
    $("dimmer").hidden = true;
    focus(fallbackFocus());
  }

  $("dimmer").onclick = e => { if (e.target === $("dimmer")) closeDimmer(); };
  $("fav-btn").onclick = () => {
    const id = dimming;
    cfg.favorites = cfg.favorites.includes(id) ? cfg.favorites.filter(x => x !== id) : [...cfg.favorites, id];
    saveSettings();
    closeDimmer();
    renderMain();
  };
  $("hide-btn").onclick = () => {
    const id = dimming, name = nameOf(states[id]);
    cfg.hidden = [...cfg.hidden, id]; cfg.favorites = cfg.favorites.filter(x => x !== id);
    saveSettings();
    if (viewing === id) closeCamera();
    closeDimmer();
    resetHome(); renderRail(); renderMain();
    if (!document.activeElement.dataset.key && !document.activeElement.dataset.page) focusMain() || focusRail();
    toast(t("hiddenInfo", name), true);
  };

  // keys in the panel: up/down between rows, left/right adjusts or moves within the row
  function panelKey(k, dir, back, e) {
    const a = document.activeElement, rowEl = a.closest("#dimmer .prow, #dimmer-actions"), ready = dimArmed && !e.repeat; // OK is still held down when the panel opens
    const row = panelRows.find(x => x.el === a);
    if (k === 13 && ready && a.tagName === "BUTTON") return; // the button clicks itself
    e.preventDefault();
    if (back || (k === 13 && ready)) return closeDimmer();
    if (!dir) return;
    if (row && (dir === "left" || dir === "right")) return row.kind === "slider" ? setSlider(row, stepValue(row, row.value, dir === "right" ? 1 : -1)) : setOption(row, dir === "right" ? 1 : -1);
    if (!row && (dir === "left" || dir === "right")) {
      const siblings = rowEl ? [...rowEl.querySelectorAll("button")] : [], i = siblings.indexOf(a);
      return focus(siblings[dir === "right" ? Math.min(i + 1, siblings.length - 1) : Math.max(i - 1, 0)]);
    }
    const rowsAll = [...document.querySelectorAll("#dimmer-rows .prow"), $("dimmer-actions")].filter(x => x.matches("[tabindex]") || x.querySelector("button"));
    const i = rowsAll.indexOf(rowEl), next = rowsAll[dir === "down" ? i + 1 : i - 1];
    if (next) focus(next.matches("[tabindex]") ? next : next.querySelector("button"));
  }

  // ---- camera view ----

  const canPtz = id => !!(reg[id] && ptzCall(reg[id].platform, services, "left"));
  const viewerHint = () => { $("viewer-hint").textContent = ptz ? t("ptzHint") : t("viewerHint") + (viewing && canPtz(viewing) ? " · " + t("viewerPtz") : ""); };

  async function openCamera(id) {
    if (!states[id]) return toast(t("notFound", id));
    const video = $("video"), img = $("mjpeg");
    if (!viewing) lastFocus = document.activeElement;
    viewing = id; ptz = false;
    $("viewer-name").textContent = nameOf(states[id]);
    $("viewer").hidden = false;
    setPip(false);
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    video.hidden = true; img.hidden = false;
    img.removeAttribute("src");
    viewerHint();
    if (isImage(states[id])) { img.src = picture(id); return; } // still image from an image entity
    video.poster = snapshot(id);
    video.hidden = false; img.hidden = true;
    // MJPEG works for every camera and is used when HLS is missing or cannot be played
    const mjpeg = () => {
      if (viewing !== id) return;
      video.hidden = true; img.hidden = false;
      img.src = stream(id);
    };
    try {
      const stream = await send({ type: "camera/stream", entity_id: id });
      if (viewing !== id) return;
      video.onerror = mjpeg;
      // webOS plays the media playlist directly but cannot handle HA's master playlist
      video.src = auth.url + stream.url.replace("master_playlist.m3u8", "playlist.m3u8");
      video.play().catch(() => {});
    } catch (e) { mjpeg(); }
  }

  function setPip(on) {
    if (pip && !on && document.activeElement !== document.body) lastFocus = document.activeElement;
    pip = on;
    $("viewer").classList.toggle("pip", on);
    $("video").muted = on;
    if (on) focus(fallbackFocus()); else document.activeElement.blur();
  }

  function closeCamera() {
    const video = $("video"), wasFull = !pip;
    viewing = null; pip = false; ptz = false;
    video.onerror = null;
    video.removeAttribute("src"); video.load();
    $("mjpeg").removeAttribute("src");
    $("viewer").hidden = true;
    $("viewer").classList.remove("pip");
    if (wasFull) focus(fallbackFocus());
  }

  $("viewer").onclick = () => setPip(!pip);

  // ---- camera wall: several cameras live at once ----

  function openWall() {
    if (viewing) closeCamera();
    wallOpen = true;
    lastFocus = document.activeElement;
    $("wall").hidden = false;
    $("wall-hint").textContent = t("wallHint");
    document.activeElement.blur();
    renderWall(0);
  }

  // MJPEG in <img> for every cell. The TV's decoder cannot handle real video in six cells at once.
  function renderWall(p) {
    const cams = camIds(), pages = Math.max(1, Math.ceil(cams.length / WALL_SIZE));
    wallPage = (p + pages) % pages;
    const grid = $("wall-grid");
    grid.textContent = "";
    cams.slice(wallPage * WALL_SIZE, wallPage * WALL_SIZE + WALL_SIZE).forEach(id => {
      const cell = el("div", { className: "cell" });
      const img = el("img", { src: stream(id) });
      cell.append(img, el("span", { textContent: nameOf(states[id]) }));
      grid.append(cell);
    });
    grid.dataset.count = Math.min(WALL_SIZE, cams.length - wallPage * WALL_SIZE);
    $("wall-page").textContent = pages > 1 ? (wallPage + 1) + " / " + pages : "";
  }

  function closeWall() {
    wallOpen = false;
    $("wall").hidden = true;
    $("wall-grid").textContent = ""; // stops the streams
    focus(fallbackFocus());
  }
  $("wall").onclick = closeWall;

  // ---- remote control ----

  document.addEventListener("keyboardStateChange", e => {
    keyboardUp = !!(e.detail && e.detail.visibility);
    if (!keyboardUp) keyboardClosed = Date.now();
  });

  document.addEventListener("keydown", e => {
    const k = e.keyCode, back = k === 461 || k === 27; // 461 = Back on the LG remote
    const dir = { 37: "left", 38: "up", 39: "right", 40: "down" }[k];
    if (page === "settings" && settingsSection === "hotkeys" && pickingKey == null && k !== lastKey && !back && !dir && k !== 13) { lastKey = k; renderMain(); } // shows which code the button sends
    if (!back && !dir && k !== 13) { if (!e.repeat && hotkey(k)) e.preventDefault(); return; }
    const a = document.activeElement;

    if (mode === "notice") { // only the card is shown
      const buttons = [...$("card-actions").querySelectorAll("button")], i = buttons.indexOf(a);
      if (k === 13 && i >= 0 && !e.repeat) return; // the button clicks itself
      e.preventDefault();
      if (back) endNotice();
      else if (buttons.length && (dir === "left" || dir === "right")) focus(buttons[Math.max(0, Math.min(buttons.length - 1, (i < 0 ? 0 : i) + (dir === "right" ? 1 : -1)))]);
      else if (k === 13 && !e.repeat && !buttons.length) expandNotice();
      return;
    }
    if (mode === "menu") {
      menuIdle();
      menuTouched = true;
      if (back) { e.preventDefault(); return exitApp(); }
      if (dir !== "up" && dir !== "down") return; // OK clicks the row itself
      e.preventDefault();
      const next = a.dataset.row ? (dir === "down" ? a.nextElementSibling : a.previousElementSibling) : $("drawer-list").firstChild;
      if (next) { next.focus(); next.scrollIntoView({ block: "nearest" }); }
      return;
    }
    if (inSetup()) {
      if (back) {
        e.preventDefault();
        if (keyboardUp || Date.now() - keyboardClosed < 500) return; // Back only closed the keyboard
        if (!$("login-form").hidden) showSetup(); else exitApp();
      } else if (dir === "up" || dir === "down") {
        e.preventDefault();
        const list = [...$("setup").querySelectorAll("input, button")].filter(x => x.offsetParent);
        focus(list[Math.max(0, Math.min(list.length - 1, list.indexOf(a) + (dir === "down" ? 1 : -1)))]);
      }
      return; // Enter and left/right are handled by the form
    }
    if (dimming) return panelKey(k, dir, back, e);
    if (wallOpen) {
      e.preventDefault();
      if (back) closeWall(); else if (dir === "left" || dir === "right") renderWall(wallPage + (dir === "right" ? 1 : -1));
      return;
    }
    if (viewing && !pip) {
      e.preventDefault();
      if (ptz) { // move the camera
        if (back) { ptz = false; viewerHint(); }
        else if (dir || k === 13) { const q = ptzCall(reg[viewing].platform, services, dir || "zoom_in"); if (q) call(q[0], q[1], viewing, q[2]); }
        return;
      }
      const siblings = isImage(states[viewing]) ? visible().filter(isImage).map(s => s.entity_id) : camIds();
      if (back) closeCamera();
      else if (dir === "left" || dir === "right") openCamera(cycle(siblings, viewing, dir === "right" ? 1 : -1));
      else if (dir === "up") { if (isCam(states[viewing])) pinCamera(viewing); }
      else if (dir === "down") { if (canPtz(viewing)) { ptz = true; viewerHint(); } }
      else if (k === 13 && !e.repeat) setPip(true);
      return;
    }
    if (back) {
      e.preventDefault();
      if (notice) hideNotice(); else if (viewing) closeCamera();
      else if (page === "settings" && pickingKey != null) { const was = pickingKey; pickingKey = null; renderMain(); focus([...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "hotkey:" + was)); }
      else if (page === "settings" && settingsSection) { const was = settingsSection; settingsSection = null; renderMain(); focus([...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "settings:" + was)); }
      else if (a.classList.contains("tile")) focusRail(); else exitApp();
      return;
    }
    if (k === 13) {
      if (!a.dataset.id) return; // menu items and settings click themselves
      e.preventDefault();
      if (!e.repeat) pressStart(a.dataset.id);
      return;
    }
    e.preventDefault();
    if (a.classList.contains("rail-item")) {
      if (dir === "right") focusMain();
      else if (dir !== "left") focus(dir === "down" ? a.nextElementSibling : a.previousElementSibling);
    } else if (a.classList.contains("tile")) {
      const list = [...document.querySelectorAll("main .tile")];
      const pts = list.map(x => { const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const cur = list.indexOf(a), next = nextTile(pts, cur, dir);
      if (next === cur && dir === "left") focusRail(); else focus(list[next]);
    } else focusMain() || focusRail();
  });

  document.addEventListener("keyup", e => { if (e.keyCode === 13) { dimArmed = true; pressEnd(); } });

  // HA can open a camera in an already running app (e.g. when the doorbell rings)
  document.addEventListener("webOSRelaunch", e => {
    const params = parseParams(e.detail);
    if (provision(params)) { stopPairing(); $("setup").hidden = true; connect(); }
    // If the app was in the background a notification must not pull the whole app over what is playing
    route(params, !document.hidden && Date.now() - shownAt > 1500);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (viewing) closeCamera(); closeDimmer(); hideNotice(); closeMenu(); if (wallOpen) closeWall(); closeSaver(); } else { shownAt = Date.now(); refreshSnapshots(); updateClock(); }
  });

  // ---- screensaver ----

  function idle() {
    clearTimeout(saverTimer);
    if (!cfg.saverAfter || !auth) return;
    saverTimer = setTimeout(() => {
      if (mode === "full" && !saverOn && !inSetup() && !dimming && !notice && !wallOpen && !(viewing && !pip)) openSaver(); else idle();
    }, cfg.saverAfter * 60000);
  }

  function saverCameras() {
    const cams = visible().filter(isCam).sort(favFirst);
    return cfg.saverContent === "clock" ? [] : cams.map(s => s.entity_id);
  }

  function openSaver() {
    clearTimeout(saverTimer);
    if (viewing) closeCamera();
    if (wallOpen) closeWall();
    closeDimmer();
    saverOn = true;
    saverIndex = -1;
    $("saver").hidden = false;
    $("saver").dataset.effect = cfg.saverEffect;
    $("saver-hint").textContent = t("saverHint");
    saverTick();
    saverSwitch = setInterval(saverTick, cfg.saverInterval * 1000);
    saverClock();
  }

  // the next camera slides or fades in; without cameras only the clock is shown
  function saverTick() {
    const cams = saverCameras(), layers = [$("saver-a"), $("saver-b")];
    $("saver").classList.toggle("clock-only", !cams.length);
    if (!cams.length) { layers.forEach(l => { l.className = ""; l.removeAttribute("src"); }); $("saver-cam").textContent = ""; return; }
    saverIndex = (saverIndex + 1) % cams.length;
    const id = cams[saverIndex], incoming = layers[saverLayer ^ 1], outgoing = layers[saverLayer];
    incoming.onload = () => {
      if (!saverOn) return;
      incoming.className = "show"; outgoing.className = "gone";
      saverLayer ^= 1;
      $("saver-cam").textContent = nameOf(states[id]);
    };
    incoming.className = "";
    incoming.src = snapshot(id);
  }

  function saverClock() {
    const now = new Date();
    $("saver-time").textContent = now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    $("saver-date").textContent = $("date").textContent;
    $("saver-weather").textContent = $("weather").textContent;
    // the clock moves a little every minute so it does not burn into the screen
    const dx = (now.getMinutes() % 6) * 14, dy = -(now.getMinutes() % 4) * 14, centered = $("saver").classList.contains("clock-only");
    $("saver-info").style.transform = centered ? `translate(calc(-50% + ${dx}px), calc(50% + ${dy}px))` : `translate(${dx}px, ${dy}px)`;
  }

  function closeSaver() {
    if (!saverOn) return;
    saverOn = false;
    clearInterval(saverSwitch);
    $("saver").hidden = true;
    [$("saver-a"), $("saver-b")].forEach(l => { l.className = ""; l.removeAttribute("src"); });
    if (saverLaunched) { saverLaunched = false; return exitApp(); } // back to what the TV showed before
    if (!document.activeElement.dataset.key && !document.activeElement.dataset.page) focusMain() || focusRail();
    idle();
  }

  // Any button ends the screensaver, and OK on a camera opens it
  document.addEventListener("keydown", e => {
    idle();
    if (!saverOn) return;
    e.preventDefault(); e.stopPropagation();
    const cams = saverCameras(), current = cams[saverIndex], launched = saverLaunched;
    if (e.keyCode === 13 && current && states[current]) saverLaunched = false; // OK on a camera: stay in the app and show it
    closeSaver();
    if (e.keyCode === 13 && current && states[current]) { if (launched) { focusMain() || focusRail(); } openCamera(current); }
  }, true);
  document.addEventListener("mousemove", () => { idle(); closeSaver(); }, true);
  $("saver").onclick = closeSaver;

  // ---- clock, weather, camera snapshots ----

  function updateClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    $("date").textContent = now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
    const w = weatherEntity();
    $("weather").textContent = w ? [w.attributes.temperature != null && Math.round(w.attributes.temperature) + "°", TEXT[LANG].weather[w.state]].filter(Boolean).join(" · ") : "";
    if (saverOn) saverClock();
  }

  function refreshSnapshots() {
    if (!auth || document.hidden || (viewing && !pip) || wallOpen) return;
    if (saverOn) { const l = [$("saver-a"), $("saver-b")][saverLayer], id = saverCameras()[saverIndex]; if (id && states[id] && l.className === "show") l.src = snapshot(id); return; }
    document.querySelectorAll("main .tile.cam").forEach(b => { if (states[b.dataset.id]) b.querySelector("img").src = snapshot(b.dataset.id); });
  }

  // ---- startup ----

  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-t]").forEach(x => { x.textContent = t(x.dataset.t); });
  document.querySelectorAll("[data-t-placeholder]").forEach(x => { x.placeholder = t(x.dataset.tPlaceholder); });
  const params = parseParams(sys && sys.launchParams);
  provision(params);
  applyTheme();
  setMode("full");
  renderRail(); renderMain(); updateClock();
  route(params, false);
  setInterval(updateClock, 10000);
  setInterval(refreshSnapshots, SNAPSHOT_MS);
  if (auth) connect(); else showSetup();
})();
