// Kör: node test/unit.js
const assert = require("assert");
const { LANG, isVisible, areaOf, isActive, stateText, action, slider, stepValue, snap, iconOf, cycle, normalizeUrl, nextTile, parseParams, panelSpec, optionText, nextOption, isNotice, ptzCall, WEATHER_ICON } = require("../app/logic.js");
const s = (entity_id, state, attributes) => ({ entity_id, state, attributes: attributes || {} });

// synlighet
assert.ok(isVisible(s("light.a", "on"), undefined, ["light"]));
assert.ok(isVisible(s("camera.a", "idle"), undefined, []), "kameror visas alltid");
assert.ok(!isVisible(s("switch.a", "on"), undefined, ["light"]), "avstängd typ");
assert.ok(!isVisible(s("light.a", "unavailable"), undefined, ["light"]));
assert.ok(!isVisible(s("light.a", "on"), { hidden_by: "user" }, ["light"]));
assert.ok(!isVisible(s("light.a", "on"), { disabled_by: "user" }, ["light"]));
assert.ok(!isVisible(s("light.a", "on"), { entity_category: "config" }, ["light"]));
assert.ok(!isVisible(s("light.a", "on"), undefined, ["light"], ["light.a"]), "dold av användaren");
assert.ok(isVisible(s("light.a", "on"), undefined, ["light"], ["light.b"]));
assert.ok(!isVisible(s("camera.a", "idle"), undefined, [], ["camera.a"]), "även kameror går att dölja");

// rum
assert.strictEqual(areaOf({ area_id: "kok", device_id: "d1" }, { d1: "hall" }), "kok", "entitetens rum går före enhetens");
assert.strictEqual(areaOf({ area_id: null, device_id: "d1" }, { d1: "hall" }), "hall");
assert.strictEqual(areaOf({ device_id: "d2" }, { d1: "hall" }), null);
assert.strictEqual(areaOf(undefined, {}), null);

// tillstånd som text (node kör på engelska, TV:n väljer språk själv)
assert.strictEqual(LANG, "en");
// alla språk måste ha exakt samma nycklar som svenskan
const TEXTS = require("../app/lang.js");
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? flat(v, p + k + ".") : [p + k]);
const svKeys = flat(TEXTS.sv).sort();
assert.ok(Object.keys(TEXTS).length >= 12, "minst tolv språk");
for (const lang of Object.keys(TEXTS)) {
  assert.deepStrictEqual(flat(TEXTS[lang]).sort(), svKeys, lang + " saknar eller har extra nycklar");
  for (const k of svKeys) { const v = k.split(".").reduce((o, p) => o[p], TEXTS[lang]); assert.ok(typeof v === "string" && v.length, lang + ": tom text för " + k); }
  for (const k of ["confirmUnlock", "notFound", "hiddenInfo", "typesShown", "minutes"]) assert.ok(TEXTS[lang][k].includes("{0}"), lang + ": " + k + " saknar {0}");
}
const tr = { "component.binary_sensor.entity_component.door.state.on": "Open", "component.binary_sensor.entity_component._.state.on": "On",
  "component.lock.entity_component._.state.locked": "Locked", "component.climate.entity_component._.state.heat": "Heat",
  "component.cover.entity_component._.state.open": "Open", "component.demo.entity.sensor.mode.state.eco": "Eco mode",
  "component.media_player.entity_component._.state.playing": "Playing" };
