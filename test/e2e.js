// Kör appen i headless Chromium mot en låtsas-Home Assistant. Kräver chromium och `npm install` i den här mappen.
// Kör: node test/e2e.js
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert"), { spawn } = require("child_process");
const { WebSocketServer, WebSocket } = require("ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 18123, APP = "file://" + path.resolve(__dirname, "../app/index.html");
const SHOTS = process.env.SHOTS || "";

// ---- låtsas-HA ----
const st = (entity_id, state, friendly_name, extra) => ({ entity_id, state, attributes: { friendly_name, ...extra } });
const states = [
  st("camera.dorr", "idle", "Ytterdörr", { access_token: "tok1" }), st("camera.garage", "idle", "Garage", { access_token: "tok2" }),
  st("light.kok", "off", "Kök tak", { supported_color_modes: ["brightness"] }), st("light.vardagsrum", "on", "Vardagsrum", { supported_color_modes: ["onoff"] }),
  st("light.hall", "off", "Hall", { supported_color_modes: ["onoff"] }), st("light.trasig", "unavailable", "Trasig"),
  st("light.installning", "on", "Ska inte synas (config)"), st("switch.kaffe", "off", "Kaffebryggare"), st("weather.hem", "sunny", "Hem", { temperature: 7.4 }),
  st("sensor.kok_temp", "21.456", "Kök temperatur", { unit_of_measurement: "°C", device_class: "temperature" }),
  st("binary_sensor.ytterdorr", "on", "Ytterdörr givare", { device_class: "door" }), st("lock.ytterdorr", "locked", "Ytterdörr lås"),
  st("climate.vp", "heat", "Värmepump", { min_temp: 16, max_temp: 30, target_temp_step: 1, temperature: 22, current_temperature: 20.5, hvac_modes: ["off", "heat", "cool"], fan_modes: ["auto", "low"], fan_mode: "auto" }),
  st("media_player.stereo", "paused", "Stereo", { volume_level: 0.3, source_list: ["Radio", "Spotify"], source: "Radio", is_volume_muted: false }),
  st("alarm_control_panel.hem", "disarmed", "Hemlarm", { code_format: "number", supported_features: 3 }),
  st("scene.mys", "2026-09-29T19:00:00+00:00", "Myskväll"), st("image.garage_person", "2026-09-30T05:00:00+00:00", "Garage person", { access_token: "img1" }),
];
const areas = [{ area_id: "kok", name: "Kök" }, { area_id: "garage", name: "Garage" }, { area_id: "hall", name: "Hall" }, { area_id: "tom", name: "Tomt rum" }];
const entities = [{ entity_id: "light.kok", area_id: "kok" }, { entity_id: "switch.kaffe", device_id: "d1" }, { entity_id: "camera.garage", area_id: "garage" },
  { entity_id: "light.installning", area_id: "kok", entity_category: "config" }, { entity_id: "sensor.kok_temp", area_id: "kok" },
  { entity_id: "binary_sensor.ytterdorr", area_id: "hall" }, { entity_id: "lock.ytterdorr", area_id: "hall" }, { entity_id: "climate.vp", area_id: "hall" },
  { entity_id: "media_player.stereo", area_id: "hall" }, { entity_id: "alarm_control_panel.hem", area_id: "hall" }, { entity_id: "image.garage_person", area_id: "garage" }];
entities.find(e => e.entity_id === "camera.garage").platform = "frigate";
const translations = { entity_component: { "component.climate.entity_component._.state.heat": "Värme", "component.lock.entity_component._.state.locked": "Låst",
  "component.lock.entity_component._.state.unlocked": "Olåst", "component.binary_sensor.entity_component.door.state.on": "Öppen" },
  title: { "component.binary_sensor.title": "Binär sensor", "component.lock.title": "Lås (HA)" }, entity: {} };
translations.entity_component["component.climate.entity_component._.state.cool"] = "Kyla";
translations.entity_component["component.climate.entity_component._.state_attributes.fan_mode.state.low"] = "Låg";
const devices = [{ id: "d1", area_id: "kok" }];
const calls = [], hits = [], wsAuth = [], userData = {}, tokensMade = [], events = [], scriptsSaved = {}, blueprintsSaved = {}, flowSteps = [];
let stateSubGlobal = null, sockets = []; let refreshOk = true, revoked = 0, logins = 0;

const server = http.createServer((req, res) => {
  hits.push(req.method + " " + req.url);
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  const json = (code, body) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let raw = ""; req.on("data", d => raw += d); req.on("end", () => {
    if (req.url === "/manifest.json") return json(200, { name: "Home Assistant" });
    if (req.url === "/auth/providers") return json(200, { providers: [{ name: "Home Assistant Local", id: null, type: "homeassistant" }] });
    if (req.url === "/auth/login_flow") return json(200, { type: "form", flow_id: "flow1", step_id: "init" });
    if (req.url === "/auth/login_flow/flow1") {
      const b = JSON.parse(raw); logins++;
      if (b.code) return b.code === "123456" ? json(200, { type: "create_entry", result: "AUTHCODE" }) : json(200, { type: "form", step_id: "mfa", errors: { base: "invalid_code" } });
      if (b.username === "anna" && b.password === "hemligt") return json(200, { type: "create_entry", result: "AUTHCODE" });
      if (b.username === "mfa" && b.password === "hemligt") return json(200, { type: "form", step_id: "mfa", errors: {} });
      return json(200, { type: "form", step_id: "init", errors: { base: "invalid_auth" } });
    }
    if (req.url === "/auth/token") {
      const b = Object.fromEntries(new URLSearchParams(raw));
      if (b.action === "revoke") { revoked++; return json(200, {}); }
      if (b.grant_type === "authorization_code" && b.code === "AUTHCODE") return json(200, { access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 1800 });
      if (b.grant_type === "refresh_token" && b.refresh_token === "REFRESH" && refreshOk) return json(200, { access_token: "ACCESS", expires_in: 1800 });
      return json(400, { error: "invalid_grant" });
    }
    if (req.url.startsWith("/api/config/config_entries/flow")) { // the webOS TV integration's config flow
      if (!["Bearer ACCESS", "Bearer LONGLIVED"].includes(req.headers.authorization)) return json(401, {});
      const body = raw ? JSON.parse(raw) : {}; flowSteps.push([req.url, body]);
      if (req.url === "/api/config/config_entries/flow") return json(200, { type: "form", flow_id: "f1", step_id: "user", data_schema: [{ name: "host", required: true, type: "string" }] });
      if (body.host) return json(200, { type: "form", flow_id: "f1", step_id: "pairing", data_schema: [] });
      states.push(st("media_player.ny_tv", "on", "Ny TV")); entities.push({ entity_id: "media_player.ny_tv", platform: "webostv" });
      sockets.forEach(sk => sk.send(JSON.stringify({ id: stateSubGlobal, type: "event", event: { data: { entity_id: "media_player.ny_tv", new_state: states[states.length - 1] } } })));
      return json(200, { type: "create_entry", title: "Ny TV" });
    }
    if (req.url.startsWith("/api/config/script/config/")) {
      if (!["Bearer ACCESS", "Bearer LONGLIVED"].includes(req.headers.authorization)) return json(401, {});
      scriptsSaved[req.url.split("/").pop()] = JSON.parse(raw); return json(200, { result: "ok" });
    }
    if (req.url.startsWith("/api/states/")) {
      const found = states.find(x => x.entity_id === decodeURIComponent(req.url.slice(12)));
      if (req.headers.authorization !== "Bearer LONGLIVED") return json(401, {});
      return found ? json(200, found) : json(404, {});
    }
    if (req.url.startsWith("/api/image_proxy/")) {
      if (!req.url.includes("token=img1")) return json(401, {});
      res.writeHead(200, { ...cors, "Content-Type": "image/jpeg" }); return res.end(fs.readFileSync(path.join(__dirname, "cam.jpg")));
    }
    if (req.url.startsWith("/api/camera_proxy")) { res.writeHead(200, { ...cors, "Content-Type": "image/jpeg" }); return res.end(fs.readFileSync(path.join(__dirname, "cam.jpg"))); }
    res.writeHead(404, cors); res.end();
  });
});
new WebSocketServer({ server, path: "/api/websocket" }).on("connection", sock => {
  const tx = m => sock.send(JSON.stringify(m)), ok = (id, result) => tx({ id, type: "result", success: true, result });
  let stateSub = null; sockets.push(sock); // händelser skickas med prenumerationens id, precis som HA gör
  tx({ type: "auth_required" });
  sock.on("message", raw => {
    const m = JSON.parse(raw);
    if (m.type === "auth/long_lived_access_token") { tokensMade.push(m.client_name); return ok(m.id, "LONGLIVED"); }
    if (m.type === "auth") { wsAuth.push(m.access_token); if (["ACCESS", "LONGLIVED"].includes(m.access_token)) return tx({ type: "auth_ok" }); tx({ type: "auth_invalid" }); return sock.close(); }
    if (m.type === "get_states") return ok(m.id, states);
    if (m.type === "config/area_registry/list") return ok(m.id, areas);
    if (m.type === "config/entity_registry/list") return ok(m.id, entities);
    if (m.type === "config/device_registry/list") return ok(m.id, devices);
    if (m.type === "subscribe_events") { stateSub = stateSubGlobal = m.id; return ok(m.id, null); }
    if (m.type === "blueprint/save") { blueprintsSaved[m.path] = m; return ok(m.id, null); }
    if (m.type === "frontend/get_user_data") return ok(m.id, { value: userData[m.key] || null });
    if (m.type === "frontend/set_user_data") { userData[m.key] = m.value; return ok(m.id, null); }
    if (m.type === "frontend/get_translations") return ok(m.id, { resources: m.language === "sv" ? translations[m.category] : {} });
    if (m.type === "get_services") return ok(m.id, { frigate: { ptz: {} }, light: { turn_on: {} } });
    if (m.type === "fire_event") { events.push([m.event_type, m.event_data]); return ok(m.id, null); }
    if (m.type === "weather/subscribe_forecast") { ok(m.id, null); return tx({ id: m.id, type: "event", event: { type: "daily", forecast: [
      { datetime: "2026-09-30T10:00:00+00:00", condition: "sunny", temperature: 12.4, templow: 4.6 }, { datetime: "2026-10-01T10:00:00+00:00", condition: "rainy", temperature: 9, templow: 5 },
      { datetime: "2026-10-02T10:00:00+00:00", condition: "partlycloudy", temperature: 11, templow: 3 }] } }); }
    if (m.type === "history/history_during_period") return ok(m.id, { [m.entity_ids[0]]: [{ s: "20.1", lu: 1 }, { s: "22.4", lu: 2 }, { s: "21.0", lu: 3 }] });
    if (m.type === "camera/stream") return ok(m.id, { url: "/api/hls/abc/master_playlist.m3u8" });
    if (m.type === "call_service") {
      calls.push(m);
      const s = states.find(x => x.entity_id === m.target.entity_id);
      if (m.service === "toggle") s.state = s.state === "on" ? "off" : "on";
      if (m.service === "turn_on") { s.state = "on"; if (m.service_data.brightness_pct) s.attributes.brightness = Math.round(m.service_data.brightness_pct * 2.55); }
      if (m.service === "turn_off") s.state = "off";
      if (m.service === "unlock") s.state = "unlocked";
      if (m.service === "set_temperature") s.attributes.temperature = m.service_data.temperature;
      if (m.service === "set_hvac_mode") s.state = m.service_data.hvac_mode;
      if (m.service === "set_fan_mode") s.attributes.fan_mode = m.service_data.fan_mode;
      if (m.service === "select_source") s.attributes.source = m.service_data.source;
      if (m.service === "alarm_arm_home") s.state = "armed_home";
      ok(m.id, null);
      return tx({ id: stateSub, type: "event", event: { data: { entity_id: s.entity_id, new_state: s } } });
    }
  });
});

// ---- webbläsare via CDP ----
let debugPort = 9340; const procs = [];
// Låtsasbrygga mot webOS: ingen nätverksadress (ingen sökning), och en parningstjänst som testet styr via window.__pair
const FAKE_BRIDGE = `window.WebOSServiceBridge = function () {
  const self = this, reply = m => setTimeout(() => self.onservicecallback(JSON.stringify(m)), 10);
  this.cancel = () => { window.__cancelled = (window.__cancelled || 0) + 1; };
  this.call = (uri, params) => {
    if (uri.endsWith("connectionmanager/getStatus")) reply({ returnValue: true, wired: {} });
    if (uri.endsWith("applicationManager/launch")) { (window.__launched = window.__launched || []).push(JSON.parse(params)); reply({ returnValue: window.__overlayInstalled !== false }); }
    if (uri.endsWith(".pair/start")) { window.__started = JSON.parse(params); window.__pair = c => reply({ returnValue: true, subscribed: true, credentials: c }); reply({ returnValue: true, subscribed: true, ip: "192.168.1.96", port: 4567, code: "abc123" }); }
  };
};`;

const FAKE_BRIDGE_IP = FAKE_BRIDGE.replace("reply({ returnValue: true, wired: {} })", 'reply({ returnValue: true, wired: { ipAddress: "192.168.1.96" } })');

async function browser(profile, launchParams, extraScript, page, lang) {
  const port = debugPort++;
  const proc = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1920,1080", "--lang=" + (lang || "sv-SE"), "--accept-lang=" + (lang || "sv-SE"), "about:blank"], { stdio: "ignore" });
  procs.push(proc);
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === "page"); } catch (e) {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.on("open", r));
  let id = 0; const waits = {};
  ws.on("message", d => { const m = JSON.parse(d); if (waits[m.id]) waits[m.id](m); });
  const cdp = (method, params = {}) => new Promise(r => { waits[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const b = {
    js: async expr => { const r = (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(expr + " -> " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; },
    down: (code, key, text) => cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", windowsVirtualKeyCode: code, key, text }),
    up: (code, key) => cdp("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: code, key }),
    key: async (name, hold) => { const [code, key, text] = KEYS[name]; await b.down(code, key, text); if (hold) await sleep(hold); await b.up(code, key); await sleep(350); },
    type: async text => { await cdp("Input.insertText", { text }); await sleep(100); },
    shot: async name => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, name), Buffer.from((await cdp("Page.captureScreenshot")).result.data, "base64")); },
    load: async () => { await cdp("Page.navigate", { url: page || APP }); await sleep(1500); },
    close: () => proc.kill(),
  };
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true }); // annars skickas inga fokushändelser förrän första knapptrycket
  if (launchParams) await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.PalmSystem = { launchParams: ${JSON.stringify(JSON.stringify(launchParams))}, platformBack() { window.__exited = true; } };` });
  else await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.PalmSystem = { launchParams: "", platformBack() { window.__exited = true; } };` });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.close = () => { window.__closed = true; };` });
  if (extraScript) await cdp("Page.addScriptToEvaluateOnNewDocument", { source: extraScript });
  await b.load();
  return b;
}
const KEYS = { left: [37, "ArrowLeft"], up: [38, "ArrowUp"], right: [39, "ArrowRight"], down: [40, "ArrowDown"], ok: [13, "Enter", "\r"], back: [461, "GoBack"], red: [403, "ColorF0Red"], blue: [406, "ColorF3Blue"], five: [53, "5"] };
// Öppnar Inställningar och en av dess undermenyer
const openSettings = async (b, section) => {
  await b.js(`document.querySelector('[data-page="home"]').focus()`); await sleep(100); // lämna en eventuell öppen undermeny
  await b.js(`document.querySelector('[data-page="settings"]').focus()`); await sleep(300);
  if (section) { await b.js(`[...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "settings:${section}").click()`); await sleep(300); }
};
const focused = `(document.activeElement.dataset.key || document.activeElement.dataset.page || document.activeElement.id)`;
const tilesNow = `[...document.querySelectorAll("main .tile")].map(x => x.dataset.key)`;
const text = id => `document.getElementById("${id}").textContent`;
const hiddenEl = id => `document.getElementById("${id}").hidden`;
const panelVal = `document.querySelector("#dimmer-rows .prow.slider .val").textContent`;
const panelRows = `[...document.querySelectorAll("#dimmer-rows .prow")].map(x => x.dataset.key || x.className.replace("prow ", ""))`;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-"));
  let b = await browser(profile);

  // --- första start: ingen sparad inloggning ---
  assert.strictEqual(await b.js(hiddenEl("setup")), false, "inställningsguiden visas");
  assert.strictEqual(await b.js(`document.documentElement.lang`), "sv", "svenska väljs efter systemspråk");
  assert.strictEqual(await b.js(text("setup-msg")), "Hittade ingen server. Ange adressen själv.");
  assert.strictEqual(await b.js(focused), "server-url");
  await b.shot("1-setup.png");
  await b.type("127.0.0.1:1"); await b.key("ok"); await sleep(800);
  assert.match(await b.js(text("setup-msg")), /Kunde inte nå Home Assistant på http:\/\/127\.0\.0\.1:1/);
  await b.js(`document.getElementById("server-url").value = ""`);
  await b.type("127.0.0.1:" + PORT); await b.key("ok"); await sleep(800);
  assert.strictEqual(await b.js(hiddenEl("login-form")), false, "inloggning visas");
  assert.strictEqual(await b.js(text("setup-title")), "Logga in på 127.0.0.1:" + PORT);
  assert.strictEqual(await b.js(focused), "login-user");

  // tomt lösenord: inget anrop, fokus flyttas dit
  await b.type("anna"); await b.key("ok");
  assert.strictEqual(await b.js(focused), "login-pass"); assert.strictEqual(logins, 0);
  await b.type("fel"); await b.key("ok"); await sleep(600);
  assert.strictEqual(await b.js(text("setup-msg")), "Fel användarnamn eller lösenord");
  assert.strictEqual(await b.js(hiddenEl("setup")), false);
  await b.shot("2-fel-losenord.png");

  // upp/ner flyttar mellan fält, Tillbaka går till serverval
  await b.key("up"); assert.strictEqual(await b.js(focused), "login-user");
  await b.key("down"); assert.strictEqual(await b.js(focused), "login-pass");
  await b.key("back"); await sleep(300);
  assert.strictEqual(await b.js(hiddenEl("login-form")), true, "Tillbaka går till serverval");
  await b.key("ok"); await sleep(800); // adressen står kvar
  assert.strictEqual(await b.js(focused), "login-user");

  // tvåstegskod
  await b.js(`document.getElementById("login-user").value = "mfa"; document.getElementById("login-pass").value = "hemligt"`);
  await b.key("ok"); await sleep(600);
  assert.strictEqual(await b.js(hiddenEl("login-code")), false, "kodfältet visas");
  assert.strictEqual(await b.js(focused), "login-code");
  await b.type("000000"); await b.key("ok"); await sleep(600);
  assert.strictEqual(await b.js(text("setup-msg")), "Fel kod, försök igen");
  await b.js(`document.getElementById("login-code").value = ""`);
  await b.type("123456"); await b.key("ok"); await sleep(1500);
  assert.strictEqual(await b.js(hiddenEl("setup")), true, "inloggad");
  assert.deepStrictEqual(JSON.parse(await b.js(`localStorage.getItem("auth")`)), { url: "http://127.0.0.1:" + PORT, client_id: `http://127.0.0.1:${PORT}/`, refresh_token: "REFRESH" }, "bara refresh-token sparas, aldrig lösenord");
  assert.strictEqual(await b.js(`document.getElementById("login-pass").value + document.getElementById("login-code").value`), "", "lösenord och kod rensas");

  // --- huvudvy ---
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".rail-item")].map(x => x.textContent)`), ["Hem2 på", "Kameror", "Garage", "Hall1 på", "Kök", "Övrigt1 på", "Inställningar"]);
  assert.deepStrictEqual(await b.js(tilesNow), ["camera.garage", "camera.dorr", "forecast:0", "forecast:1", "forecast:2", "scene.mys", "light.vardagsrum", "climate.vp"], "Hem: kameror, prognos, scener och det som är på");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Kameror", "Prognos", "Scener", "På just nu"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".forecast")].map(x => x.textContent)`), ["I dag12° / 5° · Soligt", "I morgon9° / 5° · Regn", "Fredag11° / 3° · Halvklart"]);
  assert.strictEqual(await b.js(`document.querySelector('[data-id="climate.vp"] small').textContent`), "Värme · 22°", "HA:s översättning används");
  assert.strictEqual(await b.js(text("weather")), "7° · Soligt");
  assert.strictEqual(await b.js(text("status")), "");
  assert.strictEqual(await b.js(focused), "camera.garage");
  assert.ok(await b.js(`document.querySelector(".tile.cam img").naturalWidth`) > 0, "kamerabild laddad");
  await b.shot("3-hem.png");

  let n = 0;
  // meny: vänster går till menyn, upp/ner byter sida direkt, höger går in
  await b.key("left"); assert.strictEqual(await b.js(focused), "home");
  await b.key("down"); await b.key("down"); await b.key("down"); await b.key("down");
  assert.strictEqual(await b.js(focused), "room:kok");
  assert.deepStrictEqual(await b.js(tilesNow), ["light.kok", "switch.kaffe"], "Kök: lampa och brytare (config-entitet och sensorer visas inte från start)");
  await b.key("right"); assert.strictEqual(await b.js(focused), "light.kok");
  await b.shot("4-rum.png");

  // kort tryck = av/på
  await b.key("ok");
  assert.deepStrictEqual(calls.map(c => [c.domain, c.service, c.target.entity_id]), [["homeassistant", "toggle", "light.kok"]]);
  assert.strictEqual(await b.js(`document.activeElement.className`), "tile dev on");
  assert.strictEqual(await b.js(`[...document.querySelectorAll(".rail-item")].find(x => x.dataset.page === "room:kok").textContent`), "Kök1 på");

  // långt tryck = ljusstyrka
  await b.key("ok", 800);
  assert.strictEqual(await b.js(hiddenEl("dimmer")), false, "dimmer öppnas");
  assert.strictEqual(calls.length, 1, "långt tryck växlar inte lampan");
  for (let i = 0; i < 2; i++) { await b.down(37, "ArrowLeft"); await b.up(37, "ArrowLeft"); } // två snabba tryck
  await sleep(500);
  const dim = calls[calls.length - 1];
  assert.deepStrictEqual([dim.domain, dim.service, dim.service_data], ["light", "turn_on", { brightness_pct: 80 }]);
  assert.strictEqual(calls.length, 2, "snabba steg slås ihop till ett anrop");
  assert.strictEqual(await b.js(panelVal), "80 %");
  assert.strictEqual(await b.js(focused), "main");
  await b.shot("5-dimmer.png");
  await b.key("ok"); assert.strictEqual(await b.js(hiddenEl("dimmer")), true, "OK stänger dimmern");
  assert.strictEqual(await b.js(`document.activeElement.querySelector("small").textContent`), "På · 80 %");
  // långt tryck på lampa utan dimning: panel utan reglage, med favorit och dölj
  await b.key("left"); await b.key("up"); await b.key("up"); await b.key("up"); await b.key("up"); await b.key("right");
  await b.key("down"); assert.strictEqual(await b.js(focused), "forecast:0");
  await b.key("down"); assert.strictEqual(await b.js(focused), "scene.mys");
  n = calls.length; await b.key("ok");
  assert.deepStrictEqual([calls[n].domain, calls[n].service, calls[n].target.entity_id], ["scene", "turn_on", "scene.mys"], "scener aktiveras från Hem");
  await b.key("down"); assert.strictEqual(await b.js(focused), "light.kok", "nytänd lampa dyker upp på Hem");
  await b.key("right"); assert.strictEqual(await b.js(focused), "light.vardagsrum");
  await b.key("ok", 800);
  assert.strictEqual(await b.js(hiddenEl("dimmer")), false, "panelen öppnas");
  assert.deepStrictEqual(await b.js(panelRows), [], "inga rader för lampa utan dimning");
  assert.strictEqual(calls.length, 3, "långt tryck växlar inte lampan");
  assert.strictEqual(await b.js(focused), "fav-btn");
  assert.strictEqual(await b.js(text("fav-btn")), "Lägg till i favoriter");
  await b.shot("5b-panel.png");
  await b.key("ok");
  assert.strictEqual(await b.js(hiddenEl("dimmer")), true);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Kameror", "Prognos", "Scener", "Favoriter", "På just nu"]);
  assert.deepStrictEqual(await b.js(tilesNow), ["camera.garage", "camera.dorr", "forecast:0", "forecast:1", "forecast:2", "scene.mys", "light.vardagsrum", "light.kok", "climate.vp"], "favoriten ligger först och visas inte dubbelt");
  assert.strictEqual(await b.js(focused), "light.vardagsrum", "fokus följer med brickan");
  assert.deepStrictEqual(userData.homedash.favorites, ["light.vardagsrum"], "inställningen sparas även hos Home Assistant");
  await b.key("ok");
  assert.deepStrictEqual([calls.length, calls[3].service, calls[3].target.entity_id], [4, "toggle", "light.vardagsrum"]);
  await b.key("down"); assert.strictEqual(await b.js(focused), "light.kok");
  await b.key("ok");
  assert.deepStrictEqual([calls.length, calls[4].target.entity_id], [5, "light.kok"]);
  assert.strictEqual(await b.js(`document.activeElement.className`), "tile dev");
  assert.deepStrictEqual(await b.js(tilesNow), ["camera.garage", "camera.dorr", "forecast:0", "forecast:1", "forecast:2", "scene.mys", "light.vardagsrum", "light.kok", "climate.vp"], "släckt lampa ligger kvar på Hem så man kan ångra");
  await b.key("up"); await b.key("up"); await b.key("up"); await b.key("up");

  // --- kamera ---
  const cam1 = await b.js(focused); assert.ok(cam1.startsWith("camera."), "uppe vid kamerorna: " + cam1);
  await b.key("ok"); await sleep(1500);
  assert.strictEqual(await b.js(hiddenEl("viewer")), false);
  assert.ok(hits.includes("GET /api/hls/abc/playlist.m3u8"), "spellistan hämtas direkt");
  assert.ok(!hits.some(h => h.includes("master_playlist")), "huvudlistan används inte");
  assert.strictEqual(await b.js(`!document.getElementById("mjpeg").hidden && document.getElementById("video").hidden`), true, "faller tillbaka till MJPEG när HLS inte går");
  const name1 = await b.js(text("viewer-name"));
  await b.key("right"); await sleep(1200);
  const name2 = await b.js(text("viewer-name"));
  assert.notStrictEqual(name1, name2, "höger byter kamera");
  await b.key("right"); await sleep(1200);
  assert.strictEqual(await b.js(text("viewer-name")), name1, "kamerabytet går runt");
  await b.shot("6-kamera.png");
  await b.key("ok");
  assert.strictEqual(await b.js(`document.getElementById("viewer").className`), "pip", "OK minimerar till bild-i-bild");
  assert.strictEqual(await b.js(focused), cam1, "fokus tillbaka i sidan");
  await b.key("down"); assert.ok(/^(light|climate|forecast|scene)[.:]/.test(await b.js(focused)), "man kan navigera med bild-i-bild öppen");
  await sleep(500); await b.shot("7-bild-i-bild.png");
  await b.key("back");
  assert.strictEqual(await b.js(hiddenEl("viewer")), true, "Tillbaka stänger bild-i-bild");
  assert.ok(/^(light|climate|forecast|scene)[.:]/.test(await b.js(focused)), "fokus ligger kvar");
  await b.key("back"); assert.strictEqual(await b.js(focused), "home", "Tillbaka från sidan går till menyn");
  await b.key("back"); assert.strictEqual(await b.js(`window.__closed`), true, "Tillbaka i menyn avslutar appen");
  await b.load(); // appen är avslutad på riktigt (anslutningen stängd), så den startas om

  // djuplänk i startad app
  await b.js(`document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { camera: "camera.dorr" } }))`); await sleep(1200);
  assert.strictEqual(await b.js(text("viewer-name")), "Ytterdörr");
  await b.key("back");

  // --- kamerasidan: kameravägg, senaste bilder och PTZ ---
  await b.js(`document.querySelector('[data-page="cameras"]').focus()`); await sleep(300);
  assert.deepStrictEqual(await b.js(tilesNow), ["wall", "camera.garage", "camera.dorr", "image.garage_person"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Kameror", "Senaste bilder"]);
  assert.ok(await b.js(`document.querySelector('[data-id="image.garage_person"] img').naturalWidth`) > 0, "bildentitetens bild visas");
  await b.key("right"); assert.strictEqual(await b.js(focused), "wall");
  await b.key("ok"); await sleep(800);
  assert.strictEqual(await b.js(hiddenEl("wall")), false, "kameraväggen öppnas");
  assert.strictEqual(await b.js(`document.querySelectorAll("#wall-grid img").length`), 2);
  assert.ok(hits.some(h => h === "GET /api/camera_proxy_stream/camera.dorr?token=tok1"), "varje ruta är en egen ström");
  assert.strictEqual(await b.js(text("wall-page")), "", "en sida, ingen sidräknare");
  await b.shot("13-kameravagg.png");
  await b.key("back");
  assert.deepStrictEqual([await b.js(hiddenEl("wall")), await b.js(`document.querySelectorAll("#wall-grid img").length`), await b.js(focused)], [true, 0, "wall"], "Tillbaka stänger och stoppar strömmarna");
  await b.key("right"); await b.key("right"); await b.key("down"); assert.strictEqual(await b.js(focused), "image.garage_person");
  await b.key("ok"); await sleep(600);
  assert.deepStrictEqual([await b.js(hiddenEl("viewer")), await b.js(text("viewer-name")), await b.js(hiddenEl("mjpeg")), await b.js(hiddenEl("video"))], [false, "Garage person", false, true], "bilden visas i helskärm");
  assert.ok(hits.some(h => h.startsWith("GET /api/image_proxy/image.garage_person?token=img1")));
  await b.key("back");
  await b.key("up"); await b.key("right"); assert.strictEqual(await b.js(focused), "camera.garage");
  await b.key("ok"); await sleep(1200);
  assert.strictEqual(await b.js(text("viewer-hint")), "◀ ▶ byt kamera · OK minimera · ▲ fäst ovanpå TV · Tillbaka stäng · ▼ styr kameran", "PTZ erbjuds bara när HA har tjänsten");
  await b.key("down"); assert.strictEqual(await b.js(text("viewer-hint")), "◀ ▶ ▲ ▼ styr kameran · OK zooma in · Tillbaka klar");
  n = calls.length; await b.key("right"); await b.key("ok");
  assert.deepStrictEqual(calls.slice(n).map(c => [c.domain, c.service, c.service_data, c.target.entity_id]),
    [["frigate", "ptz", { action: "move", argument: "right" }, "camera.garage"], ["frigate", "ptz", { action: "zoom", argument: "in" }, "camera.garage"]]);
  await b.key("back"); assert.strictEqual(await b.js(hiddenEl("viewer")), false, "första Tillbaka lämnar bara styrläget");
  await b.key("right"); await sleep(800); assert.strictEqual(await b.js(text("viewer-name")), "Ytterdörr");
  assert.ok(!(await b.js(text("viewer-hint"))).includes("styr"), "kameran utan PTZ har inget styrläge");
  await b.key("back");

  // --- lås: två tryck för att låsa upp ---
  await b.js(`document.querySelector('[data-page="room:hall"]').focus()`); await sleep(300);
  assert.deepStrictEqual(await b.js(tilesNow), ["climate.vp", "media_player.stereo", "lock.ytterdorr", "alarm_control_panel.hem"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Klimat", "Mediaspelare", "Lås", "Larm"]);
  await b.key("right"); await b.key("down"); await b.key("down"); assert.strictEqual(await b.js(focused), "lock.ytterdorr"); // varje typ har sin egen rad
  n = calls.length;
  await b.key("ok");
  assert.strictEqual(calls.length, n, "första trycket låser inte upp");
  assert.strictEqual(await b.js(text("toast")), "Tryck OK igen för att låsa upp Ytterdörr lås");
  await b.key("ok");
  assert.deepStrictEqual([calls.length - n, calls[n].domain, calls[n].service, calls[n].target.entity_id], [1, "lock", "unlock", "lock.ytterdorr"]);
  assert.strictEqual(await b.js(`document.activeElement.querySelector("small").textContent`), "Olåst");
  n = calls.length; await b.key("ok");
  assert.deepStrictEqual([calls.length - n, calls[n].service], [1, "lock"], "att låsa kräver bara ett tryck");

  // --- klimat: långt tryck ställer in temperaturen ---
  await b.key("up"); await b.key("up"); assert.strictEqual(await b.js(focused), "climate.vp");
  n = calls.length; await b.key("ok", 800);
  assert.strictEqual(await b.js(hiddenEl("dimmer")), false);
  assert.strictEqual(await b.js(panelVal), "22°");
  assert.deepStrictEqual(await b.js(panelRows), ["main", "hvac", "fan"]);
  await b.key("right"); await sleep(400);
  assert.deepStrictEqual([calls.length - n, calls[n].domain, calls[n].service, calls[n].service_data], [1, "climate", "set_temperature", { temperature: 23 }]);
  await b.key("down"); assert.strictEqual(await b.js(focused), "hvac");
  assert.strictEqual(await b.js(`document.activeElement.querySelector(".val").textContent`), "◀  Värme  ▶", "läget visas med HA:s översättning");
  n = calls.length; await b.key("right");
  assert.deepStrictEqual([calls[n].service, calls[n].service_data], ["set_hvac_mode", { hvac_mode: "cool" }]);
  assert.strictEqual(await b.js(`document.activeElement.querySelector(".val").textContent`), "◀  Kyla  ▶");
  assert.strictEqual(await b.js(text("dimmer-state")), "Kyla · 23°", "panelens rubrik följer läget");
  await b.key("down"); assert.strictEqual(await b.js(focused), "fan");
  await b.key("left"); assert.deepStrictEqual(calls[calls.length - 1].service_data, { fan_mode: "low" });
  assert.strictEqual(await b.js(`document.activeElement.querySelector(".val").textContent`), "◀  Låg  ▶");
  await b.key("down"); assert.strictEqual(await b.js(focused), "fav-btn", "efter raderna kommer favorit och dölj");
  await b.key("up"); assert.strictEqual(await b.js(focused), "fan");
  await b.shot("8-temperatur.png");
  await b.key("back"); assert.strictEqual(await b.js(hiddenEl("dimmer")), true, "Tillbaka stänger panelen");
  assert.strictEqual(await b.js(`document.activeElement.querySelector("small").textContent`), "Kyla · 23°");
  n = calls.length; await b.key("ok", 800); await b.key("down"); await b.key("left"); await b.key("back"); // tillbaka till värme
  assert.deepStrictEqual(calls[n].service_data, { hvac_mode: "heat" });

  // --- mediaspelare: volym, källa och knappar ---
  await b.key("down"); assert.strictEqual(await b.js(focused), "media_player.stereo");
  await b.key("ok", 800);
  assert.deepStrictEqual(await b.js(panelRows), ["main", "source", "buttons"]);
  assert.strictEqual(await b.js(panelVal), "30 %");
  await b.key("down"); await b.key("down");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "⏮", "knappraden");
  await b.key("right"); n = calls.length; await b.key("ok");
  assert.deepStrictEqual([calls[n].domain, calls[n].service], ["media_player", "media_play_pause"]);
  await b.key("right"); await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Ljud av");
  await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Ljud av", "stannar på sista knappen");
  await b.key("up"); assert.strictEqual(await b.js(focused), "source");
  await b.key("right"); assert.deepStrictEqual(calls[calls.length - 1].service_data, { source: "Spotify" });
  await b.key("back");

  // --- larm med kod ---
  await b.key("down"); await b.key("down"); assert.strictEqual(await b.js(focused), "alarm_control_panel.hem");
  n = calls.length; await b.key("ok"); assert.strictEqual(calls.length, n, "larm styrs bara från panelen");
  await b.key("ok", 800);
  assert.deepStrictEqual(await b.js(panelRows), ["pad", "buttons"]);
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "1");
  await b.key("ok"); await b.key("right"); await b.key("ok"); await b.key("right"); await b.key("ok"); // 1 2 3
  assert.strictEqual(await b.js(`document.querySelector("#dimmer-rows .code").textContent`), "Kod: •••");
  for (let i = 0; i < 8; i++) await b.key("right");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "⌫"); await b.key("ok");
  assert.strictEqual(await b.js(`document.querySelector("#dimmer-rows .code").textContent`), "Kod: ••");
  await b.key("down"); await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Larma hemma");
  n = calls.length; await b.key("ok");
  assert.deepStrictEqual([calls[n].domain, calls[n].service, calls[n].service_data], ["alarm_control_panel", "alarm_arm_home", { code: "12" }]);
  assert.strictEqual(await b.js(`document.querySelector("#dimmer-rows .code").textContent`), "Kod: ", "koden töms efter användning");
  await b.key("back");

  // --- inställningar: undermenyer, teman ---
  await openSettings(b);
  assert.deepStrictEqual(await b.js(tilesNow), ["settings:look", "settings:show", "settings:hiddenOnes", "settings:overTv", "settings:weather", "settings:hotkeys", "settings:ha", "settings:saver", "settings:account"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main .tile")].map(x => x.textContent)`),
    ["UtseendeMörkt", "Visa8 typer visas", "DoldaInga", "Ovanpå TVHela appen", "VäderHem", "Snabbknappar0 på", "Home AssistantSaknas. Tryck för att lägga till", "SkärmsläckareAv", "Konto127.0.0.1:" + PORT], "varje undermeny visar sitt nuvarande värde");
  await b.key("right"); assert.strictEqual(await b.js(focused), "settings:look");
  await b.key("ok"); await sleep(300);
  assert.deepStrictEqual(await b.js(tilesNow), ["theme:dark", "theme:oled", "theme:light", "theme:ocean", "theme:forest", "lang"]);
  assert.strictEqual(await b.js(`[...document.querySelectorAll("main .tile")].pop().textContent`), "SpråkTV:ns språk");
  assert.strictEqual(await b.js(focused), "theme:dark");
  assert.strictEqual(await b.js(`document.activeElement.className`), "tile dev action on", "aktivt tema är markerat");
  await b.key("right"); await b.key("right"); await b.key("ok");
  assert.strictEqual(await b.js(`document.documentElement.dataset.theme`), "light", "temat byts direkt");
  assert.strictEqual(userData.homedash.theme, "light", "temat sparas hos Home Assistant");
  await b.shot("9a-ljust-tema.png");
  await b.key("back"); await sleep(200);
  assert.deepStrictEqual([await b.js(focused), (await b.js(tilesNow)).length], ["settings:look", 9], "Tillbaka går till huvudmenyn med fokus kvar");
  await b.key("ok"); await b.key("ok"); await sleep(200); // mörkt igen
  assert.strictEqual(await b.js(`document.documentElement.dataset.theme`), "dark");
  await b.key("back");

  // typerna hämtas från servern
  await openSettings(b, "show");
  assert.deepStrictEqual(await b.js(tilesNow), ["show:light", "show:switch", "show:climate", "show:media_player", "show:lock", "show:scene", "show:image", "show:binary_sensor", "show:alarm_control_panel", "show:sensor"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main .tile")].map(x => x.textContent)`),
    ["Lampor3 · Visas", "Brytare1 · Visas", "Klimat1 · Visas", "Mediaspelare1 · Visas", "Lås1 · Visas", "Scener1 · Visas", "Bilder1 · Visas", "Givare1 · Dold", "Larm1 · Visas", "Sensorer1 · Dold"], "otillgängliga och config-entiteter räknas inte");
  assert.strictEqual(await b.js(focused), "show:light");
  await b.key("down"); for (let i = 0; i < 4; i++) await b.key("right"); assert.strictEqual(await b.js(focused), "show:sensor");
  await b.key("ok");
  assert.ok(JSON.parse(await b.js(`localStorage.getItem("cfg")`)).domains.includes("sensor"));
  assert.strictEqual(await b.js(focused), "show:sensor", "fokus ligger kvar efter ändring");
  assert.strictEqual(await b.js(`document.activeElement.className`), "tile dev action on");
  await b.key("left"); await b.key("left");
  assert.strictEqual(await b.js(focused), "show:binary_sensor"); await b.key("ok");
  await b.shot("9-installningar.png");
  await b.js(`document.querySelector('[data-page="room:kok"]').focus()`); await sleep(300);
  assert.deepStrictEqual(await b.js(tilesNow), ["light.kok", "switch.kaffe", "sensor.kok_temp"], "sensorn visas nu i sitt rum");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Lampor", "Brytare", "Sensorer"]);
  assert.strictEqual(await b.js(`document.querySelector('[data-id="sensor.kok_temp"]').textContent`), "Kök temperatur21,46 °C");
  assert.ok(await b.js(`document.querySelector('[data-id="sensor.kok_temp"]').classList.contains("readonly")`));
  await b.key("right"); await b.key("down"); await b.key("down"); assert.strictEqual(await b.js(focused), "sensor.kok_temp");
  n = calls.length; await b.key("ok");
  assert.strictEqual(calls.length, n, "sensorer går bara att läsa av");
  assert.strictEqual(await b.js(hiddenEl("dimmer")), true);
  await b.shot("10-rum-alla-typer.png");

  // --- dölj en entitet och ta fram den igen ---
  await b.key("ok", 800); await sleep(500);
  assert.strictEqual(await b.js(focused), "fav-btn");
  assert.ok(await b.js(`!!document.querySelector("#dimmer-rows .chart svg path")`), "sensorer får en kurva för senaste dygnet");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("#dimmer-rows .chart span")].map(x => x.textContent)`), ["20,1 °C", "22,4 °C"]);
  await b.shot("10b-historik.png");
  await b.key("right"); assert.strictEqual(await b.js(focused), "hide-btn");
  await b.key("ok");
  assert.strictEqual(calls.length, n);
  assert.deepStrictEqual(await b.js(tilesNow), ["light.kok", "switch.kaffe"], "sensorn är dold");
  assert.strictEqual(await b.js(text("toast")), "Kök temperatur är dold. Visa igen under Inställningar.");
  assert.ok((await b.js(focused)).includes("."), "fokus hamnar på en annan bricka: " + await b.js(focused));
  assert.deepStrictEqual(userData.homedash.hidden, ["sensor.kok_temp"]);
  await openSettings(b);
  assert.strictEqual(await b.js(`[...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "settings:hiddenOnes").textContent`), "Dolda1 dolda");
  await openSettings(b, "show");
  assert.strictEqual(await b.js(`[...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "show:sensor").textContent`), "Sensorer1 · Visas", "typen finns kvar i listan även när allt i den är dolt");
  await openSettings(b, "hiddenOnes");
  await b.js(`[...document.querySelectorAll("main .tile")].find(x => x.dataset.key === "unhide:sensor.kok_temp").focus()`);
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Kök temperaturVisa igen");
  await b.key("ok");
  assert.deepStrictEqual(userData.homedash.hidden, []);
  assert.strictEqual(await b.js(`!!document.querySelector('[data-key^="unhide:"]')`), false);
  await b.js(`document.querySelector('[data-page="room:kok"]').focus()`); await sleep(300);
  assert.deepStrictEqual(await b.js(tilesNow), ["light.kok", "switch.kaffe", "sensor.kok_temp"], "sensorn är tillbaka");
  await b.js(`document.querySelector('[data-page="room:hall"]').focus()`); await sleep(300);
  assert.strictEqual(await b.js(`document.querySelector('[data-id="binary_sensor.ytterdorr"] small').textContent`), "Öppen", "dörrgivare: på = Öppen");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main h2")].map(x => x.textContent)`), ["Klimat", "Mediaspelare", "Lås", "Givare", "Larm"]);

  // --- omstart: sparad inloggning används ---
  await b.load();
  assert.strictEqual(await b.js(hiddenEl("setup")), true);
  assert.ok((await b.js(tilesNow)).length > 0, "ansluter med sparad refresh-token");
  assert.strictEqual(wsAuth[wsAuth.length - 1], "ACCESS");

  // --- väderkälla väljs bland dem som finns i Home Assistant ---
  await openSettings(b, "weather");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main .tile")].map(x => x.textContent + "|" + x.classList.contains("on"))`), ["AutomatisktFörsta väderkällan i Home Assistant|true", "Hem7° · Soligt|false"]);
  await b.key("right"); await b.key("ok");
  assert.deepStrictEqual([userData.homedash.weather, await b.js(`document.activeElement.classList.contains("on")`), await b.js(text("weather"))], ["weather.hem", true, "7° · Soligt"]);

  // --- snabbknappar på fjärrkontrollen ---
  await openSettings(b, "hotkeys");
  assert.strictEqual(await b.js(`document.querySelector("main h2").textContent`), "Snabbknappar · Tryck på en knapp på fjärrkontrollen för att se om appen känner den");
  assert.deepStrictEqual((await b.js(tilesNow)).slice(0, 5), ["hotkey:403", "hotkey:404", "hotkey:405", "hotkey:406", "hotkey:49"]);
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "RödIngen");
  await b.key("five");
  assert.strictEqual(await b.js(`document.querySelector("main h2").textContent`), "Snabbknappar · Senaste knapp: 53", "knapptestet visar koden");
  await b.key("ok"); await sleep(200);
  assert.strictEqual(await b.js(`document.querySelector("main h2").textContent`), "Välj för Röd");
  assert.deepStrictEqual((await b.js(tilesNow)).slice(0, 3), ["key:none", "key:light.vardagsrum", "key:camera.garage"], "favoriter först, bara sådant som går att styra");
  assert.ok(!(await b.js(tilesNow)).includes("key:sensor.kok_temp"), "sensorer går inte att koppla");
  await b.key("right"); await b.key("ok"); await sleep(200);
  assert.deepStrictEqual([await b.js(focused), await b.js(`document.activeElement.textContent`), userData.homedash.keys], ["hotkey:403", "RödVardagsrum", { 403: "light.vardagsrum" }]);
  await b.key("down"); await b.key("right"); await b.key("right"); await b.key("right"); assert.strictEqual(await b.js(focused), "hotkey:53"); // 5:an
  await b.key("ok"); await sleep(200); await b.key("right"); await b.key("right"); await b.key("ok"); await sleep(200);
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "5Garage");
  await b.key("back"); assert.strictEqual(await b.js(focused), "settings:hotkeys");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Snabbknappar2 på");
  // knapparna fungerar var man än är i appen
  await b.js(`document.querySelector('[data-page="home"]').focus()`); await sleep(300);
  n = calls.length; await b.key("red");
  assert.deepStrictEqual([calls.length - n, calls[n].service, calls[n].target.entity_id], [1, "toggle", "light.vardagsrum"], "röd knapp växlar lampan");
  await b.key("five"); await sleep(800);
  assert.deepStrictEqual([await b.js(hiddenEl("viewer")), await b.js(text("viewer-name"))], [false, "Garage"], "5 öppnar kameran");
  await b.key("back");
  n = calls.length; await b.key("blue"); assert.strictEqual(calls.length, n, "okopplad knapp gör inget");

  // --- skärmsläckare ---
  await openSettings(b, "saver");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("main .tile")].map(x => x.textContent)`), ["Starta efterAv", "VisaKameror", "Byt kamera var15 s", "ÖvergångGlid", "Starta nu"]);
  await b.key("ok"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Starta efter1 min");
  assert.strictEqual(userData.homedash.saverAfter, 1);
  await b.key("right"); await b.key("right"); await b.key("right"); await b.key("ok");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "ÖvergångTona");
  await b.key("right"); assert.strictEqual(await b.js(focused), "saverNow"); await b.key("ok"); await sleep(1500);
  assert.strictEqual(await b.js(hiddenEl("saver")), false, "skärmsläckaren visas");
  assert.strictEqual(await b.js(`document.getElementById("saver").dataset.effect`), "fade");
  assert.ok(await b.js(`[...document.querySelectorAll("#saver img")].some(i => i.className === "show" && i.naturalWidth > 0)`), "en kamerabild visas");
  assert.match(await b.js(text("saver-time")), /^\d\d:\d\d$/);
  assert.ok(["Garage", "Ytterdörr"].includes(await b.js(text("saver-cam"))));
  await b.shot("9b-skarmslackare.png");
  await b.key("ok"); await sleep(1200);
  assert.strictEqual(await b.js(hiddenEl("saver")), true, "en knapp avslutar skärmsläckaren");
  assert.strictEqual(await b.js(hiddenEl("viewer")), false, "OK på en kamera öppnar den");
  await b.key("back");
  assert.strictEqual(await b.js(focused), "saverNow", "fokus är kvar i inställningarna");
  await b.key("left"); await b.key("left"); await b.key("left"); await b.key("ok"); // Visa: bara klocka
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "VisaBara klocka");
  await b.key("right"); await b.key("right"); await b.key("right"); await b.key("ok"); await sleep(500);
  assert.ok(await b.js(`document.getElementById("saver").classList.contains("clock-only")`));
  assert.strictEqual(await b.js(`[...document.querySelectorAll("#saver img")].some(i => i.getAttribute("src"))`), false, "inga kamerabilder i klockläget");
  await b.key("back"); assert.strictEqual(await b.js(hiddenEl("saver")), true);
  assert.strictEqual(await b.js(hiddenEl("viewer")), true, "Tillbaka öppnar ingen kamera");
  await b.key("left"); await b.key("left"); await b.key("left"); await b.key("left"); await b.key("ok"); // Starta efter: 2 min
  await b.key("ok"); await b.key("ok"); await b.key("ok"); await b.key("ok"); // 5, 10, 30, Av
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Starta efterAv");

  // --- utloggning ---
  await openSettings(b, "account");
  assert.strictEqual(await b.js(focused), "logout");
  await b.key("ok"); await sleep(600);
  assert.strictEqual(await b.js(hiddenEl("setup")), false, "utloggad, guiden visas");
  assert.strictEqual(await b.js(`localStorage.getItem("auth")`), null);
  assert.strictEqual(revoked, 1, "token återkallas hos HA");
  assert.strictEqual(await b.js(`document.querySelectorAll("main .tile[data-id]").length`), 0, "inga enheter ligger kvar på skärmen");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".rail-item")].map(x => x.textContent)`), ["Hem", "Kameror", "Inställningar"], "rummen försvinner ur menyn");

  // --- återkallad inloggning: tillbaka till guiden, inga upprepade försök ---
  await b.js(`localStorage.setItem("auth", JSON.stringify({ url: "http://127.0.0.1:${PORT}", client_id: "http://127.0.0.1:${PORT}/", refresh_token: "REFRESH" }))`);
  refreshOk = false; const before = hits.filter(h => h === "POST /auth/token").length;
  await b.load(); await sleep(6000);
  assert.strictEqual(await b.js(hiddenEl("setup")), false);
  assert.strictEqual(await b.js(text("setup-msg")), "Inloggningen gäller inte längre. Logga in igen.");
  assert.strictEqual(hits.filter(h => h === "POST /auth/token").length - before, 1, "ett enda försök");
  assert.strictEqual(await b.js(`localStorage.getItem("auth")`), null);
  b.close();

  // --- färdig inloggning och kamera via startparametrar ---
  b = await browser(fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-")), { url: "127.0.0.1:" + PORT, token: "LONGLIVED", camera: "camera.garage" });
  assert.strictEqual(await b.js(hiddenEl("setup")), true);
  assert.strictEqual(wsAuth[wsAuth.length - 1], "LONGLIVED");
  assert.strictEqual(await b.js(text("viewer-name")), "Garage", "startar direkt på kameran");
  b.close();

  // --- fel långlivad token ---
  b = await browser(fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-")), { url: "127.0.0.1:" + PORT, token: "FEL" });
  const tries = wsAuth.length; await sleep(6000);
  assert.strictEqual(await b.js(hiddenEl("setup")), false, "ogiltig token leder till guiden");
  assert.strictEqual(wsAuth.length, tries, "inga upprepade inloggningsförsök");
  b.close();

  // --- inloggning från mobilen via QR-kod ---
  refreshOk = true;
  b = await browser(fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-")), null, FAKE_BRIDGE);
  assert.strictEqual(await b.js(hiddenEl("pair")), false, "QR-koden visas");
  assert.ok(await b.js(`!!document.querySelector("#pair-qr svg")`));
  assert.strictEqual(await b.js(`window.__started.subscribe`), true);
  await b.shot("9-qr.png");
  await b.js(`window.__pair({ url: "inte en adress", token: "x" })`); await sleep(400);
  assert.strictEqual(await b.js(text("setup-msg")), "Adressen från mobilen gick inte att använda");
  await b.js(`window.__pair({ url: "127.0.0.1:${PORT}", username: "anna", password: "fel" })`); await sleep(1200);
  assert.strictEqual(await b.js(text("setup-msg")), "Fel användarnamn eller lösenord");
  assert.strictEqual(await b.js(hiddenEl("pair")), false, "QR-koden finns kvar för nytt försök");
  await b.js(`window.__pair({ url: "127.0.0.1:${PORT}", username: "anna", password: "hemligt" })`); await sleep(2000);
  assert.strictEqual(await b.js(hiddenEl("setup")), true, "inloggad via mobilen");
  assert.ok((await b.js(tilesNow)).length > 0);
  assert.strictEqual(JSON.parse(await b.js(`localStorage.getItem("auth")`)).refresh_token, "REFRESH");
  assert.ok(await b.js(`window.__cancelled`) >= 1, "parningstjänsten stängs när man är inloggad");
  assert.strictEqual(await b.js(`document.querySelector("#pair-qr").childElementCount`), 0);
  b.close();

  b = await browser(fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-")), null, FAKE_BRIDGE);
  await b.js(`window.__pair({ url: "127.0.0.1:${PORT}", token: "LONGLIVED" })`); await sleep(1500);
  assert.strictEqual(await b.js(hiddenEl("setup")), true, "inloggad med token från mobilen");
  assert.strictEqual(wsAuth[wsAuth.length - 1], "LONGLIVED");
  b.close();

  const LOGIN = { url: "127.0.0.1:" + PORT, token: "LONGLIVED" }, fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), "homedash-e2e-"));
  const bodyMode = `document.body.className`, shownEl = id => `document.getElementById("${id}").getClientRects().length > 0`; // false även när en förälder är dold
  userData.homedash = { domains: ["light", "lock", "climate"], hidden: [], favorites: ["light.vardagsrum", "lock.ytterdorr", "camera.garage", "light.trasig", "light.finns_inte"], side: "left", startMenu: false };
  states.find(x => x.entity_id === "lock.ytterdorr").state = "locked";

  // --- notis när appen inte är igång: bara kortet ritas, resten av TV-bilden syns ---
  b = await browser(fresh(), { ...LOGIN, title: "Dörrklockan", message: "Någon ringer på", camera: "camera.garage", timeout: 4, position: "bottom-left" });
  assert.strictEqual(await b.js(bodyMode), "notice");
  assert.strictEqual(await b.js(`getComputedStyle(document.body).backgroundImage + getComputedStyle(document.body).backgroundColor`), "nonergba(0, 0, 0, 0)", "skärmen runt kortet är genomskinlig");
  assert.deepStrictEqual([await b.js(shownEl("main")), await b.js(shownEl("rail")), await b.js(shownEl("card"))], [false, false, true], "appens vanliga innehåll visas inte");
  assert.strictEqual(await b.js(`document.getElementById("card").className`), "bottom-left");
  assert.deepStrictEqual([await b.js(text("card-title")), await b.js(text("card-msg")), await b.js(text("card-live"))], ["Dörrklockan", "Någon ringer på", "LIVE · Garage"]);
  assert.ok(await b.js(`!document.getElementById("card-media").hidden && document.getElementById("card-img").naturalWidth > 0`), "kamerabilden visas");
  assert.ok(hits.includes("GET /api/camera_proxy_stream/camera.garage?token=tok2"));
  await b.shot("11-notis.png");
  assert.notStrictEqual(await b.js(`window.__closed`), true, "ligger kvar under tiden");
  await sleep(3000);
  assert.strictEqual(await b.js(`window.__closed`), true, "appen stänger sig själv efter angiven tid");
  b.close();

  // OK på en notis med kamera förstorar den till helskärm i appen
  b = await browser(fresh(), { ...LOGIN, message: "Rörelse vid garaget", camera: "camera.garage", timeout: 0 });
  assert.strictEqual(await b.js(text("card-hint")), "OK förstora · Tillbaka stäng");
  await sleep(1000); assert.notStrictEqual(await b.js(`window.__closed`), true, "timeout 0 ligger kvar");
  await b.key("ok"); await sleep(1200);
  assert.strictEqual(await b.js(bodyMode), "full");
  assert.deepStrictEqual([await b.js(hiddenEl("card")), await b.js(hiddenEl("viewer")), await b.js(text("viewer-name"))], [true, false, "Garage"]);
  // ▲ fäster kameran ovanpå TV-bilden igen
  await b.key("up"); await sleep(500);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("viewer")), await b.js(hiddenEl("card")), await b.js(text("card-title"))], ["notice", true, false, "Garage"]);
  assert.strictEqual(await b.js(hiddenEl("card-bar")), true, "ingen nedräkning när kortet ligger kvar");
  await b.key("back"); assert.strictEqual(await b.js(`window.__closed`), true, "Tillbaka stänger och lämnar tillbaka TV-bilden");
  b.close();

  // notis medan man använder appen: kortet visas ovanpå, appen stängs inte
  b = await browser(fresh(), LOGIN);
  assert.strictEqual(await b.js(bodyMode), "full");
  await b.js(`document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { title: "Tvätten är klar", timeout: 2 } }))`); await sleep(300);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("card")), await b.js(hiddenEl("card-media")), await b.js(text("card-title"))], ["full", false, true, "Tvätten är klar"]);
  await sleep(2200);
  assert.deepStrictEqual([await b.js(hiddenEl("card")), await b.js(`window.__closed`)], [true, undefined]);
  // samma notis när appen ligger i bakgrunden: hela appen ska inte dras fram över det man tittar på
  await b.js(`Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { title: "I bakgrunden", timeout: 0 } }))`); await sleep(300);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(text("card-title"))], ["notice", "I bakgrunden"]);
  await b.js(`Object.defineProperty(document, "hidden", { value: false, configurable: true })`);
  // appikonen i applistan tar fram hela appen igen
  await sleep(1600); await b.js(`document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: {} }))`); await sleep(300);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("card"))], ["full", true]);

  // inställningar för ovanpå TV
  await openSettings(b, "overTv");
  assert.strictEqual(await b.js(focused), "set:startMenu");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Vid startHela appen");
  await b.key("ok");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Vid startSnabbmeny");
  assert.strictEqual(userData.homedash.startMenu, true);
  await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Snabbmenyns sidaVänster");

  // --- snabbmeny vid start ---
  await b.load();
  assert.strictEqual(await b.js(bodyMode), "menu");
  assert.deepStrictEqual([await b.js(shownEl("main")), await b.js(shownEl("drawer")), await b.js(`document.getElementById("drawer").className`)], [false, true, "left"]);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".fav span")].map(x => x.textContent)`), ["Garage", "Vardagsrum", "Ytterdörr lås", "Öppna HomeDash"], "otillgängliga och borttagna favoriter visas inte");
  assert.strictEqual(await b.js(`document.activeElement.querySelector("span").textContent`), "Garage");
  await b.shot("12-snabbmeny.png");
  const lit = states.find(x => x.entity_id === "light.vardagsrum").state === "on";
  await b.key("down"); n = calls.length; await b.key("ok");
  assert.deepStrictEqual([calls.length - n, calls[n].service, calls[n].target.entity_id], [1, "toggle", "light.vardagsrum"]);
  assert.strictEqual(await b.js(`document.activeElement.classList.contains("on")`), !lit, "raden följer lampans läge");
  await b.key("down"); n = calls.length; await b.key("ok");
  assert.strictEqual(calls.length, n); assert.strictEqual(await b.js(text("drawer-info")), "Tryck OK igen för att låsa upp Ytterdörr lås");
  await b.key("ok");
  assert.deepStrictEqual([calls.length - n, calls[n].service], [1, "unlock"]);
  assert.strictEqual(await b.js(`document.activeElement.querySelector("small").textContent`), "Olåst");
  await b.key("down"); await b.key("down"); assert.strictEqual(await b.js(`document.activeElement.querySelector("span").textContent`), "Öppna HomeDash", "stannar på sista raden");
  await b.key("ok");
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(shownEl("drawer")), await b.js(shownEl("main"))], ["full", false, true], "Öppna HomeDash visar hela appen");
  assert.ok(await b.js(focused), "något i appen har fokus");
  await b.js(`document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { menu: true } }))`); await sleep(300);
  assert.strictEqual(await b.js(bodyMode), "menu", "snabbmenyn går att öppna även inifrån appen");
  // kamera i snabbmenyn fästs i hörnet
  await b.load();
  await b.key("ok"); await sleep(800);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(shownEl("drawer")), await b.js(text("card-title"))], ["notice", false, "Garage"]);
  await b.key("back"); assert.strictEqual(await b.js(`window.__closed`), true);
  await b.js(`window.__closed = false`);
  await b.load(); await b.key("back");
  assert.strictEqual(await b.js(`window.__closed`), true, "Tillbaka i snabbmenyn stänger den");
  b.close();

  // skriptet kört utan några fält (tomma strängar): en testnotis visas
  b = await browser(fresh(), { ...LOGIN, title: "", message: "", camera: "", timeout: 15, position: "top-right" });
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("card")), await b.js(text("card-msg")), await b.js(hiddenEl("card-media"))],
    ["notice", false, "Testnotis. Fyll i rubrik, text eller kamera för att visa något eget.", true]);
  b.close();

  // --- notis med knappar ---
  const ACTIONS = [{ label: "Lås upp", service: "lock.unlock", entity_id: "lock.ytterdorr" }, { label: "Ignorera", event: "ignore", data: { who: "tv" } }];
  b = await browser(fresh(), { ...LOGIN, title: "Dörrklockan", camera: "camera.dorr", timeout: 0, actions: ACTIONS });
  await sleep(500);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("#card-actions button")].map(x => x.textContent)`), ["Lås upp", "Ignorera", "Öppna"], "knapparna plus Öppna när det finns kamera");
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "Lås upp");
  await b.key("right"); await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Öppna");
  await b.key("right"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Öppna", "stannar på sista");
  await b.shot("14-notis-knappar.png");
  await b.key("ok"); await sleep(800);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(text("viewer-name"))], ["full", "Ytterdörr"], "Öppna förstorar kameran");
  b.close();
  b = await browser(fresh(), { ...LOGIN, title: "Dörrklockan", timeout: 0, actions: ACTIONS });
  await sleep(500);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("#card-actions button")].map(x => x.textContent)`), ["Lås upp", "Ignorera"]);
  n = calls.length; await b.key("ok"); await sleep(300);
  assert.deepStrictEqual([calls[n].domain, calls[n].service, calls[n].target.entity_id, await b.js(`window.__closed`)], ["lock", "unlock", "lock.ytterdorr", true], "knappen kör tjänsten och stänger notisen");
  b.close();
  b = await browser(fresh(), { ...LOGIN, message: "Rörelse", timeout: 0, actions: [ACTIONS[1]] });
  await sleep(500); await b.key("ok"); await sleep(300);
  assert.deepStrictEqual([events[events.length - 1], await b.js(`window.__closed`)], [["homedash_action", { action: "ignore", who: "tv" }], true], "knappen skickar en händelse till HA");
  b.close();
  b = await browser(fresh(), { ...LOGIN, message: "Skräp", timeout: 0, actions: [null, "x", { label: "" }, { label: "Ok" }, { label: "Två" }, { label: "Tre" }, { label: "Fyra" }, { label: "Fem" }] });
  await sleep(500);
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll("#card-actions button")].map(x => x.textContent)`), ["Ok", "Två", "Tre", "Fyra"], "ogiltiga knappar hoppas över, högst fyra");
  b.close();

  // --- demoläge ---
  b = await browser(fresh());
  assert.strictEqual(await b.js(hiddenEl("setup")), false);
  await b.key("down"); await b.key("down"); assert.strictEqual(await b.js(focused), "demo-btn");
  await b.key("ok"); await sleep(2500);
  assert.strictEqual(await b.js(hiddenEl("setup")), true, "demot startar utan server");
  assert.strictEqual(await b.js(text("status")), "Demo. Inget är kopplat på riktigt.");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".rail-item span")].map(x => x.textContent)`), ["Hem", "Kameror", "Hall", "Kök", "Sovrum", "Ute", "Vardagsrum", "Inställningar"]);
  assert.ok(await b.js(`[...document.querySelectorAll("main .tile.cam img")].every(i => i.naturalWidth > 0)`), "demokamerorna har bilder");
  assert.ok((await b.js(`document.querySelectorAll(".forecast").length`)) === 5, "demot har prognos");
  await b.shot("15-demo.png");
  await b.js(`document.querySelector('[data-page="room:vardagsrum"]').focus()`); await sleep(300);
  await b.key("right"); const demoTile = await b.js(focused); assert.ok(demoTile.startsWith("light."), demoTile);
  const wasOn = await b.js(`document.activeElement.classList.contains("on")`);
  await b.key("ok"); await sleep(300);
  assert.strictEqual(await b.js(`document.activeElement.classList.contains("on")`), !wasOn, "lampor går att tända och släcka i demot");
  await b.key("right"); assert.strictEqual(await b.js(focused), "light.taklampa");
  await b.key("ok", 800);
  assert.deepStrictEqual(await b.js(panelRows), ["main", "temp", "hue"], "demolampan har färg");
  await b.key("back");
  await b.js(`document.querySelector('[data-page="cameras"]').focus()`); await sleep(300);
  await b.key("right"); await b.key("right"); await b.key("ok"); await sleep(800);
  assert.strictEqual(await b.js(`!document.getElementById("mjpeg").hidden && document.getElementById("mjpeg").naturalWidth > 0`), true, "kameravyn visar demobild");
  await b.key("back");
  await openSettings(b, "account");
  await b.key("ok"); await sleep(500);
  assert.strictEqual(await b.js(hiddenEl("setup")), false, "utloggning lämnar demot");
  b.close();

  // --- skärmsläckaren startad av HA: visas direkt, en knapp lämnar tillbaka TV-bilden ---
  b = await browser(fresh(), { ...LOGIN, saver: true });
  await sleep(1000);
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("saver"))], ["full", false], "skärmsläckaren startar direkt");
  assert.ok(await b.js(`[...document.querySelectorAll("#saver img")].some(i => i.className === "show" && i.naturalWidth > 0)`));
  await b.key("back"); await sleep(300);
  assert.deepStrictEqual([await b.js(hiddenEl("saver")), await b.js(`window.__closed`)], [true, true], "appen stänger sig och lämnar tillbaka TV-bilden");
  b.close();
  b = await browser(fresh(), { ...LOGIN, saver: true });
  await sleep(1000); await b.key("ok"); await sleep(1200);
  assert.deepStrictEqual([await b.js(hiddenEl("saver")), await b.js(hiddenEl("viewer")), await b.js(`window.__closed`)], [true, false, undefined], "OK på en kamera öppnar den i appen i stället");
  b.close();

  // --- Home Assistant sätts upp från TV:n: integrationen, skripten och blueprints ---
  b = await browser(fresh(), LOGIN, FAKE_BRIDGE_IP);
  await openSettings(b, "ha");
  assert.deepStrictEqual(await b.js(tilesNow), ["ha:tv", "ha:scripts", "ha:blueprints"]);
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "TV in Home AssistantSaknas. Tryck för att lägga till".replace("TV in Home Assistant", "TV:n i Home Assistant"));
  await b.key("ok"); await sleep(1500);
  assert.deepStrictEqual(flowSteps.map(x => x[1]), [{ handler: "webostv", show_advanced_options: false }, { host: "192.168.1.96" }, {}], "flödet: starta, ange TV:ns adress, bekräfta parningen. toast=" + await b.js(text("toast")) + " hits=" + hits.slice(-3).join(",") + " focus=" + await b.js(focused));
  assert.strictEqual(await b.js(`document.activeElement.textContent`), "TV:n i Home AssistantNy TV", "TV:n hittas efter att den lagts till");
  assert.strictEqual(await b.js(text("toast")), "TV:n är tillagd i Home Assistant");
  await b.key("right"); await b.key("ok"); await sleep(800);
  assert.deepStrictEqual(Object.keys(scriptsSaved), ["homedash_notify", "homedash_menu", "homedash_screensaver"]);
  assert.strictEqual(scriptsSaved.homedash_notify.sequence[1].target.entity_id, "media_player.ny_tv", "skripten pekar på den tillagda TV:n");
  assert.strictEqual(scriptsSaved.homedash_notify.sequence[1].data.payload.id, "io.github.haansen.homedash");
  assert.strictEqual(await b.js(`document.activeElement.className`), "tile dev action on");
  await b.key("right"); await b.key("ok"); await sleep(800);
  assert.deepStrictEqual(Object.keys(blueprintsSaved), ["homedash/camera_on_tv.yaml", "homedash/screensaver_when_idle.yaml"]);
  assert.ok(blueprintsSaved["homedash/camera_on_tv.yaml"].yaml.includes("integration: webostv") && blueprintsSaved["homedash/camera_on_tv.yaml"].allow_override);
  assert.strictEqual(await b.js(text("toast")), "Blueprints tillagda. Hittas under Automationer i Home Assistant.");
  await b.key("back"); assert.strictEqual(await b.js(`document.activeElement.textContent`), "Home AssistantNy TV");
  b.close();

  // --- språk: appen följer TV:ns språk, okända språk får engelska ---
  b = await browser(fresh(), LOGIN, null, null, "de-DE");
  assert.strictEqual(await b.js(`document.documentElement.lang`), "de");
  assert.deepStrictEqual(await b.js(`[...document.querySelectorAll(".rail-item span")].map(x => x.textContent).slice(0, 2)`), ["Zuhause", "Kameras"]);
  assert.strictEqual(await b.js(`[...document.querySelectorAll(".rail-item span")].pop().textContent`), "Einstellungen");
  assert.match(await b.js(text("date")), /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/, "datumet följer språket");
  b.close();
  b = await browser(fresh(), LOGIN, null, null, "nn-NO");
  assert.strictEqual(await b.js(`document.documentElement.lang`), "nb", "nynorsk får bokmålstexterna");
  b.close();
  b = await browser(fresh(), LOGIN, null, null, "ja-JP");
  assert.deepStrictEqual([await b.js(`document.documentElement.lang`), await b.js(`document.querySelector(".rail-item span").textContent`)], ["en", "Home"], "språk utan översättning får engelska");
  b.close();

  // inte inloggad: notis kan inte visas, inloggningen tas fram i stället
  b = await browser(fresh(), { title: "Hej", timeout: 5 });
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(hiddenEl("setup")), await b.js(hiddenEl("card"))], ["full", false, true]);
  b.close();

  // --- butiksvarianten: vanligt fönster, allt visas inne i appen ---
  const store = fresh();
  fs.cpSync(path.resolve(__dirname, "../app"), path.join(store, "app"), { recursive: true });
  fs.writeFileSync(path.join(store, "app/variant.js"), "const OVERLAY_WINDOW = false;\n");
  b = await browser(fresh(), { ...LOGIN, title: "Dörrklockan", camera: "camera.garage", timeout: 0 }, null, "file://" + path.join(store, "app/index.html"));
  assert.deepStrictEqual([await b.js(bodyMode), await b.js(shownEl("main")), await b.js(hiddenEl("card")), await b.js(text("card-title"))], ["full", true, false, "Dörrklockan"]);
  await openSettings(b);
  assert.ok(!(await b.js(tilesNow)).includes("settings:overTv"), "inga inställningar för ovanpå TV");
  await b.key("back"); assert.strictEqual(await b.js(hiddenEl("card")), true, "Tillbaka stänger kortet");
  assert.notStrictEqual(await b.js(`window.__closed`), true);
  b.close();

  console.log("E2E OK");
  process.exit(0);
})().catch(e => { console.error("E2E FEL:", e.message, "\n" + String(e.stack).split("\n").filter(l => l.includes("e2e.js")).slice(0, 2).join("\n")); procs.forEach(p => p.kill()); process.exit(1); });
