// The app's own texts live in lang.js. The language follows the TV's language, otherwise English.
const TEXT = typeof TEXTS !== "undefined" ? TEXTS : require("./lang.js");
const NAV_LANG = (typeof navigator !== "undefined" && navigator.language) || "en-GB";
const LANG_OVERRIDE = (() => { try { return localStorage.getItem("lang") || ""; } catch (e) { return ""; } })(); // chosen in Settings, otherwise the TV's language
const LANG = (() => { const p = (LANG_OVERRIDE || NAV_LANG).split("-")[0].toLowerCase(); const l = { nn: "nb", no: "nb" }[p] || p; return TEXT[l] ? l : "en"; })();
const HA_LANG = (LANG_OVERRIDE || NAV_LANG).split("-")[0].toLowerCase() || "en"; // HA's texts exist in many more languages
const t = (key, ...args) => TEXT[LANG][key].replace(/\{(\d)\}/g, (_, i) => args[i]);

// Every Home Assistant entity type can be shown. Cameras and weather have their own places in the app.
const ORDER = ["light", "switch", "cover", "climate", "fan", "media_player", "lock", "vacuum", "scene", "script"]; // these come first, the rest alphabetically
const DEFAULT_DOMAINS = [...ORDER, "humidifier", "water_heater", "input_boolean", "alarm_control_panel", "image"]; // enabled by default on first start
const WALL_SIZE = 6; // cameras per page in the camera wall
const HOME_DOMAINS = ["light", "switch", "cover", "climate", "fan", "media_player", "lock", "vacuum", "humidifier", "water_heater", "input_boolean", "siren", "valve", "lawn_mower"];
const ACTIVE = ["on", "open", "opening", "unlocked", "unlocking", "playing", "home", "cleaning", "mowing", "active", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"];
const PRESS = ["button", "input_button", "scene"]; // state is only the time of the last press
const LONG_PRESS_MS = 600;
const SNAPSHOT_MS = 5000;
const PROBE_MS = 2500; // how long each address gets during network discovery
const PAIR_SERVICE = "luna://io.github.haansen.homedash.pair";
const NOTICE_SECONDS = 15, MENU_IDLE_MS = 30000;
const THEMES = ["dark", "oled", "light", "ocean", "forest"];
// remote buttons that can be mapped to an entity: the color buttons and the digits
const HOTKEYS = [[403, "red"], [404, "green"], [405, "yellow"], [406, "blue"], [49, "1"], [50, "2"], [51, "3"], [52, "4"], [53, "5"], [54, "6"], [55, "7"], [56, "8"], [57, "9"], [48, "0"]];
const SAVER_AFTER = [0, 1, 2, 5, 10, 30], SAVER_INTERVAL = [5, 10, 15, 30, 60]; // minutes and seconds respectively
const DEFAULTS = { domains: DEFAULT_DOMAINS, hidden: [], favorites: [], side: "right", startMenu: false, theme: "dark", weather: "", keys: {}, tv: "",
  saverAfter: 0, saverContent: "cameras", saverInterval: 15, saverEffect: "slide" };

// next value in a list of options, wrapping around
const nextOption = (list, current) => list[(list.indexOf(current) + 1) % list.length];
const CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"];

// Launch parameters that should be shown as a notification. Just { camera } means "open the camera full screen" instead.
const isNotice = p => p.message != null || p.title != null || !!p.image || p.timeout != null;

// ---- pure logic (tested in ../test/unit.js) ----

const domainOf = id => id.split(".")[0];
const nameOf = s => s.attributes.friendly_name || s.entity_id;
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), LANG);

// reg = the entity's row in HA's registry (may be missing)
function isVisible(s, reg, domains, hidden) {
  return s.state !== "unavailable" && !(hidden && hidden.includes(s.entity_id)) &&
    (domainOf(s.entity_id) === "camera" || domains.includes(domainOf(s.entity_id))) &&
    !(reg && (reg.hidden_by || reg.disabled_by || reg.entity_category));
}

// the entity's own area wins over the device's area
function areaOf(reg, devArea) {
  return (reg && (reg.area_id || devArea[reg.device_id])) || null;
}