const text = (st, reg) => stateText(st, reg, tr);
assert.strictEqual(text(s("light.a", "off")), "Off", "av/på fungerar även utan HA:s översättning");
assert.strictEqual(text(s("light.a", "on")), "On");
assert.strictEqual(text(s("light.a", "on", { brightness: 128 })), "On · 50%");
assert.strictEqual(text(s("light.a", "on", { brightness: 1 })), "On · 1%", "aldrig 0 % när lampan är tänd");
assert.strictEqual(text(s("binary_sensor.a", "on", { device_class: "door" })), "Open", "typens översättning går före domänens");
assert.strictEqual(text(s("binary_sensor.a", "on", { device_class: "okand" })), "On");
assert.strictEqual(text(s("sensor.a", "eco"), { platform: "demo", translation_key: "mode" }), "Eco mode", "entitetens egen översättning går först");
assert.strictEqual(text(s("sensor.a", "eco")), "eco", "okänt tillstånd visas som det är");
assert.strictEqual(text(s("lock.a", "locked")), "Locked");
assert.strictEqual(text(s("sensor.a", "21.456", { unit_of_measurement: "°C" })), "21.46 °C");
assert.strictEqual(text(s("sensor.a", "21.456", { unit_of_measurement: "°C" }), { options: { sensor: { display_precision: 1 } } }), "21.5 °C");
assert.strictEqual(text(s("sensor.a", "21.456", { unit_of_measurement: "°C" }), { options: { sensor: { suggested_display_precision: 0 } } }), "21 °C");
assert.strictEqual(text(s("sensor.a", "87", { unit_of_measurement: "%" })), "87%");
assert.strictEqual(text(s("sensor.a", "1234567")), "1,234,567");
assert.strictEqual(text(s("input_number.a", "5")), "5");
assert.strictEqual(text(s("sensor.a", "unknown")), "Unknown");
assert.strictEqual(text(s("sensor.a", "")), "Unknown");
assert.strictEqual(text(s("scene.a", "2026-09-29T19:08:59+00:00")), "", "scener och knappar visar inte tid för senaste tryck");
assert.strictEqual(text(s("button.a", "unknown")), "");
assert.strictEqual(text(s("script.a", "off")), "");
assert.ok(!/T\d\d:/.test(text(s("sensor.a", "2026-09-29T19:08:59+00:00", { device_class: "timestamp" }))), "tidsstämplar skrivs som läsbart datum");
assert.strictEqual(text(s("sensor.a", "2026 är ett år")), "2026 är ett år", "text som råkar börja med ett årtal är inte ett datum");
assert.strictEqual(text(s("cover.a", "open", { current_position: 60 })), "Open · 60%");
assert.strictEqual(text(s("cover.a", "closed", { current_position: 0 })), "closed");
assert.strictEqual(text(s("climate.a", "heat", { temperature: 22, current_temperature: 20.5 })), "Heat · 22°");
assert.strictEqual(text(s("climate.a", "off", { temperature: 22, current_temperature: 20.5 })), "Off · 20.5°", "avstängd visar rummets temperatur");
assert.strictEqual(text(s("climate.a", "off", { temperature: 22, current_temperature: null })), "Off");
assert.strictEqual(text(s("media_player.a", "playing", { media_title: "Låt", app_name: "Spotify" })), "Låt");
assert.strictEqual(text(s("media_player.a", "playing", { app_name: "Netflix" })), "Netflix");
assert.strictEqual(text(s("media_player.a", "playing")), "Playing");
assert.strictEqual(stateText(s("light.a", "on"), undefined, undefined), "On", "fungerar innan översättningarna har laddats");
assert.strictEqual(text(s("weather.a", "partlycloudy", { temperature: 7.4 })), "7° · Partly cloudy");
assert.strictEqual(text(s("weather.a", "sunny")), "Sunny");

// aktiv = markerad bricka
for (const st of ["on", "open", "unlocked", "playing", "heat", "cleaning"]) assert.ok(isActive(s("x.a", st)), st);
for (const st of ["off", "closed", "locked", "paused", "idle", "unavailable", "21.5"]) assert.ok(!isActive(s("x.a", st)), st);

