// Demo mode: a fake Home Assistant inside the app, so it can be tried without a server (and so LG's reviewers can test it).
// DemoSocket mimics the part of HA's WebSocket API that the app uses.
const DEMO_URL = "demo";

function demoStates() {
  const s = (entity_id, state, friendly_name, extra) => ({ entity_id, state, attributes: Object.assign({ friendly_name }, extra || {}), last_changed: new Date().toISOString() });
  const now = Date.now();
  return [
    s("camera.entre", "recording", LANG === "sv" ? "Entré" : "Entrance", { access_token: "d1" }),
    s("camera.tradgard", "recording", LANG === "sv" ? "Trädgård" : "Garden", { access_token: "d2" }),
    s("camera.garage", "recording", "Garage", { access_token: "d3" }),
    s("image.entre_person", new Date(now - 600000).toISOString(), LANG === "sv" ? "Entré person" : "Entrance person", { access_token: "d4" }),
    s("light.taklampa", "on", LANG === "sv" ? "Taklampa" : "Ceiling light", { brightness: 200, supported_color_modes: ["color_temp", "hs"], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000 }),
    s("light.fonster", "off", LANG === "sv" ? "Fönsterlampa" : "Window lamp", { supported_color_modes: ["brightness"] }),
    s("light.koksbank", "on", LANG === "sv" ? "Köksbänk" : "Kitchen counter", { brightness: 120, supported_color_modes: ["brightness"] }),
    s("light.sanglampa", "off", LANG === "sv" ? "Sänglampa" : "Bedside lamp", { supported_color_modes: ["onoff"] }),
    s("light.ute", "on", LANG === "sv" ? "Utebelysning" : "Outdoor lights", { supported_color_modes: ["onoff"] }),
    s("switch.kaffe", "off", LANG === "sv" ? "Kaffebryggare" : "Coffee maker"),
    s("cover.markis", "open", LANG === "sv" ? "Markis" : "Awning", { current_position: 70 }),
    s("cover.garageport", "closed", LANG === "sv" ? "Garageport" : "Garage door", { device_class: "garage" }),
    s("climate.varmepump", "heat", LANG === "sv" ? "Värmepump" : "Heat pump", { min_temp: 16, max_temp: 30, target_temp_step: 0.5, temperature: 21.5, current_temperature: 20.8, hvac_modes: ["off", "heat", "cool", "auto"], fan_modes: ["auto", "low", "high"], fan_mode: "auto" }),
    s("media_player.vardagsrum", "playing", LANG === "sv" ? "Vardagsrum" : "Living room", { volume_level: 0.35, media_title: "Demo FM", source_list: ["Radio", "Spotify", "TV"], source: "Radio", is_volume_muted: false }),
    s("lock.ytterdorr", "locked", LANG === "sv" ? "Ytterdörr" : "Front door"),
    s("alarm_control_panel.hem", "disarmed", LANG === "sv" ? "Hemlarm" : "Home alarm", { code_format: "number", supported_features: 3 }),
    s("vacuum.robot", "docked", LANG === "sv" ? "Dammsugare" : "Vacuum"),
    s("sensor.temp_ute", "7.4", LANG === "sv" ? "Temperatur ute" : "Outdoor temperature", { unit_of_measurement: "°C", device_class: "temperature" }),
    s("sensor.fukt_badrum", "58", LANG === "sv" ? "Fuktighet badrum" : "Bathroom humidity", { unit_of_measurement: "%", device_class: "humidity" }),
    s("sensor.el", "1.8", LANG === "sv" ? "Elförbrukning" : "Power use", { unit_of_measurement: "kW", device_class: "power" }),
    s("binary_sensor.ytterdorr", "off", LANG === "sv" ? "Ytterdörr" : "Front door", { device_class: "door" }),
    s("binary_sensor.rorelse_hall", "on", LANG === "sv" ? "Rörelse hall" : "Hallway motion", { device_class: "motion" }),
    s("scene.mys", "unknown", LANG === "sv" ? "Myskväll" : "Cozy evening"),
    s("scene.natt", "unknown", LANG === "sv" ? "Natt" : "Night"),
    s("weather.hemma", "partlycloudy", LANG === "sv" ? "Hemma" : "Home", { temperature: 7.4 }),
  ];
}

const DEMO_AREAS = LANG === "sv"
  ? [["vardagsrum", "Vardagsrum"], ["kok", "Kök"], ["sovrum", "Sovrum"], ["ute", "Ute"], ["hall", "Hall"]]
  : [["vardagsrum", "Living room"], ["kok", "Kitchen"], ["sovrum", "Bedroom"], ["ute", "Outdoors"], ["hall", "Hallway"]];
