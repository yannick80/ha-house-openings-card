/**
 * House Openings Card – a Home Assistant dashboard card that shows which
 * windows and doors are open, and keeps garage doors and gates in view.
 * https://github.com/yannick80/ha-house-openings-card
 *
 * Plain custom element, no build step and no dependencies. Window and door
 * contacts are found through the areas of the entity and device registry and
 * their device_class; garage doors and gates are the covers with the
 * device_class garage or gate. No configuration needed.
 */

(function () {
"use strict";

const VERSION = "0.1.1";

// binary_sensor device classes that count as a window or door
const CONTACT_CLASSES = ["window", "door", "opening", "garage_door"];
// cover device classes shown as permanent gate tiles
const GATE_CLASSES = ["garage", "gate"];

// States of enum sensors (rotary handles: open / tilted / closed)
const TILTED_RE = /(tilt|gekippt|kipp)/i;
const OPEN_RE = /^(open|opened|offen|ge(ö|oe)ffnet|on)$/i;
const CLOSED_RE = /^(closed|geschlossen|zu|off)$/i;

// Doors and lids of appliances: air fryer, oven, dishwasher, fridge, …
// Matched against entity_id, name, friendly_name, translation_key and the
// device's name and model.
const APPLIANCE_RE = new RegExp([
  "air.?fryer", "hei(ß|ss)luft", "fritteuse", "fryer", "friteuse",
  "backofen", "oven", "dampfgar", "steam", "mikrowelle", "microwave", "thermomix",
  "sp(ü|ue)lmaschine", "geschirrsp(ü|ue)ler", "dishwasher",
  "waschmaschine", "washing.?machine", "washer", "trockner", "dryer",
  "k(ü|ue)hlschrank", "fridge", "refrigerator", "gefrier", "freezer", "weinklima", "wine.?cooler",
  "kaffee", "coffee", "espresso",
].join("|"), "i");

// Integrations whose door sensors belong to appliances
const APPLIANCE_PLATFORMS = ["miele_lan", "miele", "home_connect", "vesync", "philips_airfryer", "smartthings_appliance"];

const DEFAULTS = { warn_minutes: 30 };

const STRINGS = {
  de: {
    title: "Fenster & Tore",
    all_closed: "Alles zu",
    n_open: "{n} offen",
    open: "offen",
    tilted: "gekippt",
    gate_closed: "Geschlossen",
    gate_open: "Offen",
    gate_partial: "{p} % offen",
    gate_opening: "Öffnet …",
    gate_closing: "Schließt …",
    gate_unknown: "Unbekannt",
    since: "seit {d}",
    just_now: "gerade eben",
    open_label: "Offen",
    closed_one: "1 Fenster bzw. Tür, geschlossen",
    closed_many: "Alle {n} Fenster und Türen geschlossen",
    unavailable_one: "1 Sensor nicht erreichbar",
    unavailable_many: "{n} Sensoren nicht erreichbar",
    no_area: "Ohne Bereich",
    nothing: "Keine Fenster- oder Türkontakte und keine Tore gefunden. Weise die Kontakte einem Bereich zu oder wähle Tore in den Optionen.",
    editor: {
      title: "Titel",
      gates: "Tore (leer = Garagentore und Tore automatisch)",
      areas: "Nur diese Bereiche (leer = alle)",
      exclude_areas: "Bereiche ausblenden",
      exclude_entities: "Kontakte oder Tore ignorieren",
      windows: "Nur diese Kontakte (leer = automatisch)",
      warn_minutes: "Hervorheben, wenn länger offen als (Minuten)",
      auto_exclude: "Gerätetüren ausblenden (Airfryer, Backofen, …)",
    },
  },
  en: {
    title: "Windows & gates",
    all_closed: "All closed",
    n_open: "{n} open",
    open: "open",
    tilted: "tilted",
    gate_closed: "Closed",
    gate_open: "Open",
    gate_partial: "{p} % open",
    gate_opening: "Opening …",
    gate_closing: "Closing …",
    gate_unknown: "Unknown",
    since: "for {d}",
    just_now: "just now",
    open_label: "Open",
    closed_one: "1 window or door, closed",
    closed_many: "All {n} windows and doors closed",
    unavailable_one: "1 sensor unavailable",
    unavailable_many: "{n} sensors unavailable",
    no_area: "No area",
    nothing: "No window or door contacts and no gates found. Assign the contacts to an area, or pick gates in the options.",
    editor: {
      title: "Title",
      gates: "Gates (empty = garage doors and gates automatically)",
      areas: "Only these areas (empty = all)",
      exclude_areas: "Hide areas",
      exclude_entities: "Ignore contacts or gates",
      windows: "Only these contacts (empty = automatic)",
      warn_minutes: "Highlight when open longer than (minutes)",
      auto_exclude: "Hide appliance doors (air fryer, oven, …)",
    },
  },
};

function langOf(hass) {
  const l = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  return String(l).toLowerCase();
}

function strings(hass) {
  return STRINGS[langOf(hass).split("-")[0]] || STRINGS.en;
}

function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m));
}