// vad OK gör
const act = st => { const a = action(st); return a && [a.domain, a.service, a.confirm].filter(Boolean).join(" "); };
assert.strictEqual(act(s("light.a", "on")), "homeassistant toggle");
assert.strictEqual(act(s("switch.a", "off")), "homeassistant toggle");
assert.strictEqual(act(s("input_boolean.a", "off")), "homeassistant toggle");
assert.strictEqual(act(s("cover.a", "closed")), "cover toggle");
assert.strictEqual(act(s("cover.a", "closed", { device_class: "garage" })), "cover toggle confirmOpen", "garageport öppnas först efter två tryck");
assert.strictEqual(act(s("cover.a", "open", { device_class: "garage" })), "cover toggle", "stänga kräver ingen bekräftelse");
assert.strictEqual(act(s("lock.a", "locked")), "lock unlock confirmUnlock", "upplåsning kräver två tryck");
assert.strictEqual(act(s("lock.a", "unlocked")), "lock lock");
assert.strictEqual(act(s("climate.a", "off")), "climate turn_on");
assert.strictEqual(act(s("climate.a", "heat")), "climate turn_off");
assert.strictEqual(act(s("media_player.a", "playing")), "media_player media_play_pause");
assert.strictEqual(act(s("media_player.a", "paused")), "media_player media_play_pause");
assert.strictEqual(act(s("media_player.a", "off")), "media_player turn_on");
assert.strictEqual(act(s("media_player.a", "idle")), "media_player turn_off");
assert.strictEqual(act(s("vacuum.a", "docked")), "vacuum start");
assert.strictEqual(act(s("vacuum.a", "cleaning")), "vacuum return_to_base");
assert.strictEqual(act(s("button.a", "unknown")), "button press");
assert.strictEqual(act(s("scene.a", "unknown")), "scene turn_on");
assert.strictEqual(act(s("script.a", "off")), "script turn_on");
assert.deepStrictEqual(action(s("input_select.a", "x")).data, { cycle: true });
assert.strictEqual(act(s("timer.a", "active")), "timer pause");
for (const id of ["sensor.a", "binary_sensor.a", "person.a", "update.a", "alarm_control_panel.a", "sun.sun", "helt_ny_typ.a"]) assert.strictEqual(action(s(id, "on")), null, id + " går bara att läsa av");
assert.strictEqual(action(s("light.a", "unavailable")), null);

// reglage
const sl = (st, v) => { const x = slider(st); return x && [x.min, x.max, x.step, x.value, x.unit, ...x.call(v == null ? x.value : v)]; };
assert.deepStrictEqual(sl(s("light.a", "on", { supported_color_modes: ["brightness"], brightness: 128 })), [0, 100, 10, 50, "%", "light", "turn_on", { brightness_pct: 50 }]);
assert.deepStrictEqual(sl(s("light.a", "off", { supported_color_modes: ["color_temp", "xy"] }), 0), [0, 100, 10, 0, "%", "light", "turn_off", {}]);
assert.strictEqual(slider(s("light.a", "on", { supported_color_modes: ["onoff"] })), null);
assert.strictEqual(slider(s("light.a", "on")), null);
assert.strictEqual(slider(s("switch.a", "on", { supported_color_modes: ["brightness"] })), null);
assert.deepStrictEqual(sl(s("climate.a", "heat", { min_temp: 16, max_temp: 30, target_temp_step: 1, temperature: 22 }), 23), [16, 30, 1, 22, "°", "climate", "set_temperature", { temperature: 23 }]);
assert.strictEqual(slider(s("climate.a", "heat", { min_temp: 16, max_temp: 30, temperature: null })), null);
assert.strictEqual(slider(s("climate.a", "heat", { temperature: 22 })), null, "utan gränser finns inget reglage");
assert.deepStrictEqual(sl(s("media_player.a", "playing", { volume_level: 0.25 }), 30), [0, 100, 5, 25, "%", "media_player", "volume_set", { volume_level: 0.3 }]);
assert.deepStrictEqual(sl(s("cover.a", "open", { current_position: 60 }), 40), [0, 100, 10, 60, "%", "cover", "set_cover_position", { position: 40 }]);
assert.deepStrictEqual(sl(s("input_number.a", "5", { min: 0, max: 10, step: 0.5, unit_of_measurement: "h" }), 5.5), [0, 10, 0.5, 5, "h", "input_number", "set_value", { value: 5.5 }]);
assert.strictEqual(slider(s("number.a", "unknown", { min: 0, max: 10, step: 1 })), null);
assert.strictEqual(slider(s("number.a", "5", { min: 10, max: 10, step: 1 })), null);
assert.strictEqual(slider(s("number.a", "50", { min: 0, max: 10, step: 1 })).value, 10, "värde utanför skalan hålls inom den");
assert.strictEqual(slider(s("sensor.a", "5", { min: 0, max: 10 })), null);