const isNum = v => typeof v === "number" ? isFinite(v) : typeof v === "string" && v.trim() !== "" && isFinite(Number(v));
const isActive = s => ACTIVE.includes(s.state);
const REGION = { sv: "sv-SE", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT", nl: "nl-NL", da: "da-DK", nb: "nb-NO", fi: "fi-FI", pl: "pl-PL", pt: "pt-PT" };
const locale = () => LANG_OVERRIDE ? REGION[LANG] || LANG_OVERRIDE : NAV_LANG.toLowerCase().startsWith(LANG === "nb" ? "n" : LANG) ? NAV_LANG : "en-GB";
const num = (v, decimals) => Number(v).toLocaleString(locale(), { maximumFractionDigits: decimals == null ? 2 : decimals });
const withUnit = (text, unit) => !unit ? text : unit === "%" ? t("pct", text) : unit === "°" ? text + "°" : text + " " + unit;

// HA's own translations: the entity's own key first, then the device class (e.g. door: on = Open), then the domain's
function translate(s, reg, tr) {
  const d = domainOf(s.entity_id), dc = s.attributes.device_class;
  return (reg && reg.translation_key && tr[`component.${reg.platform}.entity.${d}.${reg.translation_key}.state.${s.state}`]) ||
    (dc && tr[`component.${d}.entity_component.${dc}.state.${s.state}`]) || tr[`component.${d}.entity_component._.state.${s.state}`] ||
    (s.state === "on" ? t("on") : s.state === "off" ? t("off") : null);
}

function stateText(s, reg, tr) {
  const d = domainOf(s.entity_id), a = s.attributes, st = s.state;
  if (PRESS.includes(d) || (d === "script" && st === "off")) return "";
  if (st === "unknown" || st === "unavailable" || st === "") return t("unknown");
  if (isNum(st) && (a.unit_of_measurement != null || ["sensor", "number", "input_number"].includes(d))) {
    const opt = reg && reg.options && reg.options.sensor;
    return withUnit(num(st, opt && (opt.display_precision != null ? opt.display_precision : opt.suggested_display_precision)), a.unit_of_measurement);
  }
  if (/^\d{4}-\d\d-\d\dT/.test(st) && !isNaN(Date.parse(st)))
    return new Date(st).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (d === "weather") return [a.temperature != null && num(a.temperature, 0) + "°", TEXT[LANG].weather[st] || translate(s, reg, tr || {}) || st].filter(Boolean).join(" · ");
  const word = translate(s, reg, tr || {}) || st;
  if (d === "light" && st === "on" && a.brightness != null) return word + " · " + t("pct", Math.max(1, Math.round(a.brightness / 255 * 100)));
  if (d === "cover" && st !== "closed" && a.current_position != null) return word + " · " + t("pct", a.current_position);
  if (d === "climate" || d === "water_heater") {
    const temp = st === "off" ? a.current_temperature : a.temperature;
    return temp == null ? word : word + " · " + num(temp, 1) + "°";
  }
  if (d === "media_player" && st === "playing") return a.media_title || a.app_name || word;
  return word;
}

// What OK does. null = the entity is read-only.
function action(s) {
  const d = domainOf(s.entity_id), st = s.state, dc = s.attributes.device_class;
  const call = (domain, service, confirm, data) => ({ domain, service, confirm: confirm || null, data: data || {} });
  if (st === "unavailable") return null;
  if (["light", "switch", "input_boolean", "fan", "humidifier", "siren", "automation", "group", "remote"].includes(d)) return call("homeassistant", "toggle");
  if (d === "cover") return call(d, "toggle", ["garage", "gate", "door"].includes(dc) && st === "closed" && "confirmOpen");
  if (d === "valve") return call(d, "toggle");
  if (d === "climate" || d === "water_heater") return call(d, st === "off" ? "turn_on" : "turn_off");
  if (d === "lock") return st === "locked" ? call(d, "unlock", "confirmUnlock") : call(d, "lock");
  if (d === "media_player") return call(d, ["playing", "paused"].includes(st) ? "media_play_pause" : ["off", "standby"].includes(st) ? "turn_on" : "turn_off");
  if (d === "vacuum") return call(d, st === "cleaning" ? "return_to_base" : "start");
  if (d === "lawn_mower") return call(d, st === "mowing" ? "dock" : "start_mowing");
  if (d === "button" || d === "input_button") return call(d, "press");
  if (d === "scene" || d === "script") return call(d, "turn_on");
  if (d === "select" || d === "input_select") return call(d, "select_next", null, { cycle: true });
  if (d === "timer") return call(d, st === "active" ? "pause" : "start");
  return null;
}

// What a long press on OK adjusts. null = no slider. call(v) returns [domain, service, data].
function slider(s) {
  const d = domainOf(s.entity_id), a = s.attributes;
  const make = (min, max, step, value, unit, call) =>
    isNum(min) && isNum(max) && isNum(value) && max > min && step > 0 ? { min, max, step, value: Math.max(min, Math.min(max, value)), unit, call } : null;
  if (d === "light" && (a.supported_color_modes || []).some(m => m !== "onoff"))
    return make(0, 100, 10, s.state === "on" ? Math.round((a.brightness || 255) / 255 * 100) : 0, "%", v => v ? ["light", "turn_on", { brightness_pct: v }] : ["light", "turn_off", {}]);
  if (d === "cover" && a.current_position != null) return make(0, 100, 10, a.current_position, "%", v => [d, "set_cover_position", { position: v }]);
  if (d === "fan" && a.percentage != null) return make(0, 100, 10, s.state === "on" ? a.percentage : 0, "%", v => [d, "set_percentage", { percentage: v }]);
  if (d === "media_player" && a.volume_level != null) return make(0, 100, 5, Math.round(a.volume_level * 100), "%", v => [d, "volume_set", { volume_level: v / 100 }]);
  if ((d === "climate" || d === "water_heater") && a.temperature != null) return make(a.min_temp, a.max_temp, a.target_temp_step || 0.5, a.temperature, "°", v => [d, "set_temperature", { temperature: v }]);
  if (d === "humidifier" && a.humidity != null) return make(a.min_humidity == null ? 0 : a.min_humidity, a.max_humidity == null ? 100 : a.max_humidity, 5, a.humidity, "%", v => [d, "set_humidity", { humidity: v }]);
  if ((d === "number" || d === "input_number") && isNum(s.state)) return make(a.min, a.max, a.step || 1, Number(s.state), a.unit_of_measurement || "", v => [d, "set_value", { value: v }]);
  return null;
}

const WEATHER_ICON = { "clear-night": "wNight", cloudy: "wCloudy", fog: "wFog", hail: "wHail", lightning: "wLightning", "lightning-rainy": "wLightningRainy",
  partlycloudy: "wPartly", pouring: "wPouring", rainy: "wRainy", snowy: "wSnowy", "snowy-rainy": "wSnowyRainy", sunny: "wSunny", windy: "wWindy", "windy-variant": "wWindy", exceptional: "wCloudy" };

// PTZ control for the integrations that offer such a service. Returns [domain, service, data] or null.
function ptzCall(platform, services, move) {
  if (platform === "frigate" && services.frigate && services.frigate.ptz)
    return ["frigate", "ptz", { action: move === "zoom_in" ? "zoom" : "move", argument: move === "zoom_in" ? "in" : move }];
  if (platform === "onvif" && services.onvif && services.onvif.ptz) {
    const d = { move_mode: "ContinuousMove", continuous_duration: 0.5 };
    if (move === "left" || move === "right") d.pan = move.toUpperCase();
    if (move === "up" || move === "down") d.tilt = move.toUpperCase();
    if (move === "zoom_in") d.zoom = "ZOOM_IN";
    return ["onvif", "ptz", d];
  }
  return null;
}

// Label of the main slider per type
const SLIDER_LABEL = { light: "brightness", cover: "position", fan: "speed", media_player: "volume", climate: "temperature", water_heater: "temperature", humidifier: "humidity" };

// Translation of an option (e.g. the heat pump mode) via HA's own texts, otherwise as is
function optionText(d, attr, v, tr) {
  return (tr && (tr[`component.${d}.entity_component._.state_attributes.${attr}.state.${v}`] || (attr === "hvac_mode" && tr[`component.${d}.entity_component._.state.${v}`]))) || String(v);
}

// Everything the panel (long press) can show for an entity: sliders, ◀ ▶ options, buttons, PIN pad and history.
// Every call returns [domain, service, data].
function panelSpec(s) {
  const d = domainOf(s.entity_id), a = s.attributes, out = { sliders: [], options: [], buttons: [], code: false, history: false };
  const main = slider(s);
  if (main) out.sliders.push(Object.assign({ key: "main", label: t(SLIDER_LABEL[d] || "value") }, main));
  const opt = (key, label, attr, values, value, call) => { if (Array.isArray(values) && values.length > 1) out.options.push({ key, label, attr, values, value, call }); };
  const btn = (key, label, call) => out.buttons.push({ key, label, call });
  if (d === "light") {
    const modes = a.supported_color_modes || [];
    if (modes.includes("color_temp") && isNum(a.min_color_temp_kelvin) && isNum(a.max_color_temp_kelvin) && a.max_color_temp_kelvin > a.min_color_temp_kelvin)
      out.sliders.push({ key: "temp", label: t("colorTemp"), min: a.min_color_temp_kelvin, max: a.max_color_temp_kelvin, step: 100,
        value: isNum(a.color_temp_kelvin) ? a.color_temp_kelvin : Math.round((a.min_color_temp_kelvin + a.max_color_temp_kelvin) / 2), unit: "K", call: v => ["light", "turn_on", { color_temp_kelvin: v }] });
    if (modes.some(m => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m)))
      out.sliders.push({ key: "hue", label: t("color"), min: 0, max: 360, step: 10, value: Math.round((a.hs_color || [0])[0]), unit: "°", call: v => ["light", "turn_on", { hs_color: [v, 100] }] });
    opt("effect", t("option"), "effect", a.effect_list, a.effect, v => ["light", "turn_on", { effect: v }]);
  }
  if (d === "climate") {
    opt("hvac", t("mode"), "hvac_mode", a.hvac_modes, s.state, v => ["climate", "set_hvac_mode", { hvac_mode: v }]);
    opt("fan", t("fanMode"), "fan_mode", a.fan_modes, a.fan_mode, v => ["climate", "set_fan_mode", { fan_mode: v }]);
    opt("preset", t("preset"), "preset_mode", a.preset_modes, a.preset_mode, v => ["climate", "set_preset_mode", { preset_mode: v }]);
  }
  if (d === "fan") opt("preset", t("preset"), "preset_mode", a.preset_modes, a.preset_mode, v => ["fan", "set_preset_mode", { preset_mode: v }]);
  if (d === "humidifier") opt("mode", t("mode"), "mode", a.available_modes, a.mode, v => ["humidifier", "set_mode", { mode: v }]);
  if (d === "water_heater") opt("mode", t("mode"), "operation_mode", a.operation_list, a.operation_mode, v => ["water_heater", "set_operation_mode", { operation_mode: v }]);
  if (d === "select" || d === "input_select") opt("option", t("option"), "options", a.options, s.state, v => [d, "select_option", { option: v }]);
  if (d === "media_player") {
    opt("source", t("source"), "source", a.source_list, a.source, v => [d, "select_source", { source: v }]);
    btn("prev", "⏮", () => [d, "media_previous_track", {}]);
    btn("play", "⏯", () => [d, "media_play_pause", {}]);
    btn("next", "⏭", () => [d, "media_next_track", {}]);
    btn("mute", t(a.is_volume_muted ? "unmute" : "mute"), () => [d, "volume_mute", { is_volume_muted: !a.is_volume_muted }]);
  }
  if (d === "cover") { btn("open", t("open"), () => [d, "open_cover", {}]); btn("stop", t("stop"), () => [d, "stop_cover", {}]); btn("close", t("close"), () => [d, "close_cover", {}]); }
  if (d === "vacuum") { btn("start", t("start"), () => [d, "start", {}]); btn("pause", t("pause"), () => [d, "pause", {}]); btn("dock", t("dock"), () => [d, "return_to_base", {}]); }
  if (d === "lawn_mower") { btn("start", t("start"), () => [d, "start_mowing", {}]); btn("pause", t("pause"), () => [d, "pause", {}]); btn("dock", t("dock"), () => [d, "dock", {}]); }
  if (d === "alarm_control_panel") {
    out.code = !!a.code_format; // the code is sent with every button
    btn("disarm", t("disarm"), code => [d, "alarm_disarm", code ? { code } : {}]);
    btn("home", t("armHome"), code => [d, "alarm_arm_home", code ? { code } : {}]);
    btn("away", t("armAway"), code => [d, "alarm_arm_away", code ? { code } : {}]);
    if ((a.supported_features || 0) & 4) btn("night", t("armNight"), code => [d, "alarm_arm_night", code ? { code } : {}]);
  }
  if ((d === "sensor" || d === "number" || d === "input_number") && isNum(s.state)) out.history = true;
  return out;
}

