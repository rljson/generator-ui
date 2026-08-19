// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entityTypes = vi.fn();
vi.mock('../src/entity-types.ts', () => ({ entityTypes: (...args: unknown[]) => entityTypes(...args) }));

const connect = vi.fn();
const listAllEntities = vi.fn();
vi.mock('../src/entity-client.ts', () => ({
  connect: (...args: unknown[]) => connect(...args),
  listAllEntities: (...args: unknown[]) => listAllEntities(...args),
}));

const setupDom = () => {
  document.body.innerHTML = '<p id="status">Verbinde…</p><div id="app"></div>';
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeType = (label: string, route = { flat: `/${label.toLowerCase()}Cake`, top: { tableKey: `${label}Cake` } }) => ({
  label,
  chart: { _sliceId: 'id', _name: label },
  route,
});

describe('main.ts', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupDom();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('renders a full table for a successful entity type with every value shape', async () => {
    const type = fakeType('Widget');
    entityTypes.mockReturnValue([type]);
    connect.mockResolvedValue({ client: { tearDown: vi.fn().mockResolvedValue(undefined) }, db: {} });
    listAllEntities.mockResolvedValue([
      {
        id: '1',
        text: 'hello',
        n: null,
        u: undefined,
        emptyArr: [],
        emptyObj: {},
        tags: ['a', 'b'],
        addresses: [{ street: 'Main St' }, { street: 'Second St' }],
        meta: { a: 1, b: 2 },
      },
    ]);

    await import('../src/main.ts');
    await flush();

    const app = document.querySelector('#app')!;
    expect(app.querySelector('h2')!.textContent).toBe('Widget (1)');

    const table = app.querySelector('table')! as HTMLTableElement;
    const headers = [...table.tHead!.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual([
      'id', 'text', 'n', 'u', 'emptyArr', 'emptyObj', 'tags', 'addresses', 'meta',
    ]);

    const cells = [...table.querySelectorAll('tbody > tr')[0].children];
    // null/undefined -> empty text
    expect(cells[2].textContent).toBe('');
    expect(cells[3].textContent).toBe('');
    // empty array -> "[]" marker, not marked as a nested (clipped) cell
    expect(cells[4].querySelector('.empty-value')!.textContent).toBe('[]');
    expect(cells[4].classList.contains('cell-nested')).toBe(false);
    // empty object -> "{}" marker
    expect(cells[5].querySelector('.empty-value')!.textContent).toBe('{}');
    // array of plain scalars -> bullet list
    const ul = cells[6].querySelector('ul.nested-list')!;
    expect([...ul.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    expect(cells[6].classList.contains('cell-nested')).toBe(true);
    // array of plain objects -> nested table with its own columns
    const nestedTable = cells[7].querySelector('table')!;
    expect([...nestedTable.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['street']);
    expect(nestedTable.querySelectorAll('tbody > tr')).toHaveLength(2);
    // plain object -> nested key/value table
    const metaTable = cells[8].querySelector('table.nested-table')!;
    const metaRows = [...metaTable.querySelectorAll('tbody > tr')].map((tr) => [
      tr.querySelector('th')!.textContent,
      tr.querySelector('td')!.textContent,
    ]);
    expect(metaRows).toEqual([['a', '1'], ['b', '2']]);

    const status = document.querySelector('#status')!;
    expect(status.textContent).toBe('1 Datentyp(en), 1 Eintrag(einträge) insgesamt geladen.');
    expect((window as any).__entities.Widget).toEqual(await listAllEntities.mock.results[0].value);
  });

  it('shows "Keine Daten gefunden." for an entity type with zero rows', async () => {
    const type = fakeType('Widget');
    entityTypes.mockReturnValue([type]);
    connect.mockResolvedValue({ client: { tearDown: vi.fn().mockResolvedValue(undefined) }, db: {} });
    listAllEntities.mockResolvedValue([]);

    await import('../src/main.ts');
    await flush();

    const app = document.querySelector('#app')!;
    expect(app.querySelector('h2')!.textContent).toBe('Widget (0)');
    expect(app.querySelector('.section-status')!.textContent).toBe('Keine Daten gefunden.');
  });

  it('renders a per-type error section without blocking other types, and tears down the client', async () => {
    const good = fakeType('Good');
    const bad = fakeType('Bad');
    entityTypes.mockReturnValue([good, bad]);

    const tearDownGood = vi.fn().mockResolvedValue(undefined);
    connect.mockImplementation(async (route: { flat: string }) =>
      route.flat === '/goodCake'
        ? { client: { tearDown: tearDownGood }, db: {} }
        : Promise.reject(new Error('connection refused')),
    );
    listAllEntities.mockResolvedValue([{ id: '1' }]);

    await import('../src/main.ts');
    await flush();

    const sections = [...document.querySelectorAll('#app section')];
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector('h2')!.textContent).toBe('Good (1)');
    expect(sections[1].querySelector('h2')!.textContent).toBe('Bad — Fehler');
    expect(sections[1].querySelector('.section-error')!.textContent).toBe('connection refused');
    expect(tearDownGood).toHaveBeenCalledTimes(1);
    expect((window as any).__entities.Bad).toEqual({ error: 'connection refused' });
  });

  it('wraps a non-Error rejection as its String() form', async () => {
    const type = fakeType('Bad');
    entityTypes.mockReturnValue([type]);
    connect.mockRejectedValue('plain string failure');

    await import('../src/main.ts');
    await flush();

    expect(document.querySelector('.section-error')!.textContent).toBe('plain string failure');
  });

  it('tears down (and silently swallows a failure from) a connection that only resolves after the timeout already gave up', async () => {
    vi.useFakeTimers();
    const type = fakeType('Slow');
    entityTypes.mockReturnValue([type]);

    // Rejecting here (rather than resolving) exercises the fire-and-forget
    // `.catch(() => {})` guard on this late tearDown — its failure must
    // never surface anywhere (no unhandled rejection, no effect on the UI).
    const tearDown = vi.fn().mockRejectedValue(new Error('teardown failed'));
    let resolveConnect!: (v: any) => void;
    connect.mockReturnValue(new Promise((resolve) => { resolveConnect = resolve; }));

    const importPromise = import('../src/main.ts');
    await vi.advanceTimersByTimeAsync(10_000);
    // The timeout has now rejected the race; resolving connect() late must
    // still attempt to tear the (now-unused) client down instead of
    // leaking it.
    resolveConnect({ client: { tearDown }, db: {} });
    await importPromise;
    await vi.waitFor(() => expect(tearDown).toHaveBeenCalledTimes(1));

    expect(document.querySelector('.section-error')!.textContent).toBe('Zeitüberschreitung nach 10000ms');
  });

  it('does not tear down a connection that resolves before the timeout, even after settling', async () => {
    vi.useFakeTimers();
    const type = fakeType('Fast');
    entityTypes.mockReturnValue([type]);
    const tearDown = vi.fn().mockResolvedValue(undefined);
    connect.mockResolvedValue({ client: { tearDown }, db: {} });
    listAllEntities.mockResolvedValue([]);

    await import('../src/main.ts');
    await vi.runAllTimersAsync();

    // tearDown is called exactly once, via the normal finally{} path — not
    // a second time via the "resolved late" cleanup branch.
    expect(tearDown).toHaveBeenCalledTimes(1);
  });

  it('logs and shows a top-level error when entityTypes() itself throws', async () => {
    entityTypes.mockImplementation(() => {
      throw new Error('boom');
    });

    await import('../src/main.ts');
    await flush();

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(document.querySelector('#status')!.textContent).toBe('Fehler: boom');
  });

  it('wraps a top-level non-Error rejection as its String() form', async () => {
    entityTypes.mockImplementation(() => {
      throw 'boom-string';
    });

    await import('../src/main.ts');
    await flush();

    expect(errorSpy).toHaveBeenCalledWith('boom-string');
    expect(document.querySelector('#status')!.textContent).toBe('Fehler: boom-string');
  });
});
