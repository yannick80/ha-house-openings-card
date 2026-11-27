# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.1 - 2026-11-27

### Fixed

- Doors and lids of appliances (air fryer, oven, dishwasher, washing
  machine, dryer, fridge, coffee machine, …) are no longer listed as open
  doors. They are recognised by name, device name or model and by
  integration; `auto_exclude: false` turns this off, also in the editor.

## 0.1.0 - 2026-11-27

### Added

- House openings card (`custom:house-openings-card`): status badge, garage
  door and gate tiles that are always shown (closed, open, position in %,
  opening, closing, unknown), open windows and doors with area, tilted
  state and how long they have been open, longest first.
- Zero configuration: window, door, opening and garage door contacts are
  found through the entity registry and areas, rotary handle enum sensors
  through their options, gates as covers with the device class `garage` or
  `gate`. Thermostat window detection, a gate's own end switch and duplicate
  handle contacts are skipped.
- Options `title`, `gates` (with name and icon), `windows`, `areas`,
  `exclude_areas`, `exclude_entities` and `warn_minutes`; visual editor.
- English and German.
