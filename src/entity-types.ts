// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

// Discovers every viewable entity type — generically, with no per-type UI
// code. Three sources, mirroring the Generator's own three ways to add a
// data type:
// - Code-based generators export their DecomposeChart directly (customers
//   is the only one today) — import it explicitly, one line per generator.
// - Chart-only generators are plain JSON files in the Generator repo's
//   charts/ directory — Vite's import.meta.glob discovers all of them at
//   build time (browser-safe; unlike the Generator's own Node "fs"-based
//   discovery in chart-files.ts, which cannot run in a browser bundle).
// - Example/schema-only generators are plain JSON files in the Generator
//   repo's examples/ directory — not a chart at all, just a representative
//   record or a JSON Schema. `chartFromJson` (imported straight from the
//   Generator repo, same cross-repo pattern as `customerChart` below)
//   derives the DecomposeChart from the data's own shape, identically to
//   how the Generator's own chart-files.ts does it for its CLI.
// Adding a *file-based* or *example-based* chart therefore needs zero
// changes here or anywhere else in this repo.

import { DecomposeChart } from '@rljson/converter';
import { Route } from '@rljson/rljson';

import { chartFromJson } from '../../data-generator/src/generators/chart-from-json.ts';
import { customerChart } from '../../data-generator/src/generators/customers.ts';

export interface EntityType {
  label: string;
  chart: DecomposeChart;
  route: Route;
}

const routeOf = (chart: DecomposeChart): Route => {
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
 * the Generator's own exampleFileGenerators() uses. */
const nameFromExamplePath = (filePath: string): string => {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.json$/, '');
};

export const entityTypes = (): EntityType[] => {
  const codeBasedCharts: DecomposeChart[] = [customerChart];
  const fileBasedCharts = Object.values(chartFiles).map((mod) => mod.default);
  const exampleBasedCharts = Object.entries(exampleFiles).map(
    ([filePath, mod]) => chartFromJson(nameFromExamplePath(filePath), mod.default),
  );

  return [...codeBasedCharts, ...fileBasedCharts, ...exampleBasedCharts].map(
    (chart) => ({
      label: chart._name ?? 'Unbekannt',
      chart,
      route: routeOf(chart),
    }),
  );
};
