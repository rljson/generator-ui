<!--
@license
Copyright (c) 2025 Rljson

Use of this source code is governed by terms that can be
found in the LICENSE file in the root of this package.
-->

# @rljson/generator-ui

> New to this workspace? Start at the top-level [README.md](../README.md)
> for the full one-time setup + walkthrough. This document covers
> generator-ui's own details.

Example browser UI. Connects to a running **`@rljson/server`** instance as
a real, read-only sync `Client` and renders a table for **every** entity
type it can find — not just one hardcoded type. No writes, no direct
database access; everything goes through the official sync protocol, the
same as the [generator](../data-generator) repo.

## How it fits together

```
generator-ui (this repo)  --Socket.IO-->  Server  --readRow-->  MSSQL
      Client (one connection per route, in parallel)
```

- One `Client` connection **per entity type's route** — a Client/Server
  pair is single-route (see `@rljson/server`'s constructors), same
  constraint the Generator works under. All connections run concurrently.
- [`src/recompose.ts`](src/recompose.ts) reconstructs each entity's
  original nested JSON straight from its Cake, driven entirely by that
  entity's `DecomposeChart` — no per-entity-type code, no Controller
  discovery, just direct `Db.core.readRow()` calls computed from the
  chart's own structure (see the file's comments for why this is faster
  than a generic tree walk).
- The table itself is generic too: columns are whatever keys the
  recomposed entity has, and each cell renders its value recursively —
  nested objects become their own key/value table, nested arrays of
  objects become their own nested table (own columns, derived the same
  way), and arrays of plain values become a bullet list. There's no
  per-entity-type or per-depth rendering code; the same rules just apply
  again at every level (see [Inspecting a single
  entity](#inspecting-a-single-entity) for the raw, unrendered form).

## Prerequisites

- A running `@rljson/server` instance reachable at `VITE_SERVER_URL`,
  hosting (via `RLJSON_ROUTES`) the route of every entity type you want to
  see here.
- Data already synced for at least one entity type (see the Generator
  repo) — an entity type with zero rows just renders "Keine Daten
  gefunden."

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Purpose |
|---|---|
| `VITE_SERVER_URL` | URL of the running Server (default `http://localhost:3000`) |

Routes are **not** configured here — each entity type's route is derived
automatically from its chart (`` `${chart._name.toLowerCase()}Cake` ``,
the same convention the Generator's `createChartGenerator()` uses). Only
`VITE_`-prefixed env vars are visible to browser code at all (a Vite
constraint), which is one more reason routes live in code/chart data
instead.

## Running

```bash
npm run dev
```

Opens a Vite dev server (default `http://localhost:5173`). The page
connects to every discovered entity type's route concurrently and renders
one table per type as its data arrives — one slow or unreachable route
(e.g. one the Server isn't hosting) shows an error in its own section
after a 10s timeout, without blocking the others.

`npm run build` / `npm run preview` produce and serve a static production
build, same as any Vite app.

## How entity types are discovered

[`src/entity-types.ts`](src/entity-types.ts) mirrors the Generator's own
ways of registering a data type — deliberately, so nothing here needs
inventing when the Generator gains a new one:

- **File-based charts** (`data-generator/charts/*.json` — this is how
  "Customer" itself is registered): discovered automatically via Vite's
  `import.meta.glob()` at build time. Adding one there needs **no change
  in this repo** — reload the page and it appears. (The Generator's own
  discovery in `chart-files.ts` uses Node's `fs` module, which can't run
  in a browser bundle — `import.meta.glob` is the browser-safe
  equivalent, resolved by Vite instead of at runtime.)
- **Example/schema-based charts** (`data-generator/examples/*.json`): also
  discovered automatically, no change needed here either — but these files
  are a plain example record or a JSON Schema, not a chart. They're run
  through the Generator's own `chartFromJson()` (imported straight from the
  Generator repo) to derive the `DecomposeChart` from the data's own
  shape, exactly as the Generator's CLI does for its own `examples/`
  discovery — see the Generator's README for what `chartFromJson()` does
  and doesn't understand.
- **Code-based charts** (real domain data instead of mechanical
  placeholders — there isn't one today): would be imported explicitly,
  one line per chart, in `entity-types.ts` when the Generator gains a
  code-based generator (see the Generator's `chart-generator.ts`).

Either way, an entity type only actually shows data once the **Server**
hosts its route (`RLJSON_ROUTES`) and at least one record has been synced.

## Inspecting a single entity

The table view flattens nested data into summaries. To see one entity's
full "Ursprungsform" (original nested shape, exactly as
`@rljson/converter`'s `fromJson()` would have received it), open the
browser devtools console after the page loads:

```js
window.__entities['Customer'][0]   // or any label shown in the page
```

## Known limitations

- No pagination — every entity of every type is loaded and rendered in
  one page load. Fine for demo-scale data, not for production volumes.
- Nested tables/lists can make wide, deeply-nested entities (many
  addresses, each with many fields) push a section quite wide — there's no
  collapse/expand toggle yet, everything renders open.
