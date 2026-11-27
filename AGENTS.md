# AGENTS.md – ha-house-openings-card

Dashboard card that shows open windows and doors and keeps garage doors and
gates in view, distributed through HACS as a **Dashboard** (plugin) repository.
Sister project of ha-house-climate-card; same rules.

## Working agreement

- Work on a feature branch. Commit locally, never push. Push, tags on remotes
  and GitHub releases only on explicit request.
- Commit as the agent with the attribution trailers the session provides.
- Release = two commits: the change, then `vX.Y.Z -- <summary>` that bumps
  `VERSION` in `dist/house-openings-card.js` and moves the CHANGELOG entry from
  *Unreleased* to the new version. Annotated tag `vX.Y.Z` locally.
  The release workflow refuses a tag that does not match `VERSION`.
- Semver: feature = minor, fix = patch.
- TDD: every bug gets a regression test that fails on the old code (check it).
- Never claim "tested in Home Assistant" when only the node tests and a
  mocked browser ran.

## Project structure

```
dist/house-openings-card.js  the card (single file, no build step, no deps)
tests/card.test.mjs          node tests (vm + minimal DOM stub)
hacs.json                    HACS metadata (filename, min. HA version)
.github/workflows/           validate.yml (HACS, syntax, tests), release.yml
docs/                        preview.html + render-previews.sh -> README images
README.md, CHANGELOG.md, LICENSE
```

## Card rules

- Whole file in `(function () { … })();`, syntax ≤ ES2019 (no `?.`, `??`,
  logical assignment, `.at()`, `replaceAll`, `replaceChildren`, `#private`,
  regex lookbehind).
- Every `color-mix()` has a plain fallback declaration directly before it;
  no flex/grid `gap`, no `inset`.
- Registration guarded (`customElements.get`, `window.customCards` by type).
- Render errors are caught and shown in the card (`_safeUpdate`).
- DOM built with `createElement`; names only via `textContent`.
- Contacts are found via `hass.entities` + `hass.devices` areas and the
  state's `device_class` (or enum `options` with "tilted"), never by entity
  ID patterns. Diagnostic and hidden entities are skipped. Devices with a
  `climate` entity and the device of a shown gate are skipped. Zero config
  must keep working.
- Gates: covers with device_class `garage`/`gate`; `current_position` wins
  over the state; unknown/unavailable never counts as open.
- All logic (`analyse`, `discoverContacts`, `contactState`, `gateState`,
  `duration`, `shortName`) is DOM-free and exported through the test hook.
- No silent empty card: without contacts and gates the card shows a hint.
- Editor: load `ha-form` via `loadCardHelpers()` before use; it drops empty
  values and the default `warn_minutes`, and keeps `{ entity, name, icon }`
  gate entries from YAML.

## Tests

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --test tests/*.mjs
```

Visual check: `docs/preview.html` with mocked `ha-card`/`ha-icon`, light and
dark, section and phone width (launch entry `house-openings-preview`, port 8773).
