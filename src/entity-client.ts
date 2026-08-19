// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { BsMem } from '@rljson/bs';
import { Db } from '@rljson/db';
import { IoMem } from '@rljson/io';
import { Route } from '@rljson/rljson';
import { Client, SocketIoBridge } from '@rljson/server';
import { io as socketIoClient } from 'socket.io-client';

import { DecomposeChart } from '@rljson/converter';

import { DbLike, recompose } from './recompose.ts';

export const serverUrl = (): string =>
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

export interface ConnectedClient {
  client: Client;
  db: Db;
}

/**
 * Connects as a real @rljson/server sync Client to one specific route —
 * same connection pattern the Generator uses, just read-only: no data is
 * ever written locally or sent to the Server. A Client is single-route
 * (see the Generator's own generate.ts), so viewing several entity types
 * means one connection per route, same as generating them does.
 */
export const connect = async (route: Route): Promise<ConnectedClient> => {
  const localIo = new IoMem();
  await localIo.init();

  const socket = socketIoClient(`${serverUrl()}${route.flat}`);
  const client = new Client(new SocketIoBridge(socket), localIo, new BsMem(), route);
  await client.init();
  await client.ready();

  return { client, db: client.db! };
};

/**
 * Given one Cake's ref, returns the sliceIds it holds — read straight off
 * its own sliceIdsTable/sliceIdsRow, the authoritative "which slices exist
 * here" record every Cake already carries. Two direct reads, no discovery,
 * no Controller involved.
 */
const sliceIdsOfCake = async (
  db: DbLike,
  cakeTableKey: string,
  cakeRef: string,
): Promise<string[]> => {
  const cakeRow = (await db.readRow(cakeTableKey, cakeRef))[cakeTableKey]
    ._data[0];
  const sliceIdsRow = (
    await db.readRow(cakeRow.sliceIdsTable, cakeRow.sliceIdsRow)
  )[cakeRow.sliceIdsTable]._data[0];
  return sliceIdsRow.add as string[];
};

/**
 * Lists every entity of `chart`'s type ever synced to the Server, in its
 * original nested form, across every independent Cake batch — not just
 * the most recently pushed one. Every Cake and every entity within a Cake
 * is fetched concurrently; only look-ups that genuinely depend on each
 * other (e.g. a Layer read before the Component ref it names) run in
 * sequence. Works for any chart — the same function powers every entity
 * type's view, not just customers.
 */
export const listAllEntities = async (
  db: Db,
  chart: DecomposeChart,
  route: Route,
): Promise<Record<string, unknown>[]> => {
  const cakeTableKey = route.top.tableKey;
  const dbLike: DbLike = {
    readRow: (table, ref) => db.core.readRow(table, ref),
  };

  const dump = await db.core.readRows(cakeTableKey, {});
  const cakeRows = (dump[cakeTableKey] as { _data: any[] })._data;

  const perCake = await Promise.all(
    cakeRows.map(async (cakeRow) => {
      const sliceIds = await sliceIdsOfCake(dbLike, cakeTableKey, cakeRow._hash);
      return Promise.all(
        sliceIds.map((sliceId) =>
          recompose(dbLike, chart, sliceId, cakeTableKey, cakeRow._hash),
        ),
      );
    }),
  );
  return perCake.flat();
};
