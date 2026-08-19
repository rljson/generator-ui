// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { Route } from '@rljson/rljson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn().mockResolvedValue(undefined);
const ready = vi.fn().mockResolvedValue(undefined);
const dbInstance = { core: { createTable: vi.fn(), import: vi.fn() } };
const ClientCtor = vi.fn();

vi.mock('@rljson/server', () => ({
  Client: class {
    db = dbInstance;
    constructor(...args: unknown[]) {
      ClientCtor(...args);
    }
    init = init;
    ready = ready;
  },
  SocketIoBridge: class {
    constructor(public socket: unknown) {}
  },
}));

const ioClient = vi.fn((..._args: unknown[]) => ({ id: 'fake-socket' }));
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioClient(...args) }));

const recompose = vi.fn();
vi.mock('../src/recompose.ts', () => ({ recompose: (...args: unknown[]) => recompose(...args) }));

const { serverUrl, connect, listAllEntities } = await import('../src/entity-client.ts');

describe('serverUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to localhost:3000 when VITE_SERVER_URL is unset', () => {
    vi.stubEnv('VITE_SERVER_URL', undefined);
    expect(serverUrl()).toBe('http://localhost:3000');
  });

  it('reads VITE_SERVER_URL from the environment when set', () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://example.com');
    expect(serverUrl()).toBe('https://example.com');
  });
});

describe('connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a read-only Client connection to the given route', async () => {
    const route = Route.fromFlat('/customerCake');
    const { client, db } = await connect(route);

    expect(ioClient).toHaveBeenCalledWith('http://localhost:3000/customerCake');
    expect(ClientCtor).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
    expect(db).toBe(dbInstance);
  });
});

describe('listAllEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads every Cake, every slice within it, and flattens the recomposed results', async () => {
    const route = Route.fromFlat('/customerCake');
    const chart = { _sliceId: 'customerId', _name: 'Customer' } as any;

    const readRow = vi.fn(async (table: string, ref: string) => {
      if (table === 'customerCake') {
        return { customerCake: { _data: [{ sliceIdsTable: 'customerSliceId', sliceIdsRow: `sids-${ref}` }] } };
      }
      if (table === 'customerSliceId') {
        const sliceIds = ref === 'sids-cake1' ? ['c1', 'c2'] : ['c3'];
        return { customerSliceId: { _data: [{ add: sliceIds }] } };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const readRows = vi.fn().mockResolvedValue({
      customerCake: { _data: [{ _hash: 'cake1' }, { _hash: 'cake2' }] },
    });
    const db = { core: { readRow, readRows } } as any;

    recompose.mockImplementation(async (_db, _chart, sliceId) => ({ id: sliceId }));

    const result = await listAllEntities(db, chart, route);

    expect(readRows).toHaveBeenCalledWith('customerCake', {});
    expect(result).toEqual(
      expect.arrayContaining([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]),
    );
    expect(result).toHaveLength(3);
    expect(recompose).toHaveBeenCalledWith(
      expect.objectContaining({ readRow: expect.any(Function) }),
      chart,
      'c1',
      'customerCake',
      'cake1',
    );
  });

  it('returns an empty list when there are no Cake rows at all', async () => {
    const route = Route.fromFlat('/customerCake');
    const chart = { _sliceId: 'customerId', _name: 'Customer' } as any;
    const readRows = vi.fn().mockResolvedValue({ customerCake: { _data: [] } });
    const db = { core: { readRow: vi.fn(), readRows } } as any;

    const result = await listAllEntities(db, chart, route);
    expect(result).toEqual([]);
  });
});