// What the app can set up in Home Assistant: scripts and automation blueprints that target the chosen TV.
// Texts are in English on purpose, since they end up in Home Assistant's own UI.
const APP_ID = "io.github.haansen.homedash";
const LAUNCH = (tv, params) => ({ action: "webostv.command", target: { entity_id: tv }, data: { command: "system.launcher/launch", payload: { id: APP_ID, params } } });
const TV_ON = tv => ({ condition: "not", conditions: [{ condition: "state", entity_id: tv, state: ["off", "unavailable", "unknown"] }] });

function haScripts(tv) {
  return {
    homedash_notify: {
      alias: "HomeDash: show notification", icon: "mdi:television-shimmer", mode: "queued",
      description: "Shows a notification on top of whatever the TV is showing, with text and an optional live camera image.",
      fields: {
        title: { name: "Title", example: "Doorbell", selector: { text: {} } },
        message: { name: "Message", example: "Someone is at the door", selector: { text: {} } },
        camera: { name: "Camera", description: "Live image in the notification. Leave empty for text only.", selector: { entity: { domain: "camera" } } },
        timeout: { name: "Show for seconds", description: "0 = stays until Back is pressed.", default: 15, selector: { number: { min: 0, max: 300, unit_of_measurement: "s" } } },
        position: { name: "Corner", default: "top-right", selector: { select: { options: [
          { label: "Top right", value: "top-right" }, { label: "Top left", value: "top-left" }, { label: "Bottom right", value: "bottom-right" }, { label: "Bottom left", value: "bottom-left" }] } } },
        actions: { name: "Buttons", description: 'Up to four buttons, e.g. [{"label": "Unlock", "service": "lock.unlock", "entity_id": "lock.front_door"}, {"label": "Ignore", "event": "ignore"}]. A button with event fires homedash_action in Home Assistant.', selector: { object: {} } },
      },
      sequence: [TV_ON(tv), LAUNCH(tv, { title: "{{ title | default('') }}", message: "{{ message | default('') }}", camera: "{{ camera | default('') }}",
        timeout: "{{ timeout | default(15) }}", position: "{{ position | default('top-right') }}", actions: "{{ actions | default([]) }}" })],
    },
    homedash_menu: { alias: "HomeDash: open quick menu", icon: "mdi:menu-open", mode: "single", description: "Opens the HomeDash quick menu with favorites on top of whatever the TV is showing.",
      sequence: [TV_ON(tv), LAUNCH(tv, { menu: true })] },
    homedash_screensaver: { alias: "HomeDash: start screensaver", icon: "mdi:television-ambient-light", mode: "single", description: "Starts the HomeDash screensaver (cameras, clock and weather) on top of whatever the TV is showing. Any button on the remote brings the TV picture back.",
      sequence: [TV_ON(tv), LAUNCH(tv, { saver: true })] },
  };
}

