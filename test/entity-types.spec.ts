// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { DecomposeChart } from '@rljson/converter';
import { describe, expect, it } from 'vitest';

import { entityTypes, nameFromExamplePath, routeOf } from '../src/entity-types.ts';

describe('routeOf', () => {
  it('derives a "<name>Cake" route from the chart name', () => {
    const chart: DecomposeChart = { _sliceId: 'id', _name: 'Widget', general: [] };
    expect(routeOf(chart).flat).toBe('/widgetCake');
  });

  it('throws when the chart has no _name', () => {
    expect(() => routeOf({ _sliceId: 'id' } as DecomposeChart)).toThrow(
      /Chart is missing _name/,
    );
  });
});

describe('nameFromExamplePath', () => {
  it('strips the directory and .json extension', () => {
    expect(nameFromExamplePath('../../data-generator/examples/Product.json')).toBe('Product');
  });

  it('handles a bare filename with no directory', () => {
    expect(nameFromExamplePath('Product.json')).toBe('Product');
  });
});

describe('entityTypes (real, live discovery)', () => {
  it('includes Customer, discovered from the real charts/Customer.json file', () => {
    // Real cross-repo discovery against the sibling data-generator repo's
    // actual charts/Customer.json (examples/ is empty today) — see
    // entity-types.ts's own doc comment for why file-based/example-based
    // discovery needs no test-specific mocking: it's the same real glob
    // Vite resolves for the app itself.
    const types = entityTypes();
    const customer = types.find((t) => t.label === 'Customer');
    expect(customer).toBeDefined();
    expect(customer!.route.flat).toBe('/customerCake');
  });
});
