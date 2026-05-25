// =============================================================================
// Mock Supabase client for demo mode
// -----------------------------------------------------------------------------
// Returns a chainable query builder that mimics the @supabase/supabase-js
// PostgREST builder closely enough for this app's read paths, but resolves
// entirely from local fixtures (./fixtures.ts). NOTHING touches the network,
// so the demo works with the database paused and no env keys set.
//
// Supported chain: .from(table).select(cols, opts).eq/.in/.not/.is/.gt/.gte
//   /.lt/.lte/.order/.limit/.range/.single/.maybeSingle, and awaiting the
//   builder. Write methods (.insert/.update/.upsert/.delete) are no-ops that
//   resolve successfully — demo mode is read-only.
// =============================================================================

import { TABLE_DATA } from "./fixtures";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

class MockQueryBuilder<T = Row> implements PromiseLike<{ data: T; count: number | null; error: null }> {
  private table: string;
  private filters: Filter[] = [];
  private orderKey: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private wantSingle = false;
  private headOnly = false;
  private wantCount = false;
  private isWrite = false;

  constructor(table: string) {
    this.table = table;
  }

  // ── column selection ──────────────────────────────────────────────────────
  select(_cols?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  // ── filters ─────────────────────────────────────────────────────────────--
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  gt(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) > (val as number));
    return this;
  }
  gte(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) >= (val as number));
    return this;
  }
  lt(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) < (val as number));
    return this;
  }
  lte(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) <= (val as number));
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op === "is" && val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    } else if (op === "in") {
      const set = new Set(val as unknown[]);
      this.filters.push((r) => !set.has(r[col]));
    } else {
      this.filters.push((r) => r[col] !== val);
    }
    return this;
  }
  // accept (but ignore details of) text search / contains style helpers
  ilike() {
    return this;
  }
  like() {
    return this;
  }
  contains() {
    return this;
  }
  filter() {
    return this;
  }

  // ── ordering / pagination ──────────────────────────────────────────────────
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderKey = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantSingle = true;
    return this;
  }

  // ── writes (no-op in demo) ──────────────────────────────────────────────────
  insert(payload?: unknown) {
    this.isWrite = true;
    return this.makeWriteResult(payload);
  }
  update(payload?: unknown) {
    this.isWrite = true;
    return this.makeWriteResult(payload);
  }
  upsert(payload?: unknown) {
    this.isWrite = true;
    return this.makeWriteResult(payload);
  }
  delete() {
    this.isWrite = true;
    return this.makeWriteResult(null);
  }

  private makeWriteResult(payload: unknown) {
    // Writes are still chainable (.eq/.select) but resolve to success no-ops.
    const self = this;
    const passthrough = {
      eq: () => passthrough,
      in: () => passthrough,
      neq: () => passthrough,
      match: () => passthrough,
      select: () => passthrough,
      single: () => passthrough,
      maybeSingle: () => passthrough,
      then<R1 = unknown, R2 = never>(
        onFulfilled?: ((v: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
        onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
      ): PromiseLike<R1 | R2> {
        void self.isWrite;
        return Promise.resolve({ data: payload ?? null, error: null }).then(onFulfilled, onRejected);
      },
    };
    return passthrough;
  }

  // ── resolution ─────────────────────────────────────────────────────────────
  private resolve(): { data: T; count: number | null; error: null } {
    let rows = (TABLE_DATA[this.table] ?? []).slice() as Row[];
    for (const f of this.filters) rows = rows.filter(f);

    const total = rows.length;

    if (this.orderKey) {
      const key = this.orderKey;
      rows.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return this.orderAsc ? -1 : 1;
        if (bv == null) return this.orderAsc ? 1 : -1;
        if (av < bv) return this.orderAsc ? -1 : 1;
        if (av > bv) return this.orderAsc ? 1 : -1;
        return 0;
      });
    }

    if (this.rangeFrom != null && this.rangeTo != null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);

    if (this.headOnly) {
      return { data: null as unknown as T, count: this.wantCount ? total : null, error: null };
    }
    if (this.wantSingle) {
      return {
        data: (rows[0] ?? null) as unknown as T,
        count: this.wantCount ? total : null,
        error: null,
      };
    }
    return {
      data: rows as unknown as T,
      count: this.wantCount ? total : null,
      error: null,
    };
  }

  then<R1 = unknown, R2 = never>(
    onFulfilled?:
      | ((v: { data: T; count: number | null; error: null }) => R1 | PromiseLike<R1>)
      | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
}

export function createMockSupabaseClient() {
  return {
    from(table: string) {
      return new MockQueryBuilder(table);
    },
    // Minimal auth/realtime stubs in case anything probes them.
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    channel() {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
        unsubscribe: () => {},
      };
      return ch;
    },
    removeChannel() {},
  };
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;