const BLUEPRINT_TAIL = `condition:
  - condition: not
    conditions:
      - condition: state
        entity_id: !input tv
        state: ["off", "unavailable", "unknown"]
action:
  - action: webostv.command
    target:
      entity_id: !input tv
    data:
      command: system.launcher/launch
      payload:
        id: ${APP_ID}
        params:
`;
const HA_BLUEPRINTS = {
  "homedash/camera_on_tv.yaml": `blueprint:
  name: "HomeDash: show a camera on the TV"
  description: When a sensor turns on, HomeDash shows a notification with the camera on top of whatever the TV is showing.
  domain: automation
  input:
    tv:
      name: TV
      selector:
        entity:
          integration: webostv
          domain: media_player
    trigger_entity:
      name: Trigger
      description: Doorbell, motion or door sensor
      selector:
        entity:
          domain: binary_sensor
    camera:
      name: Camera
      selector:
        entity:
          domain: camera
    title:
      name: Title
      default: ""
    message:
      name: Message
      default: ""
    timeout:
      name: Show for seconds
      default: 20
      selector:
        number:
          min: 0
          max: 300
mode: queued
trigger:
  - platform: state
    entity_id: !input trigger_entity
    to: "on"
${BLUEPRINT_TAIL}          title: !input title
          message: !input message
          camera: !input camera
          timeout: !input timeout
`,
  "homedash/screensaver_when_idle.yaml": `blueprint:
  name: "HomeDash: screensaver when nobody is watching"
  description: Starts the HomeDash screensaver on the TV when a motion sensor has been off for a while. Any button on the remote brings the TV picture back.
  domain: automation
  input:
    tv:
      name: TV
      selector:
        entity:
          integration: webostv
          domain: media_player
    motion:
      name: Motion sensor
      selector:
        entity:
          domain: binary_sensor
    minutes:
      name: Minutes without motion
      default: 20
      selector:
        number:
          min: 1
          max: 180
mode: single
trigger:
  - platform: state
    entity_id: !input motion
    to: "off"
    for:
      minutes: !input minutes
${BLUEPRINT_TAIL}          saver: true
`,
};