function list(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function domainOf(id) {
  return String(id).split(".")[0];
}

// ------------------------------------------------------------ states

function attrs(hass, id) {
  const st = hass.states && hass.states[id];
  return (st && st.attributes) || {};
}

function friendlyName(hass, id) {
  return attrs(hass, id).friendly_name || id;
}

// "closed" | "open" | "tilted" | "unknown" for a contact (binary_sensor or enum sensor)
function contactState(hass, id) {
  const st = hass.states && hass.states[id];
  if (!st) return "unknown";
  const s = String(st.state);
  if (s === "unavailable" || s === "unknown") return "unknown";
  if (domainOf(id) === "binary_sensor") {
    if (s === "off") return "closed";
    if (s !== "on") return "unknown";
    // Homematic IP rotary handles report open / tilted in an attribute
    const ws = st.attributes && st.attributes.window_state;
    return ws && TILTED_RE.test(String(ws)) ? "tilted" : "open";
  }
  if (TILTED_RE.test(s)) return "tilted";
  if (OPEN_RE.test(s)) return "open";
  if (CLOSED_RE.test(s)) return "closed";
  return "unknown";
}

// An enum sensor that knows "tilted" (rotary handle), as some integrations add one
function isHandleSensor(hass, id) {
  if (domainOf(id) !== "sensor") return false;
  const options = attrs(hass, id).options;
  return Array.isArray(options) && options.some((o) => TILTED_RE.test(String(o)));
}

function isContact(hass, id) {
  if (domainOf(id) === "binary_sensor") return CONTACT_CLASSES.indexOf(attrs(hass, id).device_class) >= 0;
  return isHandleSensor(hass, id);
}

function sinceMs(hass, id) {
  const st = hass.states && hass.states[id];
  const t = st && Date.parse(st.last_changed || st.last_updated);
  return isFinite(t) ? t : undefined;
}

// ------------------------------------------------------------ discovery

// Why a contact is an appliance door, or "" if it is a real window or door
function applianceReason(hass, id, ent) {
  if (!ent) return "";
  if (APPLIANCE_PLATFORMS.indexOf(ent.platform) >= 0) return "platform";
  const dev = ent.device_id && hass.devices ? hass.devices[ent.device_id] : undefined;
  const text = [id, ent.name, ent.translation_key, attrs(hass, id).friendly_name,
    dev && dev.name, dev && dev.name_by_user, dev && dev.model]
    .filter(Boolean)
    .join(" ");
  return APPLIANCE_RE.test(text) ? "name" : "";
}

function areaOfEntity(hass, ent) {
  if (!ent) return undefined;
  if (ent.area_id) return ent.area_id;
  const dev = ent.device_id && hass.devices ? hass.devices[ent.device_id] : undefined;
  return dev ? dev.area_id || undefined : undefined;
}

// Gate entries from the config: "cover.x" or { entity, name, icon }
function gateSpecs(hass, config) {
  const hide = new Set(list(config.exclude_entities));
  if (config.gates !== undefined) {
    return list(config.gates)
      .map((g) => (typeof g === "string" ? { entity: g } : g))
      .filter((g) => g && g.entity && !hide.has(g.entity));
  }
  const ents = hass.entities || {};
  return Object.keys(hass.states || {})
    .filter((id) => {
      if (domainOf(id) !== "cover" || hide.has(id)) return false;
      if (GATE_CLASSES.indexOf(attrs(hass, id).device_class) < 0) return false;
      const ent = ents[id];
      return !(ent && (ent.hidden || ent.hidden_by || ent.entity_category));
    })
    .sort((a, b) => friendlyName(hass, a).localeCompare(friendlyName(hass, b)))
    .map((id) => ({ entity: id }));
}

// Window and door contacts with their area. With `windows`, exactly those.
// Otherwise every binary_sensor with a window/door class and every rotary
// handle enum sensor in the registry, except:
//  - diagnostic and hidden entities,
//  - binary sensors of a device that also has a rotary handle sensor (same window twice),
//  - contacts on a device with a climate entity (thermostat "window open" detection),
//  - contacts on the device of a shown gate (the gate's own end switch),
//  - appliance doors (air fryer, oven, dishwasher, …), unless auto_exclude: false.
function discoverContacts(hass, config, gates) {
  const ents = hass.entities || {};
  const hide = new Set(list(config.exclude_entities));
  let ids;
  if (config.windows !== undefined) {
    ids = list(config.windows).filter((id) => !hide.has(id));
  } else {
    const handleDevices = new Set();
    const climateDevices = new Set();
    const gateDevices = new Set();
    const gateIds = new Set(gates.map((g) => g.entity));
    for (const id of Object.keys(ents)) {
      const ent = ents[id];
      if (!ent || !ent.device_id) continue;
      if (domainOf(id) === "climate") climateDevices.add(ent.device_id);
      if (gateIds.has(id)) gateDevices.add(ent.device_id);
      if (isHandleSensor(hass, id) && !ent.entity_category) handleDevices.add(ent.device_id);
    }
    ids = Object.keys(ents).filter((id) => {
      const ent = ents[id];
      if (!ent || hide.has(id) || ent.entity_category || ent.hidden || ent.hidden_by) return false;
      if (!hass.states || !hass.states[id] || !isContact(hass, id)) return false;
      if (config.auto_exclude !== false && applianceReason(hass, id, ent)) return false;
      const dev = ent.device_id;
      if (dev && (climateDevices.has(dev) || gateDevices.has(dev))) return false;
      if (dev && domainOf(id) === "binary_sensor" && handleDevices.has(dev)) return false;
      return true;
    });
  }

  const only = list(config.areas);
  const hideAreas = new Set(list(config.exclude_areas));
  const out = [];
  for (const id of ids) {
    const area = areaOfEntity(hass, ents[id]);
    if (area && hideAreas.has(area)) continue;
    if (only.length && only.indexOf(area) < 0) continue;
    out.push({ entity: id, area });
  }
  return out;
}

// The contact's name without the area name in front ("Bad Fenster" -> "Fenster")
function shortName(name, areaName) {
  if (!areaName) return name;
  const n = String(name);
  if (n.toLowerCase().indexOf(areaName.toLowerCase()) === 0) {
    const rest = n.slice(areaName.length).replace(/^[\s\-–:·,]+/, "");
    if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return n;
}

// "closed" | "open" | "partial" | "opening" | "closing" | "unknown", position 0–100 or NaN
function gateState(hass, id) {
  const st = hass.states && hass.states[id];
  if (!st) return { status: "unknown", position: NaN };
  const s = String(st.state);
  const pos = parseFloat(st.attributes && st.attributes.current_position);
  const position = isFinite(pos) ? Math.max(0, Math.min(100, pos)) : NaN;
  let status;
  if (s === "opening" || s === "closing") status = s;
  else if (s === "unavailable" || s === "unknown") status = "unknown";
  else if (isFinite(position)) status = position <= 0 ? "closed" : position >= 100 ? "open" : "partial";
  else if (s === "open" || s === "on") status = "open";
  else if (s === "closed" || s === "off") status = "closed";
  else status = "unknown";
  return { status, position };
}

// Everything the card shows, independent of the DOM
function analyse(hass, config, now) {
  if (now === undefined) now = Date.now();
  const warnMs = (config.warn_minutes !== undefined ? Number(config.warn_minutes) : DEFAULTS.warn_minutes) * 60000;
  const areas = hass.areas || {};
  const overdue = (since) => warnMs > 0 && since !== undefined && now - since >= warnMs;

  const gates = gateSpecs(hass, config).map((spec) => {
    const g = gateState(hass, spec.entity);
    const since = sinceMs(hass, spec.entity);
    const isOpen = g.status !== "closed" && g.status !== "unknown";
    return {
      entity: spec.entity,
      name: spec.name || friendlyName(hass, spec.entity),
      icon: spec.icon,
      kind: attrs(hass, spec.entity).device_class === "garage" ? "garage" : "gate",
      status: g.status,
      position: g.position,
      open: isOpen,
      since,
      overdue: isOpen && g.status !== "opening" && g.status !== "closing" && overdue(since),
    };
  });

  const contacts = discoverContacts(hass, config, gates).map((c) => {
    const area = areas[c.area];
    const areaName = area ? area.name || c.area : undefined;
    const state = contactState(hass, c.entity);
    const since = sinceMs(hass, c.entity);
    return {
      entity: c.entity,
      area: c.area,
      areaName,
      name: shortName(friendlyName(hass, c.entity), areaName),
      deviceClass: attrs(hass, c.entity).device_class,
      state,
      open: state === "open" || state === "tilted",
      since,
      overdue: (state === "open" || state === "tilted") && overdue(since),
    };
  });

  // Longest open first
  const open = contacts.filter((c) => c.open).sort((a, b) => {
    const sa = a.since !== undefined ? a.since : now;
    const sb = b.since !== undefined ? b.since : now;
    return sa - sb || String(a.areaName || "").localeCompare(String(b.areaName || ""));
  });
  const unknown = contacts.filter((c) => c.state === "unknown");
  const openGates = gates.filter((g) => g.open);
  const count = open.length + openGates.length;
  const anyOverdue = open.some((c) => c.overdue) || openGates.some((g) => g.overdue);

  return {
    gates,
    contacts,
    open,
    unknown,
    count,
    overall: count ? (anyOverdue ? "warn" : "open") : contacts.length || gates.length ? "good" : "none",
  };
}

// "5 min", "1 h 10 min", "2 d 3 h"
function duration(ms, t) {
  const min = Math.floor(ms / 60000);
  if (!isFinite(min) || min < 1) return t.just_now;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

// ------------------------------------------------------------ DOM helpers

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name, cls) {
  const i = el("ha-icon", cls);
  i.setAttribute("icon", name);
  return i;
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 14px 16px 12px; overflow: hidden; }
  .warning { color: var(--error-color, #db4437); }
  .hint-empty { color: var(--secondary-text-color); font-size: 14px; line-height: 1.5; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .title { display: flex; align-items: center; font-size: 16px; font-weight: 500; color: var(--primary-text-color); min-width: 0; }
  .title ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); margin-right: 8px; }
  .badge { font-size: 12px; padding: 3px 10px; border-radius: 10px; white-space: nowrap; margin-left: 8px;
    background: rgba(127,127,127,0.15); color: var(--secondary-text-color); }
  .badge.good { background: rgba(76,175,80,0.15); background: color-mix(in srgb, var(--ho-good) 15%, transparent); color: var(--ho-good); }
  .badge.open { background: rgba(3,155,229,0.15); background: color-mix(in srgb, var(--ho-open) 15%, transparent); color: var(--ho-open); }
  .badge.warn { background: rgba(255,152,0,0.18); background: color-mix(in srgb, var(--ho-warn) 18%, transparent); color: var(--ho-warn); }
  .gates { display: flex; flex-wrap: wrap; margin: 0 -5px 2px; }
  .gate { flex: 1 1 140px; box-sizing: border-box; min-width: 0; margin: 0 5px 10px; padding: 9px 11px; border-radius: 10px; cursor: pointer;
    background: rgba(127,127,127,0.08); background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
  .gate.open { background: rgba(3,155,229,0.12); background: color-mix(in srgb, var(--ho-open) 12%, transparent); }
  .gate.warn { background: rgba(255,152,0,0.15); background: color-mix(in srgb, var(--ho-warn) 15%, transparent); }
  .gate-label { display: flex; align-items: center; font-size: 12px; color: var(--secondary-text-color); min-width: 0; }
  .gate-label span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gate-label ha-icon { --mdc-icon-size: 16px; margin-right: 5px; flex: none; }
  .gate.open .gate-label ha-icon { color: var(--ho-open); }
  .gate.warn .gate-label ha-icon { color: var(--ho-warn); }
  .gate-value { font-size: 18px; font-weight: 500; color: var(--primary-text-color); margin-top: 2px; white-space: nowrap; }
  .gate-sub { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; min-height: 14px; }
  .gate.warn .gate-sub { color: var(--ho-warn); }
  .pos { height: 5px; border-radius: 3px; margin-top: 6px; background: rgba(127,127,127,0.2); overflow: hidden; }
  .pos-fill { height: 5px; border-radius: 3px; background: var(--secondary-text-color); }
  .gate.open .pos-fill { background: var(--ho-open); }
  .gate.warn .pos-fill { background: var(--ho-warn); }
  .section-label { font-size: 12px; color: var(--secondary-text-color); margin: 2px 0 2px; }
  .row { display: flex; align-items: center; padding: 5px 0; cursor: pointer; }
  .row > ha-icon { --mdc-icon-size: 20px; color: var(--ho-open); margin-right: 10px; flex: none; }
  .row.warn > ha-icon { color: var(--ho-warn); }
  .row-name { flex: 1 1 auto; min-width: 0; }
  .row-title { font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-meta { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-time { flex: none; margin-left: 10px; font-size: 13px; color: var(--primary-text-color); white-space: nowrap; }
  .row.warn .row-time { color: var(--ho-warn); font-weight: 500; }
  .all-closed { display: flex; align-items: center; font-size: 13px; color: var(--secondary-text-color); padding: 2px 0; }
  .all-closed ha-icon { --mdc-icon-size: 18px; color: var(--ho-good); margin-right: 8px; }
  .unavailable { display: flex; align-items: center; font-size: 12px; color: var(--secondary-text-color); padding: 6px 0 0; cursor: pointer; }
  .unavailable ha-icon { --mdc-icon-size: 15px; margin-right: 6px; }
`;

const CONTACT_ICONS = {
  window: { open: "mdi:window-open-variant", tilted: "mdi:window-open" },
  door: { open: "mdi:door-open", tilted: "mdi:door-open" },
  garage_door: { open: "mdi:garage-open", tilted: "mdi:garage-open" },
};

function gateIcon(g) {
  if (g.icon) return g.icon;
  if (g.kind === "garage") return g.open ? "mdi:garage-open" : "mdi:garage";
  return g.open ? "mdi:gate-open" : "mdi:gate";
}

// ------------------------------------------------------------ card

class HouseOpeningsCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("house-openings-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
  }

  setConfig(config) {
    if (config === null || config === undefined) config = {};
    if (typeof config !== "object") throw new Error("Invalid configuration");
    for (const k of ["gates", "windows", "areas", "exclude_areas", "exclude_entities"]) {
      if (config[k] !== undefined && config[k] !== null && typeof config[k] !== "string" && !Array.isArray(config[k])) {
        throw new Error(`'${k}' must be a list`);
      }
    }
    for (const g of list(config.gates)) {
      if (typeof g !== "string" && !(g && typeof g === "object" && typeof g.entity === "string")) {
        throw new Error("'gates' entries need an entity");
      }
    }
    if (config.warn_minutes !== undefined && !isFinite(Number(config.warn_minutes))) {
      throw new Error("'warn_minutes' must be a number");
    }
    this._config = { ...config };
    this._signature = "";
    if (this._hass) this._safeUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._safeUpdate();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 2 + Math.ceil((this._gateCount || 0) / 2) * 2 + (this._openCount || 0);
  }

  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  getLayoutOptions() {
    return { grid_columns: 2, grid_rows: "auto" };
  }

  connectedCallback() {
    // Durations ("for 12 min") move on without a state change
    this._timer = setInterval(() => {
      if (this._hass && this._config) this._safeUpdate();
    }, 30000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  _safeUpdate() {
    try {
      this._update();
    } catch (e) {
      console.error("house-openings-card: render failed", e);
      this._showMessage(`house-openings-card: ${(e && e.message) || e}`, "warning");
    }
  }

  _update() {
    const now = Date.now();
    const t = strings(this._hass);
    const data = analyse(this._hass, this._config, now);
    this._gateCount = data.gates.length;
    this._openCount = data.open.length;
    const ago = (since) => (since === undefined ? "" : duration(now - since, t));
    const sig = JSON.stringify([
      langOf(this._hass),
      this._config,
      data.gates.map((g) => [g.entity, g.name, g.status, g.position, g.overdue, g.open ? ago(g.since) : ""]),
      data.open.map((c) => [c.entity, c.name, c.areaName, c.state, c.overdue, ago(c.since)]),
      data.contacts.length,
      data.unknown.map((c) => c.entity),
    ]);
    if (sig === this._signature) return;
    this._signature = sig;
    this._render(data, now);
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _shell() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = el("style");
    style.textContent = STYLE;
    root.appendChild(style);
    const card = el("ha-card");
    card.style.setProperty("--ho-good", "var(--success-color, #43a047)");
    card.style.setProperty("--ho-open", "var(--info-color, #039be5)");
    card.style.setProperty("--ho-warn", "var(--warning-color, #ffa600)");
    root.appendChild(card);
    return card;
  }

  _showMessage(text, cls) {
    this._signature = "";
    const card = this._shell();
    card.appendChild(el("div", cls, text));
  }

  _render(data, now) {
    const t = strings(this._hass);
    const card = this._shell();

    const head = card.appendChild(el("div", "head"));
    const title = head.appendChild(el("div", "title"));
    title.appendChild(icon(data.count ? "mdi:window-open-variant" : "mdi:window-closed-variant"));
    title.appendChild(el("span", "", this._config.title || t.title));

    if (data.overall === "none") {
      card.appendChild(el("div", "hint-empty", t.nothing));
      return;
    }
    head.appendChild(el("span", `badge ${data.overall}`, data.count ? fmt(t.n_open, { n: data.count }) : t.all_closed));

    // gates: always shown
    if (data.gates.length) {
      const box = card.appendChild(el("div", "gates"));
      for (const g of data.gates) box.appendChild(this._gate(g, t, now));
    }

    // open windows and doors, longest first
    if (data.open.length) {
      if (data.gates.length) card.appendChild(el("div", "section-label", t.open_label));
      for (const c of data.open) card.appendChild(this._row(c, t, now));
    } else if (data.contacts.length) {
      const known = data.contacts.length - data.unknown.length;
      if (known) {
        const line = card.appendChild(el("div", "all-closed"));
        line.appendChild(icon("mdi:check-circle-outline"));
        line.appendChild(el("span", "", known === 1 ? t.closed_one : fmt(t.closed_many, { n: known })));
      }
    }

    if (data.unknown.length) {
      const n = data.unknown.length;
      const line = card.appendChild(el("div", "unavailable"));
      line.appendChild(icon("mdi:help-circle-outline"));
      const names = data.unknown.map((c) => (c.areaName ? `${c.areaName} ${c.name}` : c.name)).join(", ");
      line.appendChild(el("span", "", n === 1 ? t.unavailable_one : fmt(t.unavailable_many, { n })));
      line.setAttribute("title", names);
      line.addEventListener("click", () => this._moreInfo(data.unknown[0].entity));
    }
  }

  _gate(g, t, now) {
    const cls = g.overdue ? "warn" : g.open ? "open" : g.status;
    const tile = el("div", `gate ${cls}`);
    const label = tile.appendChild(el("div", "gate-label"));
    label.appendChild(icon(gateIcon(g)));
    label.appendChild(el("span", "", g.name));
    const value = g.status === "partial" ? fmt(t.gate_partial, { p: Math.round(g.position) }) : t[`gate_${g.status}`];
    tile.appendChild(el("div", "gate-value", value));
    const sub = g.open && g.since !== undefined ? fmt(t.since, { d: duration(now - g.since, t) }) : "";
    tile.appendChild(el("div", "gate-sub", sub));
    if (isFinite(g.position)) {
      const bar = tile.appendChild(el("div", "pos"));
      const fill = bar.appendChild(el("div", "pos-fill"));
      fill.style.setProperty("width", `${Math.round(g.position)}%`);
    }
    tile.addEventListener("click", () => this._moreInfo(g.entity));
    return tile;
  }

  _row(c, t, now) {
    const row = el("div", `row${c.overdue ? " warn" : ""}`);
    const icons = CONTACT_ICONS[c.deviceClass] || CONTACT_ICONS.window;
    row.appendChild(icon(icons[c.state] || icons.open));
    const name = row.appendChild(el("div", "row-name"));
    const stateText = c.state === "tilted" ? t.tilted : t.open;
    if (c.areaName) {
      name.appendChild(el("div", "row-title", c.areaName));
      name.appendChild(el("div", "row-meta", `${c.name} · ${stateText}`));
    } else {
      name.appendChild(el("div", "row-title", c.name));
      name.appendChild(el("div", "row-meta", stateText));
    }
    row.appendChild(el("div", "row-time", c.since !== undefined ? duration(now - c.since, t) : ""));
    row.addEventListener("click", () => this._moreInfo(c.entity));
    return row;
  }
}

// -------------------------------------------------------------------- editor

class HouseOpeningsCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._ensureForm();
  }

  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    // ha-form is loaded lazily by HA; loading the editor of a built-in card pulls it in.
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "button", entity: "sun.sun" });
      if (card && card.constructor && card.constructor.getConfigElement) {
        await card.constructor.getConfigElement();
      }
    } catch (e) {
      /* ignore – the form will appear once ha-form is defined */
    }
    await customElements.whenDefined("ha-form");
    this._render();
  }

  _schema() {
    const contacts = [
      { domain: "binary_sensor", device_class: CONTACT_CLASSES },
      { domain: "sensor", device_class: "enum" },
    ];
    return [
      { name: "title", selector: { text: {} } },
      { name: "gates", selector: { entity: { multiple: true, filter: [{ domain: "cover" }] } } },
      { name: "areas", selector: { area: { multiple: true } } },
      { name: "exclude_areas", selector: { area: { multiple: true } } },
      {
        name: "exclude_entities",
        selector: { entity: { multiple: true, filter: contacts.concat([{ domain: "cover" }]) } },
      },
      { name: "windows", selector: { entity: { multiple: true, filter: contacts } } },
      { name: "warn_minutes", selector: { number: { min: 0, max: 1440, step: 5, mode: "box", unit_of_measurement: "min" } } },
      { name: "auto_exclude", selector: { boolean: {} } },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => strings(this._hass).editor[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => this._onFormValue(ev.detail.value));
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    const data = { warn_minutes: DEFAULTS.warn_minutes, auto_exclude: true, ...this._config };
    // The entity picker only knows IDs; names and icons set in YAML are kept in _onFormValue
    if (this._config.gates !== undefined) {
      data.gates = list(this._config.gates).map((g) => (typeof g === "string" ? g : g.entity));
    }
    if (this._config.windows !== undefined) data.windows = list(this._config.windows);
    this._form.data = data;
  }

  _onFormValue(value) {
    const config = { ...this._config, ...value };
    if (Array.isArray(value.gates)) {
      const old = list(this._config.gates);
      config.gates = value.gates.map((id) => {
        const match = old.find((g) => g && typeof g === "object" && g.entity === id);
        return match || id;
      });
    }
    for (const k of Object.keys(config)) {
      const v = config[k];
      if (v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length)) delete config[k];
    }
    if (Number(config.warn_minutes) === DEFAULTS.warn_minutes) delete config.warn_minutes;
    if (config.auto_exclude === true) delete config.auto_exclude;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("house-openings-card")) customElements.define("house-openings-card", HouseOpeningsCard);
if (!customElements.get("house-openings-card-editor")) {
  customElements.define("house-openings-card-editor", HouseOpeningsCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "house-openings-card")) {
  window.customCards.push({
    type: "house-openings-card",
    name: "House Openings Card",
    description: "Open windows and doors at a glance, garage doors and gates always in view",
    preview: true,
    documentationURL: "https://github.com/yannick80/ha-house-openings-card",
  });
}

console.info(`%c house-openings-card %c ${VERSION} `, "color:#fff;background:#555;font-weight:700", "color:#555;background:#eee");

// Test hook: only active when evaluated with a CommonJS-style `module` (node tests)
if (typeof module !== "undefined" && module && module.exports) {
  module.exports = {
    HouseOpeningsCard: HouseOpeningsCard,
    HouseOpeningsCardEditor: HouseOpeningsCardEditor,
    analyse: analyse,
    applianceReason: applianceReason,
    contactState: contactState,
    discoverContacts: discoverContacts,
    duration: duration,
    gateState: gateState,
    shortName: shortName,
  };
}
})();
