// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { entityTypes, EntityType } from './entity-types.ts';
import { connect, listAllEntities } from './entity-client.ts';

const CONNECT_TIMEOUT_MS = 10_000;

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const appEl = document.querySelector<HTMLDivElement>('#app')!;

/**
 * No per-type rendering logic: every column, and every nested value inside
 * it, is derived purely from the data's own shape.
 *
 * - primitives / null / undefined  -> plain text
 * - array of objects               -> nested table (own columns, recursive)
 * - array of primitives            -> bullet list
 * - object                         -> nested key/value table (recursive)
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Union of keys across all rows, so heterogeneous nested objects still get
 * one consistent column set instead of only the first row's keys. */
const columnsOf = (rows: Record<string, unknown>[]): string[] => {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
};

const renderValue = (value: unknown): Node => {
  if (value === null || value === undefined) {
    return document.createTextNode('');
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      const span = document.createElement('span');
      span.className = 'empty-value';
      span.textContent = '[]';
      return span;
    }
    if (value.every(isPlainObject)) {
      return renderTable(value as Record<string, unknown>[]);
    }
    const ul = document.createElement('ul');
    ul.className = 'nested-list';
    for (const item of value) {
      const li = document.createElement('li');
      li.appendChild(renderValue(item));
      ul.appendChild(li);
    }
    return ul;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      const span = document.createElement('span');
      span.className = 'empty-value';
      span.textContent = '{}';
      return span;
    }
    const table = document.createElement('table');
    table.className = 'nested-table';
    const tbody = document.createElement('tbody');
    for (const [key, val] of entries) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = key;
      const td = document.createElement('td');
      appendCellContent(td, val);
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  return document.createTextNode(String(value));
};

/** Fills one <td> with a value, marking it as "nested" (no clipping) unless
 * the value is a plain scalar that should keep the default truncating cell
 * style. */
const appendCellContent = (td: HTMLTableCellElement, value: unknown): void => {
  const isNested =
    (Array.isArray(value) && value.length > 0) ||
    (isPlainObject(value) && Object.keys(value).length > 0);
  if (isNested) td.classList.add('cell-nested');
  td.appendChild(renderValue(value));
};

const renderTable = (entities: Record<string, unknown>[]): HTMLTableElement => {
  const columns = columnsOf(entities);
  const table = document.createElement('table');

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entity of entities) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      appendCellContent(td, entity[col]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
};

const renderSection = (
  type: EntityType,
  outcome: { entities: Record<string, unknown>[] } | { error: string },
): HTMLElement => {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent =
    'entities' in outcome
      ? `${type.label} (${outcome.entities.length})`
      : `${type.label} — Fehler`;
  section.appendChild(h2);

  if ('error' in outcome) {
    const p = document.createElement('p');
    p.className = 'section-error';
    p.textContent = outcome.error;
    section.appendChild(p);
  } else if (outcome.entities.length === 0) {
    const p = document.createElement('p');
    p.className = 'section-status';
    p.textContent = 'Keine Daten gefunden.';
    section.appendChild(p);
  } else {
    section.appendChild(renderTable(outcome.entities));
  }

  return section;
};

/**
 * Loads one entity type end to end: connect on its own route, list every
 * entity, tear down. Failures (e.g. a chart whose route the Server hasn't
 * been told to host) are caught per type, so one broken type never blocks
 * the others from rendering. If connect() only resolves after the timeout
 * already gave up, it's torn down as soon as it does arrive instead of
 * leaking an open socket.
 */
const loadEntityType = async (
  type: EntityType,
): Promise<{ entities: Record<string, unknown>[] } | { error: string }> => {
  let timedOut = false;
  const connectPromise = connect(type.route);
  connectPromise
    .then(({ client }) => {
      if (timedOut) client.tearDown().catch(() => {});
    })
    .catch(() => {});

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error(`Zeitüberschreitung nach ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
  });

  try {
    const { client, db } = await Promise.race([connectPromise, timeout]);
    try {
      const entities = await listAllEntities(db, type.chart, type.route);
      return { entities };
    } finally {
      await client.tearDown();
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

const run = async (): Promise<void> => {
  const types = entityTypes();
  statusEl.textContent = `Verbinde mit ${types.length} Datentyp(en)…`;

  const outcomes = await Promise.all(types.map(loadEntityType));

  appEl.innerHTML = '';
  for (let i = 0; i < types.length; i++) {
    appEl.appendChild(renderSection(types[i], outcomes[i]));
  }

  const total = outcomes.reduce(
    (sum, o) => sum + ('entities' in o ? o.entities.length : 0),
    0,
  );
  statusEl.textContent = `${types.length} Datentyp(en), ${total} Eintrag(einträge) insgesamt geladen.`;

  // Exposed on window for quick inspection in devtools, keyed by label.
  (window as any).__entities = Object.fromEntries(
    types.map((type, i) => {
      const outcome = outcomes[i];
      return [type.label, 'entities' in outcome ? outcome.entities : outcome];
    }),
  );
};

run().catch((err) => {
  console.error(err);
  statusEl.textContent = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
});