// One step left/right. Long ranges move in bigger steps so you get there in reasonable time.
function stepValue(sl, value, dir) {
  const steps = (sl.max - sl.min) / sl.step, jump = steps > 40 ? sl.step * Math.ceil(steps / 20) : sl.step;
  return snap(sl, value + dir * jump);
}
function snap(sl, value) {
  const v = sl.min + Math.round((Math.max(sl.min, Math.min(sl.max, value)) - sl.min) / sl.step) * sl.step;
  return Number(Math.min(sl.max, v).toFixed(6));
}

function iconOf(s) {
  const d = domainOf(s.entity_id), dc = s.attributes.device_class, on = isActive(s);
  const classes = {
    binary_sensor: { door: on ? "doorOpen" : "doorClosed", opening: on ? "doorOpen" : "doorClosed", garage_door: on ? "garageOpen" : "garage",
      window: on ? "windowOpen" : "windowClosed", motion: "motion", occupancy: "motion", presence: "home", smoke: "smoke", gas: "smoke", moisture: "water",
      battery: "battery", connectivity: "wifi", power: "flash", plug: "flash", lock: on ? "lockOpen" : "lock", problem: "alert", safety: "alert", tamper: "alert" },
    sensor: { temperature: "thermometer", humidity: "waterPercent", moisture: "waterPercent", battery: "battery", power: "flash", energy: "flash",
      voltage: "flash", current: "flash", illuminance: "brightness", pressure: "gauge", timestamp: "clock", duration: "clock" },
    cover: { garage: on ? "garageOpen" : "garage", gate: "gate", door: on ? "doorOpen" : "doorClosed", curtain: "curtains", window: on ? "windowOpen" : "windowClosed" },
    media_player: { tv: "television", speaker: "speaker", receiver: "speaker" },
  };
  const domains = { light: "lightbulb", switch: "toggle", input_boolean: "toggle", sensor: "eye", binary_sensor: on ? "circleOn" : "circle",
    cover: on ? "shutterOpen" : "shutter", climate: "thermostat", fan: "fan", lock: on ? "lockOpen" : "lock", media_player: "cast", vacuum: "vacuum",
    scene: "palette", script: "script", automation: "robot", button: "button", input_button: "button", person: "account", device_tracker: "account",
    number: "numeric", input_number: "numeric", select: "list", input_select: "list", timer: "timer", sun: "sun", update: "update",
    water_heater: "boiler", remote: "remote", alarm_control_panel: "shield", humidifier: "humidifier", siren: "bullhorn", valve: "valve",
    lawn_mower: "mower", text: "text", input_text: "text", calendar: "calendar", input_datetime: "calendar", date: "calendar", time: "clock",
    datetime: "calendar", image: "image", notify: "bell", event: "bell", schedule: "calendar" };
  return (classes[d] && classes[d][dc]) || domains[d] || "bookmark";
}