const temp = { min: 16, max: 30, step: 0.5 }, wide = { min: 0, max: 1000, step: 1 }, third = { min: 0, max: 1, step: 0.1 };
assert.strictEqual(stepValue(temp, 22, 1), 22.5);
assert.strictEqual(stepValue(temp, 30, 1), 30, "stannar vid max");
assert.strictEqual(stepValue(temp, 16, -1), 16, "stannar vid min");
assert.strictEqual(stepValue(wide, 500, 1), 550, "långa skalor tas i större kliv");
assert.strictEqual(stepValue(third, 0.2, 1), 0.3, "inga avrundningsfel som 0.30000000000000004");
assert.strictEqual(snap(temp, 22.3), 22.5);
assert.strictEqual(snap(temp, 99), 30);
assert.strictEqual(snap({ min: 0, max: 10, step: 3 }, 10), 9, "hamnar aldrig utanför stegen");

// panelen vid långt tryck
const spec = st => { const p = panelSpec(st); return { s: p.sliders.map(x => x.key), o: p.options.map(x => x.key), b: p.buttons.map(x => x.key), code: p.code, h: p.history }; };
assert.deepStrictEqual(spec(s("light.a", "on", { supported_color_modes: ["color_temp", "hs"], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000, hs_color: [120, 50] })), { s: ["main", "temp", "hue"], o: [], b: [], code: false, h: false });
assert.deepStrictEqual(spec(s("light.a", "on", { supported_color_modes: ["onoff"] })), { s: [], o: [], b: [], code: false, h: false }, "lampa utan dimning har ingen panelrad");
assert.deepStrictEqual(spec(s("light.a", "on", { supported_color_modes: ["color_temp"], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 2000 })), { s: ["main"], o: [], b: [], code: false, h: false }, "orimligt intervall ger inget reglage");
const light = panelSpec(s("light.a", "on", { supported_color_modes: ["color_temp", "hs"], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, hs_color: [120, 50] }));
assert.deepStrictEqual(light.sliders[1].call(4000), ["light", "turn_on", { color_temp_kelvin: 4000 }]);
assert.strictEqual(light.sliders[1].value, 4250, "utan känd temperatur börjar reglaget i mitten");
assert.deepStrictEqual(light.sliders[2].call(200), ["light", "turn_on", { hs_color: [200, 100] }]);
assert.strictEqual(light.sliders[2].value, 120);
const clim = panelSpec(s("climate.a", "heat", { min_temp: 16, max_temp: 30, temperature: 22, hvac_modes: ["off", "heat", "cool"], fan_modes: ["auto", "low"], fan_mode: "auto" }));
assert.deepStrictEqual(spec(s("climate.a", "heat", { min_temp: 16, max_temp: 30, temperature: 22, hvac_modes: ["off", "heat", "cool"], fan_modes: ["auto", "low"], fan_mode: "auto" })), { s: ["main"], o: ["hvac", "fan"], b: [], code: false, h: false });
assert.deepStrictEqual([clim.options[0].value, clim.options[0].call("cool")], ["heat", ["climate", "set_hvac_mode", { hvac_mode: "cool" }]]);
assert.deepStrictEqual(clim.options[1].call("low"), ["climate", "set_fan_mode", { fan_mode: "low" }]);
assert.deepStrictEqual(spec(s("climate.a", "heat", { hvac_modes: ["heat"] })), { s: [], o: [], b: [], code: false, h: false }, "ett enda läge är inget val");
const media = panelSpec(s("media_player.a", "playing", { volume_level: 0.3, source_list: ["TV", "HDMI 1"], source: "TV", is_volume_muted: false }));
assert.deepStrictEqual(spec(s("media_player.a", "playing", { volume_level: 0.3, source_list: ["TV", "HDMI 1"], source: "TV" })), { s: ["main"], o: ["source"], b: ["prev", "play", "next", "mute"], code: false, h: false });
assert.deepStrictEqual(media.buttons[1].call(), ["media_player", "media_play_pause", {}]);
assert.deepStrictEqual(media.buttons[3].call(), ["media_player", "volume_mute", { is_volume_muted: true }]);
assert.deepStrictEqual(media.options[0].call("HDMI 1"), ["media_player", "select_source", { source: "HDMI 1" }]);
assert.deepStrictEqual(spec(s("cover.a", "open", { current_position: 50 })), { s: ["main"], o: [], b: ["open", "stop", "close"], code: false, h: false });
assert.deepStrictEqual(spec(s("vacuum.a", "docked")), { s: [], o: [], b: ["start", "pause", "dock"], code: false, h: false });
const alarm = panelSpec(s("alarm_control_panel.a", "disarmed", { code_format: "number", supported_features: 7 }));
assert.deepStrictEqual(spec(s("alarm_control_panel.a", "disarmed", { code_format: "number", supported_features: 7 })), { s: [], o: [], b: ["disarm", "home", "away", "night"], code: true, h: false });
assert.deepStrictEqual(alarm.buttons[2].call("1234"), ["alarm_control_panel", "alarm_arm_away", { code: "1234" }]);
assert.deepStrictEqual(alarm.buttons[0].call(), ["alarm_control_panel", "alarm_disarm", {}]);
assert.deepStrictEqual(spec(s("alarm_control_panel.a", "disarmed", { supported_features: 3 })), { s: [], o: [], b: ["disarm", "home", "away"], code: false, h: false }, "utan kod och utan nattläge");
assert.deepStrictEqual(spec(s("select.a", "b", { options: ["a", "b", "c"] })).o, ["option"]);
assert.deepStrictEqual(panelSpec(s("input_select.a", "b", { options: ["a", "b"] })).options[0].call("a"), ["input_select", "select_option", { option: "a" }]);
assert.deepStrictEqual(spec(s("sensor.a", "21.5", { unit_of_measurement: "°C" })), { s: [], o: [], b: [], code: false, h: true }, "sensorer får historik");
assert.deepStrictEqual(spec(s("sensor.a", "hej")), { s: [], o: [], b: [], code: false, h: false }, "textsensorer får ingen kurva");
assert.deepStrictEqual(spec(s("input_number.a", "5", { min: 0, max: 10, step: 1 })), { s: ["main"], o: [], b: [], code: false, h: true });
assert.deepStrictEqual(spec(s("binary_sensor.a", "on")), { s: [], o: [], b: [], code: false, h: false });

