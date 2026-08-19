// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { describe, expect, it } from 'vitest';

import { DbLike, DecomposeChart, recompose } from '../src/recompose.ts';

/** Builds a DbLike backed by a plain { table: { ref: row } } fixture map. */
const fakeDb = (rows: Record<string, Record<string, any>>): DbLike => ({
  readRow: async (table: string, ref: string) => {
    const row = rows[table]?.[ref];
    return { [table]: { _data: row === undefined ? [] : [row] } };
  },
});

describe('recompose', () => {
  it('reconstructs a flat entity from a single block', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'customerId',
      _name: 'Customer',
      general: [
        { origin: 'name', destination: 'name' },
        { origin: 'age', destination: 'age' },
      ],
    };
    const db = fakeDb({
      customerCake: { cakeRef1: { layers: { customerGeneralLayer: 'layerRef1' } } },
      customerGeneralLayer: { layerRef1: { add: { cust1: 'compRef1' } } },
      customerGeneral: { compRef1: { name: 'Alice', age: 30 } },
    });

    const result = await recompose(db, chart, 'cust1', 'customerCake', 'cakeRef1');
    expect(result).toEqual({ customerId: 'cust1', name: 'Alice', age: 30 });
  });

  it('merges nested "/" origin paths into a shared nested object', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'X',
      data: [
        { origin: 'meta/a', destination: 'a' },
        { origin: 'meta/b', destination: 'b' },
      ],
    };
    const db = fakeDb({
      xCake: { c: { layers: { xDataLayer: 'l' } } },
      xDataLayer: { l: { add: { s1: 'comp' } } },
      xData: { comp: { a: 1, b: 2 } },
    });

    const result = await recompose(db, chart, 's1', 'xCake', 'c');
    expect(result).toEqual({ id: 's1', meta: { a: 1, b: 2 } });
  });

  it('skips a block silently when its layer ref is missing from the Cake', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'X',
      general: [{ origin: 'a', destination: 'a' }],
    };
    const db = fakeDb({
      xCake: { c: { layers: {} } }, // no xGeneralLayer entry at all
    });

    const result = await recompose(db, chart, 's1', 'xCake', 'c');
    expect(result).toEqual({ id: 's1' });
  });

  it('skips a block silently when the slice has no component ref in the layer', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'X',
      general: [{ origin: 'a', destination: 'a' }],
    };
    const db = fakeDb({
      xCake: { c: { layers: { xGeneralLayer: 'l' } } },
      xGeneralLayer: { l: { add: {} } }, // no entry for this sliceId
    });

    const result = await recompose(db, chart, 's1', 'xCake', 'c');
    expect(result).toEqual({ id: 's1' });
  });

  it('ignores non-block, non-underscore keys that are not PropertyDef arrays', async () => {
    const chart = {
      _sliceId: 'id',
      _name: 'X',
      general: [{ origin: 'a', destination: 'a' }],
      notABlock: 'nope',
    } as unknown as DecomposeChart;
    const db = fakeDb({
      xCake: { c: { layers: { xGeneralLayer: 'l' } } },
      xGeneralLayer: { l: { add: { s1: 'comp' } } },
      xGeneral: { comp: { a: 1 } },
    });

    const result = await recompose(db, chart, 's1', 'xCake', 'c');
    expect(result).toEqual({ id: 's1', a: 1 });
  });

  it('derives unprefixed table names when the (root) chart has no _name', async () => {
    // componentsName(blockKey, chartName) falls back to plain
    // blockKey.toLowerCase() when chartName is falsy — exercised only via
    // a root chart missing _name (a _types sub-chart can't reach this
    // path, since recompose() already requires _name there).
    const chart: DecomposeChart = {
      _sliceId: 'id',
      general: [{ origin: 'a', destination: 'a' }],
    };
    const db = fakeDb({
      Cake: { c: { layers: { generalLayer: 'l' } } },
      generalLayer: { l: { add: { s1: 'comp' } } },
      general: { comp: { a: 1 } },
    });

    const result = await recompose(db, chart, 's1', 'Cake', 'c');
    expect(result).toEqual({ id: 's1', a: 1 });
  });

  it('recursively reconstructs a _types sub-entity with multiple slice ids', async () => {
    const addressChart: DecomposeChart = {
      _sliceId: 'addressId',
      _name: 'Address',
      _path: 'addresses',
      location: [{ origin: 'street', destination: 'street' }],
    };
    const chart: DecomposeChart = {
      _sliceId: 'customerId',
      _name: 'Customer',
      _types: [addressChart],
    };

    const db = fakeDb({
      customerCake: { cakeRef: { layers: { customerAddresssLayer: 'groupLayerRef' } } },
      customerAddresssLayer: { groupLayerRef: { add: { cust1: 'groupRef' } } },
      customerAddresss: {
        groupRef: { addresss: [{ ref: 'addrCakeRef', sliceIds: ['addr-0', 'addr-1'] }] },
      },
      addressCake: {
        addrCakeRef: { layers: { addressLocationLayer: 'addrLayerRef' } },
      },
      addressLocationLayer: {
        addrLayerRef: { add: { 'addr-0': 'loc0', 'addr-1': 'loc1' } },
      },
      addressLocation: {
        loc0: { street: 'Main St' },
        loc1: { street: 'Second St' },
      },
    });

    const result = await recompose(db, chart, 'cust1', 'customerCake', 'cakeRef');
    expect(result).toEqual({
      customerId: 'cust1',
      addresses: [
        { addressId: 'addr-0', street: 'Main St' },
        { addressId: 'addr-1', street: 'Second St' },
      ],
    });
  });

  it('skips a _types entry missing _path or _name', async () => {
    const chart = {
      _sliceId: 'id',
      _name: 'X',
      _types: [
        { _name: 'NoPath' }, // missing _path
        { _path: 'nope' }, // missing _name
      ],
    } as unknown as DecomposeChart;
    const db = fakeDb({ xCake: { c: { layers: {} } } });

    const result = await recompose(db, chart, 's1', 'xCake', 'c');
    expect(result).toEqual({ id: 's1' });
  });

  it('skips a _types entry when its group layer ref is missing', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'Customer',
      _types: [{ _sliceId: 'addressId', _name: 'Address', _path: 'addresses' }],
    };
    const db = fakeDb({ customerCake: { c: { layers: {} } } });

    const result = await recompose(db, chart, 's1', 'customerCake', 'c');
    expect(result).toEqual({ id: 's1' });
  });

  it('skips a _types entry when the slice has no group ref', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'Customer',
      _types: [{ _sliceId: 'addressId', _name: 'Address', _path: 'addresses' }],
    };
    const db = fakeDb({
      customerCake: { c: { layers: { customerAddresssLayer: 'l' } } },
      customerAddresssLayer: { l: { add: {} } },
    });

    const result = await recompose(db, chart, 's1', 'customerCake', 'c');
    expect(result).toEqual({ id: 's1' });
  });

  it('defaults to an empty array when the group row has no ref column or entries have no sliceIds', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'Customer',
      _types: [{ _sliceId: 'addressId', _name: 'Address', _path: 'addresses' }],
    };
    const db = fakeDb({
      customerCake: { c: { layers: { customerAddresssLayer: 'l' } } },
      customerAddresssLayer: { l: { add: { s1: 'groupRef' } } },
      customerAddresss: { groupRef: {} }, // no "addresss" column at all
    });

    const result = await recompose(db, chart, 's1', 'customerCake', 'c');
    expect(result).toEqual({ id: 's1', addresses: [] });
  });

  it('treats an entry with no sliceIds as contributing nothing', async () => {
    const chart: DecomposeChart = {
      _sliceId: 'id',
      _name: 'Customer',
      _types: [{ _sliceId: 'addressId', _name: 'Address', _path: 'addresses' }],
    };
    const db = fakeDb({
      customerCake: { c: { layers: { customerAddresssLayer: 'l' } } },
      customerAddresssLayer: { l: { add: { s1: 'groupRef' } } },
      customerAddresss: { groupRef: { addresss: [{ ref: 'x' }] } }, // no sliceIds field
    });

    const result = await recompose(db, chart, 's1', 'customerCake', 'c');
    expect(result).toEqual({ id: 's1', addresses: [] });
  });
});