function cycle(list, cur, step) {
  const i = list.indexOf(cur);
  return i < 0 ? list[0] : list[(i + step + list.length) % list.length];
}

// "192.168.1.10" -> "http://192.168.1.10:8123". En adress med eget protokoll eller egen port lämnas som den är.
function normalizeUrl(input) {
  let s = String(input || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s + (/:\d+$/.test(s) ? "" : ":8123");
  return /^https?:\/\/[^\s/:]+(:\d+)?$/i.test(s) ? s : "";
}

// pts: center points {x,y} of all tiles. Returns the index of the tile in direction dir, or cur if there is none.
function nextTile(pts, cur, dir) {
  const horiz = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  let best = cur, bestScore = Infinity;
  pts.forEach((p, i) => {
    const along = sign * (horiz ? p.x - pts[cur].x : p.y - pts[cur].y);
    const across = Math.abs(horiz ? p.y - pts[cur].y : p.x - pts[cur].x);
    if (along < 1 || (horiz && across > 10)) return; // left/right stays on the same row
    const score = along + 3 * across;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function parseParams(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}") || {}; } catch (e) { return {}; }
}

if (typeof module !== "undefined") module.exports = { isNotice, nextOption, panelSpec, optionText, ptzCall, haScripts, HA_BLUEPRINTS, WEATHER_ICON, DEFAULTS, THEMES, LANG, ACTIVE, isVisible, areaOf, isActive, stateText, action, slider, stepValue, snap, iconOf, cycle, normalizeUrl, nextTile, parseParams };

