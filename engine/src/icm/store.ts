/**
 * The storage port.
 *
 * Deliberately synchronous. The ledger subtracts from a balance, writes a hold, and later settles it; doing that
 * across `await` points invites two calls reading the same balance and both deciding it is enough. Synchronous
 * means a balance change is one JavaScript tick and cannot interleave.
 *
 * What that asks of an adapter: **keep the working set in memory and persist write-through.** That is what the host
 * repository's own store does, and a Postgres adapter is a `Map` plus an `onSave` that writes the row. The
 * consequence to be honest about: one process owns the ledger. Two processes serving the same accounts would each
 * hold their own copy of a balance and both would be wrong. Scale by sharding accounts across processes, or by
 * putting the balance behind a single writer, not by running two of these.
 */
import type { Account, ApiKey, Charge, Deposit } from "./types.ts";

export const COLLECTIONS = ["icm_accounts", "icm_keys", "icm_deposits", "icm_charges"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export interface Row {
  id: string;
}

export interface Store {
  get<T extends Row>(collection: CollectionName, id: string): T | undefined;
  /** Insert or replace by `rec.id`, then persist. */
  save<T extends Row>(collection: CollectionName, rec: T): T;
  all<T extends Row>(collection: CollectionName): T[];
  filter<T extends Row>(collection: CollectionName, predicate: (rec: T) => boolean): T[];
  find<T extends Row>(collection: CollectionName, predicate: (rec: T) => boolean): T | undefined;
  count(collection: CollectionName, predicate?: (rec: never) => boolean): number;
  delete(collection: CollectionName, id: string): void;
}

/** Typed shorthands, so call sites do not repeat the collection name and the type together. */
export interface Tables {
  accounts: Account[];
  keys: ApiKey[];
  deposits: Deposit[];
  charges: Charge[];
}

/** Everything in memory, nothing persisted. Tests, demos, and a local stack without a database. */
export class MemoryStore implements Store {
  private readonly maps = new Map<CollectionName, Map<string, Row>>();

  private map(collection: CollectionName): Map<string, Row> {
    let m = this.maps.get(collection);
    if (!m) { m = new Map(); this.maps.set(collection, m); }
    return m;
  }

  get<T extends Row>(collection: CollectionName, id: string): T | undefined {
    return this.map(collection).get(id) as T | undefined;
  }
  save<T extends Row>(collection: CollectionName, rec: T): T {
    this.map(collection).set(rec.id, rec);
    return rec;
  }
  all<T extends Row>(collection: CollectionName): T[] {
    return [...this.map(collection).values()] as T[];
  }
  filter<T extends Row>(collection: CollectionName, predicate: (rec: T) => boolean): T[] {
    return this.all<T>(collection).filter(predicate);
  }
  find<T extends Row>(collection: CollectionName, predicate: (rec: T) => boolean): T | undefined {
    for (const r of this.map(collection).values()) if (predicate(r as T)) return r as T;
    return undefined;
  }
  count(collection: CollectionName, predicate?: (rec: never) => boolean): number {
    if (!predicate) return this.map(collection).size;
    return this.all(collection).filter(predicate as (r: Row) => boolean).length;
  }
  delete(collection: CollectionName, id: string): void {
    this.map(collection).delete(id);
  }
}
