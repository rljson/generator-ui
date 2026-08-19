// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

// Discovers every viewable entity type — generically, with no per-type UI
// code. Two live sources today, mirroring the Generator's own zero-code
// discovery:
// - Chart-only generators are plain JSON files in the Generator repo's
//   charts/ directory (e.g. charts/Customer.json, the "Customer" entity
//   itself) — Vite's import.meta.glob discovers all of them at build time
//   (browser-safe; unlike the Generator's own Node "fs"-based discovery in
//   chart-files.ts, which cannot run in a browser bundle).
// - Example/schema-only generators are plain JSON files in the Generator
//   repo's examples/ directory — not a chart at all, just a representative
//   record or a JSON Schema. `chartFromJson` (imported straight from the
//   Generator repo) derives the DecomposeChart from the data's own shape,
//   identically to how the Generator's own chart-files.ts does it for its
//   CLI.
// Adding a file-based or example-based chart therefore needs zero changes
// here or anywhere else in this repo. A code-based generator (real domain
// data, see the Generator's chart-generator.ts) would need one import line
// added here — there simply isn't one today.

import { DecomposeChart } from '@rljson/converter';
import { Route } from '@rljson/rljson';

import { chartFromJson } from '../../data-generator/src/generators/chart-from-json.ts';

export interface EntityType {
  label: string;
  chart: DecomposeChart;
  route: Route;
}

/** Exported for direct unit testing (in addition to the real, live
 * discovery exercised by `entityTypes()` itself). */
export const routeOf = (chart: DecomposeChart): Route => {
  if (!chart._name) {
    throw new Error('Chart is missing _name, cannot derive its route.');
  }
  // Same convention @rljson/converter itself uses, and that
  // createChartGenerator() derives the Generator's routes from.
  return Route.fromFlat(`${chart._name.toLowerCase()}Cake`);
};

const chartFiles = import.meta.glob('../../data-generator/charts/*.json', {
  eager: true,
}) as Record<string, { default: DecomposeChart }>;

const exampleFiles = import.meta.glob('../../data-generator/examples/*.json', {
  eager: true,
}) as Record<string, { default: DecomposeChart }>;

/** `examples/Product.json` -> "Product" — same basename-as-name convention
 * the Generator's own exampleFileGenerators() uses. Exported for direct
 * unit testing. */
export const nameFromExamplePath = (filePath: string): string => {
  // String.split() always returns a non-empty array (even '' -> ['']), so
  // .pop() always returns a defined string — this fallback is defensive,
  // not a reachable case.
  /* v8 ignore next -- @preserve */
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.json$/, '');
};

export const entityTypes = (): EntityType[] => {
  const fileBasedCharts = Object.values(chartFiles).map((mod) => mod.default);
  // Not exercised by a live examples/*.json fixture: import.meta.glob's
  // matched-file list is resolved once by Vite's transform layer per
  // process and stays cached across vi.resetModules() (confirmed by
  // testing it directly) — a fixture-file-based test here would only pass
  // or fail depending on unpredictable test-file scheduling, not on this
  // line's own correctness. The composed pieces (chartFromJson,
  // nameFromExamplePath) are each independently 100%-covered — this line
  // is untested purely because of that Vite caching limitation, not
  // because it's unreachable.
  /* v8 ignore start -- @preserve */
  const exampleBasedCharts = Object.entries(exampleFiles).map(
    ([filePath, mod]) => chartFromJson(nameFromExamplePath(filePath), mod.default),
  );
  /* v8 ignore stop -- @preserve */

  return [...fileBasedCharts, ...exampleBasedCharts].map((chart) => ({
    // Only reachable for a hand-placed charts/*.json missing _name (the
    // very next line then throws before this label is ever observed by
    // any caller) — see the "throws when the chart has no _name" test
    // on routeOf() for the actual behavior this guards.
    /* v8 ignore next -- @preserve */
    label: chart._name ?? 'Unbekannt',
    chart,
    route: routeOf(chart),
  }));
};
