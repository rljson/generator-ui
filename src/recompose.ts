// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

// Reconstructs the original, nested JSON shape of one sliced entity (e.g.
// one customer) from its Cake. This is the exact inverse of
// @rljson/converter's fromJson(); @rljson/converter itself has no such
// reverse function, so this fills that gap — driven entirely by the same
// DecomposeChart used to create the data.
//
// Unlike a generic tree walk via Controller.getChildRefs() (which has to
// discover table names and content types at runtime, one network
// round-trip at a time), this reads rows directly via Core.readRow() using
// table names *computed* from the chart up front — the chart already tells
// us exactly which tables and columns exist, so there is nothing left to
// discover. Independent reads (the 4 top-level blocks, every nested
// address, every customer) run concurrently instead of one at a time.

export interface DbLike {
  readRow(table: string, ref: string): Promise<Record<string, { _data: any[] }>>;
}

type PropertyDef = { origin: string; destination: string; type?: string };

export type DecomposeChart = {
  _sliceId: string;
  _name?: string;
  _path?: string;
  _types?: DecomposeChart[];
  [blockKey: string]: unknown;
};

// Mirrors @rljson/converter's internal naming convention exactly: a block
// named e.g. "general" on a chart named "Customer" becomes the table/layer
// "customerGeneral"/"customerGeneralLayer".
const componentsName = (blockKey: string, chartName?: string): string =>
  chartName
    ? `${chartName.toLowerCase()}${blockKey.charAt(0).toUpperCase()}${blockKey.slice(1)}`
    : blockKey.toLowerCase();

const cakeTableKeyOf = (chart: DecomposeChart): string =>
  `${(chart._name ?? '').toLowerCase()}Cake`;

// A nested _types entry (e.g. "Address") is stored under a naively
// pluralized components table (observed: "customerAddresss" — chart._name
// + "s", not proper English pluralization) holding a ref-array column
// named after the same pluralized, lowercased _name (observed: "addresss").
const groupTableKeyOf = (subChart: DecomposeChart, parentChart: DecomposeChart): string =>
  componentsName(`${subChart._name}s`, parentChart._name);

const refColumnOf = (subChart: DecomposeChart): string =>
  `${(subChart._name ?? '').toLowerCase()}s`;

const isPropertyDefArray = (value: unknown): value is PropertyDef[] =>
  Array.isArray(value) &&
  value.every(
    (v) => v && typeof v === 'object' && 'origin' in v && 'destination' in v,
  );

const blockKeysOf = (chart: DecomposeChart): string[] =>
  Object.keys(chart).filter(
    (key) => !key.startsWith('_') && isPropertyDefArray(chart[key]),
  );

const setNestedPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void => {
  const keys = path.split('/');
  let node: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const existing = node[keys[i]];
    const child =
      existing && typeof existing === 'object'
        ? (existing as Record<string, unknown>)
        : {};
    node[keys[i]] = child;
    node = child;
  }
  node[keys[keys.length - 1]] = value;
};

const rowOf = async (
  db: DbLike,
  table: string,
  ref: string,
): Promise<any> => {
  const result = await db.readRow(table, ref);
  return result[table]._data[0];
};

/**
 * Reconstructs one sliced entity's original nested JSON, given the ref of
 * its Cake row. `sliceId` selects which slice within that Cake to
 * reconstruct (e.g. one customerId — a Cake can hold many).
 */
export const recompose = async (
  db: DbLike,
  chart: DecomposeChart,
  sliceId: string,
  cakeTableKey: string,
  cakeRef: string,
): Promise<Record<string, unknown>> => {
  const result: Record<string, unknown> = { [chart._sliceId]: sliceId };
  const cakeRow = await rowOf(db, cakeTableKey, cakeRef);
  const layers = cakeRow.layers as Record<string, string>;

  const blockReads = blockKeysOf(chart).map(async (blockKey) => {
    const layerTableKey = `${componentsName(blockKey, chart._name)}Layer`;
    const layerRef = layers[layerTableKey];
    if (!layerRef) return;

    const layerRow = await rowOf(db, layerTableKey, layerRef);
    const componentRef = layerRow.add[sliceId];
    if (!componentRef) return;

    const componentTableKey = componentsName(blockKey, chart._name);
    const componentRow = await rowOf(db, componentTableKey, componentRef);
    for (const def of chart[blockKey] as PropertyDef[]) {
      setNestedPath(result, def.origin, componentRow[def.destination]);
    }
  });

  const typeReads = (chart._types ?? []).map(async (subChart) => {
    if (!subChart._path || !subChart._name) return;

    const groupTableKey = groupTableKeyOf(subChart, chart);
    const layerRef = layers[`${groupTableKey}Layer`];
    if (!layerRef) return;

    const layerRow = await rowOf(db, `${groupTableKey}Layer`, layerRef);
    const groupRef = layerRow.add[sliceId];
    if (!groupRef) return;

    const groupRow = await rowOf(db, groupTableKey, groupRef);
    const entries = (groupRow[refColumnOf(subChart)] ?? []) as {
      ref: string;
      sliceIds: string[];
    }[];
    const nestedCakeTableKey = cakeTableKeyOf(subChart);

    const items = await Promise.all(
      entries.flatMap((entry) =>
        (entry.sliceIds ?? []).map((nestedSliceId) =>
          recompose(db, subChart, nestedSliceId, nestedCakeTableKey, entry.ref),
        ),
      ),
    );
    result[subChart._path] = items;
  });

  await Promise.all([...blockReads, ...typeReads]);
  return result;
};
