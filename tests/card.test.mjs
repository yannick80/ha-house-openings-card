// Card tests: `node --test tests/*.mjs` – no npm dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../dist/house-openings-card.js", import.meta.url), "utf8");

// ------------------------------------------------------------ minimal DOM stub

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this._text = "";
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    const props = {};
    this.style = { setProperty: (k, v) => (props[k] = v), getPropertyValue: (k) => props[k] || "", _props: props };
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { this.children = []; this._text = ""; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((fn) => fn({})); }
  appendChild(c) { this.children.push(c); return c; }
  matches(sel) {
    if (sel.startsWith(".")) return sel.slice(1).split(".").every((c) => this.className.split(" ").includes(c));
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function makeContext(extra = {}) {
  const registry = new Map();
  class HTMLElement {
    constructor() { this.dispatched = []; this.children = []; }
    attachShadow() { this.shadowRoot = new FakeEl("#shadow"); return this.shadowRoot; }
    dispatchEvent(ev) { this.dispatched.push(ev); return true; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const ctx = {
    console: { info() {}, error(...a) { ctx.__errors.push(a); }, warn() {} },
    __errors: [],
    HTMLElement,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    customElements: {
      get: (t) => registry.get(t),
      define: (t, c) => { if (registry.has(t)) throw new Error(`already defined: ${t}`); registry.set(t, c); },
      whenDefined: () => new Promise(() => {}),
    },
    document: { createElement: (t) => { const C = registry.get(t); return C ? new C() : new FakeEl(t); } },
    setInterval: () => 1,
    clearInterval: () => {},
    Intl, Date, Math, JSON, Number, String, Object, Array, Promise, Error, RegExp, Set, parseFloat, isFinite,
    ...extra,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

function loadCard() {
  const ctx = makeContext({ module: { exports: {} } });
  vm.runInContext(SOURCE, ctx, { filename: "house-openings-card.js" });
  return ctx;
}

// ------------------------------------------------------------ mock hass

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const AREAS = { bad: "Bad", kinder: "Kinderzimmer", wohnen: "Wohnzimmer", garage: "Garage", einfahrt: "Einfahrt" };

// items: [entity_id, area, state, attributes, { minutes, device, entity }]
function mkHass(items, opts = {}) {
  const hass = {
    locale: { language: opts.lang || "de" }, language: opts.lang || "de",
    areas: {}, devices: {}, entities: {}, states: {},
  };
  for (const [a, name] of Object.entries(AREAS)) hass.areas[a] = { area_id: a, name };
  for (const [id, area, state, attributes = {}, extra = {}] of items) {
    const dev = extra.device || `dev_${id}`;
    if (!hass.devices[dev]) hass.devices[dev] = { id: dev, area_id: area || null };
    hass.entities[id] = { entity_id: id, device_id: dev, platform: "homematicip_local", ...(extra.entity || {}) };
    hass.states[id] = { entity_id: id, state, attributes, last_changed: ago(extra.minutes || 0) };
  }
  return hass;
}

const win = (id, area, state, name, minutes, extra = {}) =>
  [`binary_sensor.${id}`, area, state, { device_class: "window", friendly_name: name }, { minutes, ...extra }];

const HOUSE = () => mkHass([
  win("bad_fenster", "bad", "on", "Bad Fenster", 45),
  win("kinder_links", "kinder", "on", "Kinderzimmer Fenster links", 5, {}),
  win("kinder_rechts", "kinder", "off", "Kinderzimmer Fenster rechts", 200),
  win("wohnen_terrasse", "wohnen", "off", "Wohnzimmer Terrassentür", 300),
  ["cover.garagentor", "garage", "open", { device_class: "garage", current_position: 45, friendly_name: "Garagentor" }, { minutes: 12 }],
  ["cover.carport", "einfahrt", "closed", { device_class: "gate", friendly_name: "Carport" }, { minutes: 600, entity: { platform: "overkiz" } }],
]);

function render(ctx, config, hass, now = NOW) {
  const Card = ctx.customElements.get("house-openings-card");
  const card = new Card();
  const realNow = ctx.Date.now;
  ctx.Date.now = () => now;
  try {
    card.setConfig(config);
    card.hass = hass;
  } finally {
    ctx.Date.now = realNow;
  }
  const r = card.shadowRoot;
  const all = (s) => r.querySelectorAll(s);
  const one = (s) => r.querySelector(s);
  const txt = (s) => one(s) && one(s).textContent;
  return {
    card,
    root: r,
    text: r.textContent,
    badge: txt(".badge"),
    badgeClass: one(".badge") && one(".badge").className,
    gates: all(".gate").map((g) => ({
      cls: g.className,
      label: g.querySelector(".gate-label").textContent,
      value: g.querySelector(".gate-value").textContent,
      sub: g.querySelector(".gate-sub").textContent,
      pos: g.querySelector(".pos-fill") && g.querySelector(".pos-fill").style.getPropertyValue("width"),
      el: g,
    })),
    rows: all(".row").map((e) => ({
      cls: e.className,
      title: e.querySelector(".row-title").textContent,
      meta: e.querySelector(".row-meta").textContent,
      time: e.querySelector(".row-time").textContent,
      el: e,
    })),
    allClosed: txt(".all-closed"),
    unavailable: txt(".unavailable"),
    warning: txt(".warning"),
    empty: txt(".hint-empty"),
  };
}

// A context whose Date.now is swappable (the vm context gets its own Date wrapper)
function loadCardNow() {
  const D = class extends Date {};
  D.now = () => Date.now();
  const ctx = makeContext({ module: { exports: {} }, Date: D });
  vm.runInContext(SOURCE, ctx, { filename: "house-openings-card.js" });
  return ctx;
}

// ------------------------------------------------------------ old WebViews

test("card evaluates as a classic script in one shared context, twice", () => {
  const ctx = makeContext();
  vm.runInContext(SOURCE, ctx);
  vm.runInContext(SOURCE, ctx);
  assert.ok(ctx.customElements.get("house-openings-card"));
  assert.ok(ctx.customElements.get("house-openings-card-editor"));
  assert.equal(ctx.window.customCards.filter((c) => c.type === "house-openings-card").length, 1);
});

test("source uses no syntax newer than ES2019", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = [
    [/\?\.(?!\d)/, "optional chaining ?."],
    [/\?\?/, "nullish coalescing ??"],
    [/(\|\||&&)=/, "logical assignment"],
    [/\.at\(/, ".at()"],
    [/\.replaceAll\(/, "replaceAll"],
    [/\.replaceChildren\(/, "replaceChildren"],
    [/this\.#\w|^\s*(static\s+)?#\w+\s*[=(;]/m, "#private class members"],
    [/\(\?<[=!]/, "regex lookbehind"],
  ];
  for (const [re, name] of forbidden) assert.doesNotMatch(code, re, `forbidden syntax: ${name}`);
});

test("whole file is wrapped in its own function scope", () => {
  const code = SOURCE.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "").trim();
  assert.match(code, /^\(function \(\) \{/);
  assert.match(code, /\}\)\(\);$/);
});

test("every color-mix() has a plain fallback right before it, no gap/inset", () => {
  const lines = SOURCE.split(";").map((s) => s.trim());
  lines.forEach((l, i) => {
    if (!/background:\s*color-mix/.test(l)) return;
    assert.match(lines[i - 1], /background:\s*rgba?\(/, `missing fallback before: ${l}`);
  });
  assert.doesNotMatch(SOURCE, /[\s{;]gap\s*:/);
  assert.doesNotMatch(SOURCE, /[\s{;]inset\s*:/);
});

// ------------------------------------------------------------ states

test("contact states: binary sensor, Homematic IP rotary handle, enum sensor", () => {
  const { contactState } = loadCard().module.exports;
  const h = mkHass([
    ["binary_sensor.a", "bad", "on", { device_class: "window" }],
    ["binary_sensor.b", "bad", "off", { device_class: "window" }],
    ["binary_sensor.c", "bad", "on", { device_class: "window", window_state: "TILTED" }],
    ["binary_sensor.d", "bad", "on", { device_class: "window", window_state: "OPEN" }],
    ["binary_sensor.e", "bad", "unavailable", { device_class: "window" }],
    ["sensor.f", "bad", "tilted", { device_class: "enum", options: ["open", "tilted", "closed"] }],
    ["sensor.g", "bad", "closed", { device_class: "enum" }],
    ["sensor.h", "bad", "open", { device_class: "enum" }],
    ["sensor.i", "bad", "unknown", { device_class: "enum" }],
  ]);
  const got = ["a", "b", "c", "d", "e"].map((x) => contactState(h, `binary_sensor.${x}`))
    .concat(["f", "g", "h", "i"].map((x) => contactState(h, `sensor.${x}`)));
  assert.deepEqual(got, ["open", "closed", "tilted", "open", "unknown", "tilted", "closed", "open", "unknown"]);
  assert.equal(contactState(h, "binary_sensor.missing"), "unknown");
});

test("gate states: position wins, moving, no position, unknown", () => {
  const { gateState } = loadCard().module.exports;
  const h = mkHass([
    ["cover.a", "garage", "open", { current_position: 45 }],
    ["cover.b", "garage", "closed", { current_position: 0 }],
    ["cover.c", "garage", "open", { current_position: 100 }],
    ["cover.d", "garage", "opening", { current_position: 20 }],
    ["cover.e", "garage", "open", {}],
    ["cover.f", "garage", "closed", {}],
    ["cover.g", "garage", "unavailable", {}],
    ["cover.h", "garage", "closing", {}],
  ]);
  const got = "abcdefgh".split("").map((x) => gateState(h, `cover.${x}`).status);
  assert.deepEqual(got, ["partial", "closed", "open", "opening", "open", "closed", "unknown", "closing"]);
  assert.equal(gateState(h, "cover.a").position, 45);
  assert.ok(Number.isNaN(gateState(h, "cover.e").position));
});

test("duration format", () => {
  const { duration } = loadCard().module.exports;
  const t = { just_now: "gerade eben" };
  assert.equal(duration(20000, t), "gerade eben");
  assert.equal(duration(5 * 60000, t), "5 min");
  assert.equal(duration(60 * 60000, t), "1 h");
  assert.equal(duration(70 * 60000, t), "1 h 10 min");
  assert.equal(duration(51 * 3600000, t), "2 d 3 h");
});

test("area name is stripped from the contact name", () => {
  const { shortName } = loadCard().module.exports;
  assert.equal(shortName("Bad Fenster", "Bad"), "Fenster");
  assert.equal(shortName("Kinderzimmer - Fenster links", "Kinderzimmer"), "Fenster links");
  assert.equal(shortName("bad fenster", "Bad"), "Fenster");
  assert.equal(shortName("Bad", "Bad"), "Bad");
  assert.equal(shortName("Badfenster", undefined), "Badfenster");
});

// ------------------------------------------------------------ discovery

test("finds window, door and opening contacts through the registry", () => {
  const { analyse } = loadCard().module.exports;
  const h = mkHass([
    win("w", "bad", "off", "W"),
    ["binary_sensor.door", "wohnen", "off", { device_class: "door" }],
    ["binary_sensor.opening", "wohnen", "off", { device_class: "opening" }],
    ["binary_sensor.motion", "wohnen", "off", { device_class: "motion" }],
    ["binary_sensor.diag", "wohnen", "off", { device_class: "window" }, { entity: { entity_category: "diagnostic" } }],
    ["binary_sensor.hidden", "wohnen", "off", { device_class: "window" }, { entity: { hidden: true } }],
    ["sensor.temp", "wohnen", "21", { device_class: "temperature" }],
  ]);
  const ids = [...analyse(h, {}, NOW).contacts.map((c) => c.entity).sort()];
  assert.deepEqual(ids, ["binary_sensor.door", "binary_sensor.opening", "binary_sensor.w"]);
});

test("contacts without an area are kept", () => {
  const { analyse } = loadCard().module.exports;
  const h = mkHass([win("lost", null, "on", "Dachfenster", 3)]);
  const c = analyse(h, {}, NOW).contacts[0];
  assert.equal(c.area, undefined);
  assert.equal(c.name, "Dachfenster");
});

test("thermostat window detection and a gate's own contact are not windows", () => {
  const { analyse } = loadCard().module.exports;
  const h = mkHass([
    ["climate.bad", "bad", "heat", {}, { device: "thermostat" }],
    ["binary_sensor.bad_window_open", "bad", "on", { device_class: "window" }, { device: "thermostat" }],
    ["cover.garagentor", "garage", "closed", { device_class: "garage" }, { device: "hmip_garage" }],
    ["binary_sensor.garage_contact", "garage", "off", { device_class: "garage_door" }, { device: "hmip_garage" }],
    win("bad_fenster", "bad", "off", "Bad Fenster"),
  ]);
  assert.deepEqual([...analyse(h, {}, NOW).contacts.map((c) => c.entity)], ["binary_sensor.bad_fenster"]);
});

test("rotary handle: the enum sensor wins over the binary sensor of the same device", () => {
  const { analyse } = loadCard().module.exports;
  const h = mkHass([
    ["binary_sensor.srh", "bad", "on", { device_class: "window" }, { device: "srh" }],
    ["sensor.srh_state", "bad", "tilted", { device_class: "enum", options: ["closed", "tilted", "open"] }, { device: "srh" }],
  ]);
  const d = analyse(h, {}, NOW);
  assert.deepEqual([...d.contacts.map((c) => c.entity)], ["sensor.srh_state"]);
  assert.equal(d.open[0].state, "tilted");
});

test("areas, exclude_areas, exclude_entities and windows", () => {
  const { analyse } = loadCard().module.exports;
  const ids = (cfg) => [...analyse(HOUSE(), cfg, NOW).contacts.map((c) => c.entity).sort()];
  assert.deepEqual(ids({ areas: ["kinder"] }), ["binary_sensor.kinder_links", "binary_sensor.kinder_rechts"]);
  assert.deepEqual(ids({ exclude_areas: ["kinder", "wohnen"] }), ["binary_sensor.bad_fenster"]);
  assert.equal(ids({ exclude_entities: ["binary_sensor.bad_fenster"] }).indexOf("binary_sensor.bad_fenster"), -1);
  assert.deepEqual(ids({ windows: ["binary_sensor.bad_fenster"] }), ["binary_sensor.bad_fenster"]);
});

test("gates: garage and gate covers automatically, shutters not", () => {
  const { analyse } = loadCard().module.exports;
  const h = HOUSE();
  h.states["cover.rollladen"] = { entity_id: "cover.rollladen", state: "open", attributes: { device_class: "shutter" } };
  assert.deepEqual([...analyse(h, {}, NOW).gates.map((g) => g.entity)], ["cover.carport", "cover.garagentor"]);
});

test("gates: configured list in its order, with name and icon, excluded ones dropped", () => {
  const { analyse } = loadCard().module.exports;
  const d = analyse(HOUSE(), {
    gates: [{ entity: "cover.garagentor", name: "Garage", icon: "mdi:car" }, "cover.carport"],
  }, NOW);
  assert.deepEqual(d.gates.map((g) => [g.entity, g.name, g.icon]).map((a) => [...a]), [
    ["cover.garagentor", "Garage", "mdi:car"], ["cover.carport", "Carport", undefined],
  ]);
  assert.equal(analyse(HOUSE(), { exclude_entities: ["cover.carport"] }, NOW).gates.length, 1);
  assert.equal(analyse(HOUSE(), { gates: [] }, NOW).gates.length, 0);
});

// ------------------------------------------------------------ rendering

test("whole house: gates always shown, open windows longest first", () => {
  const r = render(loadCardNow(), {}, HOUSE());
  assert.equal(r.badge, "3 offen");
  assert.match(r.badgeClass, /warn/); // the bathroom window is open for 45 min
  assert.deepEqual(r.gates.map((g) => [g.label, g.value, g.sub, g.pos]), [
    ["Carport", "Geschlossen", "", null],
    ["Garagentor", "45 % offen", "seit 12 min", "45%"],
  ]);
  assert.deepEqual(r.rows.map((x) => [x.title, x.meta, x.time]), [
    ["Bad", "Fenster · offen", "45 min"],
    ["Kinderzimmer", "Fenster links · offen", "5 min"],
  ]);
  assert.match(r.rows[0].cls, /warn/);
  assert.doesNotMatch(r.rows[1].cls, /warn/);
  assert.match(r.gates[1].cls, /open/);
});

test("all closed: green badge and one summary line", () => {
  const h = HOUSE();
  h.states["binary_sensor.bad_fenster"].state = "off";
  h.states["binary_sensor.kinder_links"].state = "off";
  h.states["cover.garagentor"].state = "closed";
  h.states["cover.garagentor"].attributes.current_position = 0;
  const r = render(loadCardNow(), {}, h);
  assert.equal(r.badge, "Alles zu");
  assert.match(r.badgeClass, /good/);
  assert.equal(r.rows.length, 0);
  assert.equal(r.allClosed, "Alle 4 Fenster und Türen geschlossen");
  assert.deepEqual(r.gates.map((g) => g.value), ["Geschlossen", "Geschlossen"]);
});

test("open but not for long: blue badge, warn_minutes changes the limit", () => {
  const h = mkHass([win("bad_fenster", "bad", "on", "Bad Fenster", 10)]);
  assert.match(render(loadCardNow(), {}, h).badgeClass, /open/);
  assert.match(render(loadCardNow(), { warn_minutes: 5 }, h).badgeClass, /warn/);
  assert.match(render(loadCardNow(), { warn_minutes: 0 }, h).badgeClass, /open/);
});

test("a gate open too long is highlighted, a moving one not", () => {
  const h = mkHass([
    ["cover.a", "garage", "open", { device_class: "garage" }, { minutes: 90 }],
    ["cover.b", "garage", "opening", { device_class: "gate" }, { minutes: 90 }],
  ]);
  const r = render(loadCardNow(), {}, h);
  assert.deepEqual(r.gates.map((g) => g.cls), ["gate warn", "gate open"]);
  assert.deepEqual(r.gates.map((g) => g.value), ["Offen", "Öffnet …"]);
  assert.equal(r.badge, "2 offen");
});

test("tilted window shows as tilted", () => {
  const h = mkHass([["binary_sensor.srh", "bad", "on", { device_class: "window", window_state: "TILTED", friendly_name: "Bad Fenster" }, { minutes: 2 }]]);
  assert.equal(render(loadCardNow(), {}, h).rows[0].meta, "Fenster · gekippt");
});

test("unavailable contacts are counted, not shown as closed", () => {
  const h = mkHass([win("a", "bad", "unavailable", "Bad Fenster"), win("b", "kinder", "off", "K Fenster")]);
  const r = render(loadCardNow(), {}, h);
  assert.equal(r.unavailable, "1 Sensor nicht erreichbar");
  assert.equal(r.allClosed, "1 Fenster bzw. Tür, geschlossen");
});

test("unknown gate state (no feedback) is shown as unknown and not as open", () => {
  const h = mkHass([["cover.carport", "einfahrt", "unknown", { device_class: "gate", friendly_name: "Carport" }]]);
  const r = render(loadCardNow(), {}, h);
  assert.equal(r.gates[0].value, "Unbekannt");
  assert.equal(r.badge, "Alles zu");
});

test("English strings", () => {
  const h = HOUSE();
  h.language = "en"; h.locale.language = "en-GB";
  const r = render(loadCardNow(), {}, h);
  assert.equal(r.badge, "3 open");
  assert.equal(r.gates[1].value, "45 % open");
  assert.equal(r.gates[1].sub, "for 12 min");
  assert.equal(r.rows[0].meta, "Fenster · open");
});

test("nothing found shows a hint, not an empty card", () => {
  const r = render(loadCardNow(), {}, mkHass([]));
  assert.match(r.empty, /Keine Fenster/);
});

test("names are set as text, never parsed as HTML", () => {
  const h = HOUSE();
  h.areas.bad.name = "<img src=x onerror=alert(1)>";
  const r = render(loadCardNow(), {}, h);
  assert.equal(r.rows[0].title, "<img src=x onerror=alert(1)>");
});

test("tap on a gate or a window opens more-info", () => {
  const r = render(loadCardNow(), {}, HOUSE());
  r.gates[1].el.click();
  r.rows[0].el.click();
  const ids = r.card.dispatched.filter((e) => e.type === "hass-more-info").map((e) => e.detail.entityId);
  assert.deepEqual(ids, ["cover.garagentor", "binary_sensor.bad_fenster"]);
});

test("durations move on without a state change", () => {
  const ctx = loadCardNow();
  const r = render(ctx, {}, HOUSE());
  ctx.Date.now = () => NOW + 20 * 60000;
  r.card._safeUpdate();
  assert.equal(r.root.querySelector(".row-time").textContent, "1 h 5 min");
});

test("render errors are shown inside the card", () => {
  const h = HOUSE();
  Object.defineProperty(h, "areas", { get() { throw new Error("boom"); } });
  const r = render(loadCardNow(), {}, h);
  assert.match(r.warning, /boom/);
});

test("invalid config is rejected, empty config is fine", () => {
  const Card = loadCard().customElements.get("house-openings-card");
  assert.throws(() => new Card().setConfig({ areas: 5 }), /must be a list/);
  assert.throws(() => new Card().setConfig({ gates: [{ name: "x" }] }), /need an entity/);
  assert.throws(() => new Card().setConfig({ warn_minutes: "soon" }), /number/);
  assert.doesNotThrow(() => new Card().setConfig({ type: "custom:house-openings-card" }));
  assert.doesNotThrow(() => new Card().setConfig({ gates: "cover.garagentor" }));
  assert.deepEqual({ ...Card.getStubConfig() }, {});
});

test("grid and layout options", () => {
  const Card = loadCard().customElements.get("house-openings-card");
  const c = new Card();
  assert.equal(c.getGridOptions().columns, 6);
  assert.equal(c.getLayoutOptions().grid_columns, 2);
});

// ------------------------------------------------------------ editor

test("editor drops empty and default values, keeps gate names from YAML", () => {
  const ctx = loadCard();
  const Editor = ctx.customElements.get("house-openings-card-editor");
  const ed = new Editor();
  ed.setConfig({ title: "X", gates: [{ entity: "cover.garagentor", name: "Garage" }, "cover.carport"] });
  ed.hass = mkHass([]);
  ed._onFormValue({ title: "", areas: [], windows: [], warn_minutes: 30, auto_exclude: true, gates: ["cover.garagentor", "cover.neu"] });
  const cfg = ed.dispatched.pop().detail.config;
  assert.deepEqual(JSON.parse(JSON.stringify(cfg)), { gates: [{ entity: "cover.garagentor", name: "Garage" }, "cover.neu"] });
});

// ------------------------------------------------------------ appliances

test("appliance doors (air fryer, oven, dishwasher, …) are not windows or doors", () => {
  const { analyse } = loadCard().module.exports;
  const h = mkHass([
    ["binary_sensor.airfryer_door", "kueche", "on", { device_class: "door", friendly_name: "Airfryer Tür" }, { minutes: 3 }],
    ["binary_sensor.korb", "kueche", "on", { device_class: "opening", friendly_name: "Korb" }, { device: "fryer" }],
    ["binary_sensor.dw_door", "kueche", "off", { device_class: "door", friendly_name: "Tür" }, { device: "dw", entity: { platform: "home_connect" } }],
    ["binary_sensor.oven_door", "kueche", "off", { device_class: "door", friendly_name: "Backofen Tür" }],
    ["binary_sensor.fridge", "kueche", "off", { device_class: "door", friendly_name: "Kühlschrank" }],
    ["binary_sensor.wm", "keller", "off", { device_class: "door", friendly_name: "Waschmaschine Tür" }],
    win("kueche_fenster", "kueche", "on", "Küche Fenster", 10),
  ]);
  h.devices.fryer.name = "Philips Air Fryer XXL";
  assert.deepEqual([...analyse(h, {}, NOW).contacts.map((c) => c.entity)], ["binary_sensor.kueche_fenster"]);
  assert.equal(analyse(h, { auto_exclude: false }, NOW).contacts.length, 7);
});

test("ordinary windows and doors are not mistaken for appliances", () => {
  const { analyse } = loadCard().module.exports;
  const names = ["Waschküche Fenster", "Küche Fenster", "Haustür", "Terrassentür", "Kellerfenster", "Ofenzimmer Fenster",
    "Dachfenster Bad", "Kinderzimmer Balkontür", "Garage Seitentür", "Wintergarten Schiebetür"];
  const h = mkHass(names.map((n, i) => [`binary_sensor.c${i}`, "wohnen", "off", { device_class: i % 2 ? "door" : "window", friendly_name: n }]));
  assert.equal(analyse(h, {}, NOW).contacts.length, names.length);
});