const DEMO_ROOMS = { "camera.entre": "hall", "camera.tradgard": "ute", "camera.garage": "ute", "image.entre_person": "hall", "light.taklampa": "vardagsrum", "light.fonster": "vardagsrum",
  "light.koksbank": "kok", "light.sanglampa": "sovrum", "light.ute": "ute", "switch.kaffe": "kok", "cover.markis": "ute", "cover.garageport": "ute", "climate.varmepump": "vardagsrum",
  "media_player.vardagsrum": "vardagsrum", "lock.ytterdorr": "hall", "alarm_control_panel.hem": "hall", "vacuum.robot": "vardagsrum", "sensor.temp_ute": "ute",
  "sensor.fukt_badrum": "sovrum", "sensor.el": "kok", "binary_sensor.ytterdorr": "hall", "binary_sensor.rorelse_hall": "hall", "scene.mys": "vardagsrum", "scene.natt": "sovrum" };

// a "camera image": an SVG with the camera name and the time, so you can see it updating
function demoPicture(name, seed) {
  const hue = (seed * 47) % 360, time = new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},40%,35%)"/><stop offset="1" stop-color="hsl(${hue},50%,12%)"/></linearGradient></defs>` +
    `<rect width="640" height="360" fill="url(#g)"/><circle cx="${100 + (seed * 90) % 400}" cy="120" r="34" fill="#ffffff55"/>` +
    `<rect x="0" y="260" width="640" height="100" fill="#00000055"/><text x="24" y="330" font-family="sans-serif" font-size="34" fill="#fff">${name}</text>` +
    `<text x="616" y="330" text-anchor="end" font-family="sans-serif" font-size="26" fill="#ffffffcc">${time}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// State texts for the demo, the way HA would deliver them for the TV's language (Swedish and English here, English otherwise)
const DEMO_STATES_TEXT = (function () {
  const sv = { "climate._.heat": "Värme", "climate._.cool": "Kyla", "climate._.auto": "Auto", "climate._.off": "Av", "lock._.locked": "Låst", "lock._.unlocked": "Olåst",
    "vacuum._.docked": "Dockad", "vacuum._.cleaning": "Städar", "vacuum._.returning": "På väg hem", "vacuum._.paused": "Pausad", "cover._.open": "Öppen", "cover._.closed": "Stängd",
    "media_player._.playing": "Spelar", "media_player._.paused": "Pausad", "binary_sensor.door.on": "Öppen", "binary_sensor.door.off": "Stängd", "binary_sensor.motion.on": "Rörelse", "binary_sensor.motion.off": "Tom",
    "alarm_control_panel._.disarmed": "Avlarmat", "alarm_control_panel._.armed_home": "Larmat hemma", "alarm_control_panel._.armed_away": "Larmat borta" };
  const en = { "climate._.heat": "Heat", "climate._.cool": "Cool", "climate._.auto": "Auto", "climate._.off": "Off", "lock._.locked": "Locked", "lock._.unlocked": "Unlocked",
    "vacuum._.docked": "Docked", "vacuum._.cleaning": "Cleaning", "vacuum._.returning": "Returning", "vacuum._.paused": "Paused", "cover._.open": "Open", "cover._.closed": "Closed",
    "media_player._.playing": "Playing", "media_player._.paused": "Paused", "binary_sensor.door.on": "Open", "binary_sensor.door.off": "Closed", "binary_sensor.motion.on": "Detected", "binary_sensor.motion.off": "Clear",
    "alarm_control_panel._.disarmed": "Disarmed", "alarm_control_panel._.armed_home": "Armed home", "alarm_control_panel._.armed_away": "Armed away" };
  const out = {};
  Object.entries(LANG === "sv" ? sv : en).forEach(([k, v]) => { const [d, dc, st] = k.split("."); out[`component.${d}.entity_component.${dc}.state.${st}`] = v; });
  return out;
})();

class DemoSocket {
  constructor() {
    this.readyState = 1;
    this.states = demoStates();
    this.subs = {};
    setTimeout(() => this.emit({ type: "auth_required" }), 0);
    this.ticker = setInterval(() => { // the sensors are alive
      const temp = this.byId("sensor.temp_ute"), power = this.byId("sensor.el");
      temp.state = (Number(temp.state) + (Math.random() - 0.5) * 0.2).toFixed(1); power.state = (1.2 + Math.random()).toFixed(1);
      this.changed(temp); this.changed(power);
    }, 5000);
  }
  byId(id) { return this.states.find(x => x.entity_id === id); }
  emit(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
  reply(id, result) { setTimeout(() => this.emit({ id, type: "result", success: true, result }), 0); }
  changed(s) { s.last_changed = new Date().toISOString(); if (this.subs.state) this.emit({ id: this.subs.state, type: "event", event: { data: { entity_id: s.entity_id, new_state: s } } }); }
  close() { clearInterval(this.ticker); this.readyState = 3; }

  send(raw) {
    const m = JSON.parse(raw), a = m.service_data || {};
    switch (m.type) {
      case "auth": return setTimeout(() => this.emit({ type: "auth_ok" }), 0);
      case "get_states": return this.reply(m.id, this.states);
      case "config/area_registry/list": return this.reply(m.id, DEMO_AREAS.map(([area_id, name]) => ({ area_id, name })));
      case "config/entity_registry/list": return this.reply(m.id, this.states.map(s => ({ entity_id: s.entity_id, area_id: DEMO_ROOMS[s.entity_id] || null, platform: "demo" })));
      case "config/device_registry/list": return this.reply(m.id, []);
      case "frontend/get_translations": return this.reply(m.id, { resources: m.category === "entity_component" ? DEMO_STATES_TEXT : {} });
      case "get_services": return this.reply(m.id, {});
      case "frontend/get_user_data": return this.reply(m.id, { value: null });
      case "frontend/set_user_data": return this.reply(m.id, null);
      case "subscribe_events": this.subs.state = m.id; return this.reply(m.id, null);
      case "weather/subscribe_forecast": {
        this.reply(m.id, null);
        const conds = ["sunny", "partlycloudy", "rainy", "cloudy", "snowy"];
        return setTimeout(() => this.emit({ id: m.id, type: "event", event: { type: "daily", forecast: [0, 1, 2, 3, 4].map(i => ({ datetime: new Date(Date.now() + i * 86400000).toISOString(), condition: conds[i], temperature: 12 - i, templow: 4 - i })) } }), 10);
      }
      case "history/history_during_period": {
        const id = m.entity_ids[0], base = Number(this.byId(id).state) || 0, now = Date.now();
        return this.reply(m.id, { [id]: Array.from({ length: 48 }, (_, i) => ({ lu: (now - (48 - i) * 1800000) / 1000, s: (base + Math.sin(i / 5) * 2).toFixed(1) })) });
      }
      case "camera/stream": return setTimeout(() => this.emit({ id: m.id, type: "result", success: false, error: { message: "demo" } }), 0);
      case "call_service": {
        const s = this.byId(m.target && m.target.entity_id);
        if (!s) return this.reply(m.id, null);
        const d = m.domain, v = m.service;
        if (v === "toggle") s.state = s.state === "off" || s.state === "closed" ? (d === "cover" ? "open" : "on") : (d === "cover" ? "closed" : "off");
        if (v === "turn_on") { s.state = d === "scene" ? new Date().toISOString() : "on"; if (a.brightness_pct != null) s.attributes.brightness = Math.round(a.brightness_pct * 2.55); if (a.color_temp_kelvin) s.attributes.color_temp_kelvin = a.color_temp_kelvin; if (a.hs_color) s.attributes.hs_color = a.hs_color; }
        if (v === "turn_off") s.state = "off";
        if (v === "lock") s.state = "locked"; if (v === "unlock") s.state = "unlocked";
        if (v === "open_cover") s.state = "open"; if (v === "close_cover") s.state = "closed"; if (v === "set_cover_position") s.attributes.current_position = a.position;
        if (v === "set_temperature") s.attributes.temperature = a.temperature; if (v === "set_hvac_mode") s.state = a.hvac_mode; if (v === "set_fan_mode") s.attributes.fan_mode = a.fan_mode;
        if (v === "media_play_pause") s.state = s.state === "playing" ? "paused" : "playing"; if (v === "volume_set") s.attributes.volume_level = a.volume_level;
        if (v === "select_source") s.attributes.source = a.source; if (v === "volume_mute") s.attributes.is_volume_muted = a.is_volume_muted;
        if (v === "alarm_disarm") s.state = "disarmed"; if (v === "alarm_arm_home") s.state = "armed_home"; if (v === "alarm_arm_away") s.state = "armed_away";
        if (v === "start") s.state = "cleaning"; if (v === "return_to_base") s.state = "returning"; if (v === "pause") s.state = "paused";
        this.reply(m.id, null);
        return this.changed(s);
      }
      default: return this.reply(m.id, null);
    }
  }
}