const tr2 = { "component.climate.entity_component._.state.heat": "Värme", "component.climate.entity_component._.state_attributes.fan_mode.state.low": "Låg" };
assert.strictEqual(optionText("climate", "hvac_mode", "heat", tr2), "Värme", "lägen översätts med HA:s texter");
assert.strictEqual(optionText("climate", "fan_mode", "low", tr2), "Låg");
assert.strictEqual(optionText("climate", "fan_mode", "turbo", tr2), "turbo");
assert.strictEqual(optionText("media_player", "source", "HDMI 1", undefined), "HDMI 1");
assert.strictEqual(nextOption([0, 1, 2], 2), 0);
assert.strictEqual(nextOption(["a", "b"], "x"), "a", "okänt värde ger första");
assert.ok(isNotice({ message: "hej" }) && isNotice({ timeout: 5 }) && isNotice({ image: "/x.jpg" }) && !isNotice({ camera: "camera.a" }) && !isNotice({}));

// PTZ
const svcs = { frigate: { ptz: {} }, onvif: { ptz: {} } };
assert.deepStrictEqual(ptzCall("frigate", svcs, "left"), ["frigate", "ptz", { action: "move", argument: "left" }]);
assert.deepStrictEqual(ptzCall("frigate", svcs, "zoom_in"), ["frigate", "ptz", { action: "zoom", argument: "in" }]);
assert.deepStrictEqual(ptzCall("onvif", svcs, "up"), ["onvif", "ptz", { move_mode: "ContinuousMove", continuous_duration: 0.5, tilt: "UP" }]);
assert.deepStrictEqual(ptzCall("onvif", svcs, "right").pan, undefined); assert.strictEqual(ptzCall("onvif", svcs, "right")[2].pan, "RIGHT");
assert.strictEqual(ptzCall("frigate", {}, "left"), null, "utan tjänsten i HA finns ingen styrning");
assert.strictEqual(ptzCall("generic", svcs, "left"), null);
assert.strictEqual(ptzCall(undefined, svcs, "left"), null);

// ikoner: alla namn som kan väljas måste finnas
const ICONS = require("../app/icons.js");
assert.strictEqual(iconOf(s("light.a", "on")), "lightbulb");
assert.strictEqual(iconOf(s("binary_sensor.a", "on", { device_class: "door" })), "doorOpen");
assert.strictEqual(iconOf(s("binary_sensor.a", "off", { device_class: "door" })), "doorClosed");
assert.strictEqual(iconOf(s("sensor.a", "21", { device_class: "temperature" })), "thermometer");
assert.strictEqual(iconOf(s("sensor.a", "21", { device_class: "okand" })), "eye");
assert.strictEqual(iconOf(s("lock.a", "unlocked")), "lockOpen");
assert.strictEqual(iconOf(s("helt_ny_typ.a", "on")), "bookmark");
const source = require("fs").readFileSync(require("path").join(__dirname, "../app/logic.js"), "utf8");
for (const k of Object.values(WEATHER_ICON)) assert.ok(ICONS[k], "väderikon saknas: " + k);
const iconBody = source.slice(source.indexOf("function iconOf"), source.indexOf("if (typeof module"));
for (const m of iconBody.matchAll(/[:?]\s*"([a-zA-Z]+)"/g)) assert.ok(ICONS[m[1]], "ikonen saknas: " + m[1]);
assert.ok(ICONS.bookmark);

// kamerabyte
assert.strictEqual(cycle(["a", "b", "c"], "c", 1), "a");
assert.strictEqual(cycle(["a", "b", "c"], "a", -1), "c");
assert.strictEqual(cycle(["a", "b", "c"], "b", 1), "c");
assert.strictEqual(cycle(["a", "b"], "finns-inte", 1), "a");

// adresser
assert.strictEqual(normalizeUrl("192.168.1.10"), "http://192.168.1.10:8123");
assert.strictEqual(normalizeUrl("  192.168.1.10:8000/ "), "http://192.168.1.10:8000");
assert.strictEqual(normalizeUrl("homeassistant.local"), "http://homeassistant.local:8123");
assert.strictEqual(normalizeUrl("https://hem.example.com"), "https://hem.example.com", "egen adress med https får ingen port");
assert.strictEqual(normalizeUrl("http://10.0.0.5:8123/"), "http://10.0.0.5:8123");
assert.strictEqual(normalizeUrl(""), "");
assert.strictEqual(normalizeUrl("inte en adress"), "");
assert.strictEqual(normalizeUrl("http://ha.local:8123/lovelace"), "", "sökvägar godtas inte");
assert.strictEqual(normalizeUrl(undefined), "");

// navigering. rad 1: två breda kamerabrickor, rad 2: tre lampor
const pts = [{ x: 200, y: 100 }, { x: 650, y: 100 }, { x: 140, y: 400 }, { x: 440, y: 400 }, { x: 740, y: 400 }];
assert.strictEqual(nextTile(pts, 0, "right"), 1);
assert.strictEqual(nextTile(pts, 1, "right"), 1, "stannar vid radens slut, hoppar inte till annan rad");
assert.strictEqual(nextTile(pts, 0, "left"), 0);
assert.strictEqual(nextTile(pts, 1, "down"), 4);
assert.strictEqual(nextTile(pts, 0, "down"), 2);
assert.strictEqual(nextTile(pts, 3, "up"), 1); // x=440 ligger närmast x=650
assert.strictEqual(nextTile(pts, 4, "left"), 3);
assert.strictEqual(nextTile(pts, 2, "down"), 2);

// startparametrar
assert.deepStrictEqual(parseParams('{"camera":"camera.door"}'), { camera: "camera.door" });
assert.deepStrictEqual(parseParams({ camera: "camera.door" }), { camera: "camera.door" });
assert.deepStrictEqual(parseParams(""), {});
assert.deepStrictEqual(parseParams("trasig{"), {});
assert.deepStrictEqual(parseParams("null"), {});
console.log("ok");
