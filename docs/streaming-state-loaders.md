# Streaming State Loaders

A pattern for loading complex async state from multiple sources and streaming
it incrementally to a view — without promises, without reducers, without loading
flags scattered across components.

---

## The core idea

A **streaming state loader** is a plain function that returns `Observable<TState>`.
It emits the state object as it builds — partial state first, then progressively
more complete state as each data source resolves — and completes when all sources
are done (or when a deadline cuts it).

```
loader():   ──{partial}──{partial}──{final}──|
                 ↓           ↓         ↓
view:        spinner    spinner+data  report
```

The view doesn't manage loading flags or async state machines. It reads
`loaderState.complete` to know when loading is done, and renders whatever
partial data is already available in `loaderState.data` in the meantime.

This is different from:

- **Promises** — no partial state, can't compose incrementally
- **Single-shot observables** — you can, but they miss the streaming benefit
- **State machines in components** — duplicates the composition RxJS already gives you

---

## The loader contract

Every loader is a pure function returning `Observable<TState>`:

```ts
export function createLoader(input: SomeInput): Observable<MyState> {
  return someSource$.pipe(
    // one comment per operator — why it's here, not what it does
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

### Rules

**1. Pure function.** No side effects at call time. No React, no hooks, no
global mutations. The observable is cold — nothing starts until subscription.

**2. One comment per operator.** Each operator in the pipeline gets a short
one-line comment explaining _why_ it's there. Not what it does (the operator
name says that) — why it's needed at this point in the pipeline.

```ts
// ✅ why
defined(),   // skip undefined (cache miss) before the timeout starts
first(),     // take first cached value and complete — don't wait for updates

// ❌ what (obvious from the code)
defined(),   // filter undefined values
first(),     // take first value
```

**3. Compose operators, not giant `switchMap` bodies.** If a pipeline step is
reusable or has more than 3–4 inner operators, extract it as a named operator
function. The goal is a pipeline where each line is one clear step.

```ts
// ✅ composed
source$.pipe(
  map((event) => getRelaysFromList(event)), // extract relay URLs from event
  relayStatusCheck(),                        // fan out verdict per URL
)

// ❌ one giant switchMap
source$.pipe(
  switchMap((event) => {
    const urls = getRelaysFromList(event);
    return combineLatest(
      urls.map((url) => relayVerdict(url).pipe(startWith(null)))
    ).pipe(
      map((verdicts) => ({ urls, verdicts: ... }))
    );
  })
)
```

**4. Errors map inward — never propagate.** Use `catchError` to turn errors
into null/empty state at each failure boundary. The loader must never error
to the subscriber — an errored observable stops the view permanently.

```ts
someAsyncSource$.pipe(
  catchError(() => of(null)), // map fetch errors to null — keep the stream alive
);
```

**5. `shareReplay(1)` last.** Prevents the loader from re-executing when
multiple subscribers attach (e.g. the view + StrictMode double-invoke). Late
subscribers receive the last emitted state immediately.

---

## RxJS Pipeline Documentation Standard

When documenting a loader pipeline, follow a consistent "section -> step ->
operator" structure so readers can scan from high-level intent down to
per-operator rationale.

### 1) File-level header (what this loader does)

At the top of the file, add a short block comment describing:

- which event kinds or resources are fetched,
- ordered source priority (primary, fallback, defaults),
- whether state streams incrementally or single-shot,
- where deadline/completion wrapping happens (loader vs page).

### 2) Section dividers (where to look)

Split the loader file into small labeled sections:

- constants,
- state types,
- helpers,
- loader body.

Use simple divider comments so maintainers can quickly navigate large loaders.

### 3) Step comments before major streams (why each phase exists)

Inside `createLoader()`, annotate each major phase with `Step N` comments:

- resolving prerequisite input (relay list, profile, etc.),
- fetching primary data,
- accumulating/deriving final state.

Each step comment should explain intent and dependency order, not implementation
details.

### 4) Operator comments in every non-trivial pipe (why this operator)

For each non-obvious operator in a pipeline, add a one-line "why" comment
immediately above it. Keep comments short and mechanical:

- deadline guards (`timeout`, `takeUntil`),
- fallback behavior (`catchError`),
- compatibility shims (`startWith` for `combineLatest`),
- replay/caching behavior (`shareReplay`),
- accumulation semantics (`scan` dedupe/ordering rules).

Skip comments for trivial passthrough transforms unless the transform encodes
business meaning.

### 5) Comment boundaries at failure edges

Whenever an error boundary changes behavior (e.g., "this branch becomes null
state", "ignore per-relay failure"), comment that boundary explicitly. Readers
should be able to answer "what fails open vs fails closed?" from comments alone.

### 6) Keep comments stable under refactors

Prefer comments that describe invariant intent ("prevent re-execution on
multiple subscribers") over temporary implementation details ("needed for bug
123"). If implementation changes but intent stays the same, comments should
still be correct.

### Example style

```ts
export function createLoader(user: User): Observable<State> {
  // Step 1: resolve prerequisite relay hints used by downstream requests
  const relayHints$ = user.outboxes$.pipe(
    // Skip undefined cache state before starting downstream composition
    defined(),
    // We only need one snapshot for this loader run
    first(),
    // Fail open: missing hints should not fail the whole loader
    catchError(() => of([])),
    // Reuse across multiple downstream branches
    shareReplay(1),
  );

  // Step 2: fetch and accumulate events from all relay sources
  return relayHints$.pipe(
    switchMap((hints) =>
      eventLoader({ kind: 1, pubkey: user.pubkey, relays: relaySet(hints) }),
    ),
    // Keep newest event per id as results stream in
    scan(accumulateState, initialState),
    // Emit an initial partial state immediately
    startWith(initialState),
    // Fail open at top-level to keep the view renderable
    catchError(() => of(initialState)),
    // Prevent duplicate network work across subscribers
    shareReplay(1),
  );
}
```

---

## The operator toolkit

These operators make it practical to compose multi-source streaming state
without manual `share()` and `combineLatest` wiring.

### `combineLatestBy` — branch one source into parallel derived outputs

Takes a single source and pipes it through multiple operator branches in
parallel, combining branch outputs as an object or tuple.

```ts
source$.pipe(
  combineLatestBy({
    urls: map((items) => items), // pass items through unchanged
    status: switchMap((items) => check(items)), // derive status from same items
  }),
  // emits { urls: string[], status: StatusResult } whenever either branch emits
);
```

**Why not `combineLatest([shared$.pipe(opA), shared$.pipe(opB)])`:**
`combineLatestBy` handles the `connect()` / multicast internally, so you don't
have to manually `share()` the source or repeat it per branch. Adding a new
branch is one line.

**Object form** produces `Record<K, V>`. **Array/tuple form** produces `T[]`:

```ts
source$.pipe(
  combineLatestBy([
    map((x) => x.name), // branch 0
    map((x) => x.count), // branch 1
  ]),
  // emits [name, count]
);
```

---

### `combineLatestByIndex` — fan out per-item to stable child observables

For sources that emit arrays, creates one long-lived child observable per
array index. Each child receives its item values as an `Observable<T>` (a hot
subject), not a snapshot — so the child pipeline can react to item changes
over time.

```ts
source$.pipe(
  combineLatestByIndex((item$, index) =>
    item$.pipe(
      // item$ streams updates to the value at this index
      switchMap((item) => fetchStatus(item)),
      startWith(null), // emit immediately so combineLatestBy doesn't stall
    ),
  ),
  // emits TResult[] in source order, updating as any child emits
);
```

**The key difference from `switchMap(() => combineLatest(items.map(...)))`:**
`switchMap` tears down and rebuilds ALL child observables on every source
emission. `combineLatestByIndex` keeps existing slots alive and only
creates/removes children when the array grows or shrinks. Stable long-running
async operations (network probes, live subscriptions) are not interrupted.

**Completion:** the outer observable completes when the source AND all active
children have completed.

**Used with `switchMap`** when the child only needs the current item value
(not the full stream of changes):

```ts
urlList$.pipe(
  combineLatestByIndex(
    switchMap(
      (
        url, // switchMap receives current value; ignores updates
      ) =>
        fetchNip11(url).pipe(
          catchError(() => of(null)), // map fetch errors to null
          startWith(null), // emit immediately for combineLatestBy compat
        ),
    ),
  ),
);
```

> `combineLatestByIndex(switchMap(item => ...))` is the idiomatic form when
> each item needs one async operation and the item value itself won't change.

---

### `combineLatestByValue` — best default for string/URL lists

For source arrays that are "lists of values" (URLs, relay domains, pubkeys),
prefer `combineLatestByValue` over `switchMap(() => merge(...)) + scan(...)`.
It keeps one branch per unique value and gives you a `Map<value, result>` that
is already keyed for UI/state shaping.

```ts
urlList$.pipe(
  combineLatestByValue((url) =>
    checkUrl(url).pipe(
      catchError(() => of("offline")), // per-item failures stay local
      startWith(null), // optional: emit loading value immediately
    ),
  ),
  map((statusByUrl) => Object.fromEntries(statusByUrl.entries())),
);
```

**Why prefer it for lists:**

- avoids manual patch objects and `scan` reducers for keyed list state
- keeps stable subscriptions by value when list emissions repeat
- produces clearer pipelines (one line per concern, less imperative glue)

Use `combineLatestByIndex` when identity is array position. Use
`combineLatestByValue` when identity is the value itself.

---

### `combineLatestByKey` — same as `combineLatestByIndex` but key-based

For typed arrays where items have a stable identity field. Instead of array
position, items are tracked by a key selector.

```ts
items$.pipe(
  combineLatestByKey(
    (item) => item.id, // stable key selector
    (item$) =>
      item$.pipe(
        // item$ streams updates to this item
        switchMap((item) => check(item)),
        startWith(null),
      ),
  ),
  // emits TResult[] in source order; re-uses subscriptions for unchanged keys
);
```

**`combineLatestByIndex` vs `combineLatestByKey`:**

|             | `combineLatestByIndex`            | `combineLatestByKey`               |
| ----------- | --------------------------------- | ---------------------------------- |
| Identity    | array position                    | key selector function              |
| Source type | `T[]`                             | `TItem[]`                          |
| Use when    | string lists, stable-order arrays | objects with id/pubkey/name fields |

---

### `toLoaderState()` — add the completion flag at the view layer

Wraps `Observable<T>` into `Observable<LoaderState<T>>`:

- Each emission → `{ data: T, complete: false }`
- On completion → `{ data: lastT, complete: true }` then completes

Applied at the **view layer**, not inside the loader. This keeps loaders as
pure data streams and lets the view control the hard deadline:

```ts
// In the view — NOT inside the loader
createLoader(input).pipe(
  takeUntil(timer(TIMEOUT_MS)), // hard deadline set by the view
  toLoaderState(), // wrap with complete flag
);
```

**Why the view owns the deadline:** different views may have different timeout
requirements for the same loader data. The loader doesn't know which view is
consuming it.

---

## ⚠ The `combineLatest` first-emission rule

**`combineLatest` will not emit until every branch has emitted at least once.**

A single slow or failing branch silently blocks all combined output. If the
view has a `takeUntil(timer(N))` deadline and `combineLatest` never emits, the
`toLoaderState()` operator has no `lastData` — the view is stuck in loading
mode permanently even after the timeout fires.

**Rule: every branch passed directly to `combineLatest` MUST use `startWith`.**

```ts
// ✅ correct — both branches emit immediately
combineLatest({
  a: slowAsync$.pipe(
    catchError(() => of(null)),
    startWith(null),
  ),
  b: alsoSlow$.pipe(
    catchError(() => of(null)),
    startWith(null),
  ),
});

// ❌ wrong — branch b blocks all output until it emits
combineLatest({
  a: slowAsync$.pipe(
    catchError(() => of(null)),
    startWith(null),
  ),
  b: alsoSlow$.pipe(catchError(() => of(null))), // missing startWith
});
```

**`combineLatestBy`, `combineLatestByIndex`, and `combineLatestByKey` are
exempt** — they use an internal `NOT_YET` sentinel and manage first-emission
tracking themselves. Child observables passed to them do not need `startWith`
to unblock the outer stream. You may still use `startWith` on children to
provide a meaningful initial value (e.g. `null` or `"loading"`) while the
async work is in-flight.

---

## Patterns

### Pattern A — Single async source

The simplest case: one async fetch, map to state, done.

```ts
export function createLoader(id: string): Observable<ItemState> {
  return fetchItem(id).pipe(
    last(null, null as Item | null), // take last item before source completes, or null
    map((item) => ({ item, derived: derive(item) })), // build state from item
    catchError(() => of({ item: null, derived: null })), // map errors to null state
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

Use when: one data source, no fan-out, no streaming partial state needed.

---

### Pattern B — Single source → `combineLatestBy` → parallel derived outputs

One source produces multiple derived values that update independently.
`combineLatestBy` forks the source into branches simultaneously.

```ts
export function createLoader(id: string): Observable<RelayCheckState> {
  return fetchRelayList(id).pipe(
    map((event) => extractUrls(event)), // extract string[] from the event
    combineLatestBy({
      urls: map((urls) => urls), // pass URLs through unchanged
      status: combineLatestByIndex(
        // fan out per URL in parallel
        switchMap((url) =>
          checkRelay(url).pipe(
            catchError(() => of("unknown")), // map check errors to unknown
            startWith(null), // emit immediately while checking
          ),
        ),
      ),
    }),
    map(({ urls, status }) => ({
      // reshape indexed results to a record
      urls,
      statusByUrl: Object.fromEntries(urls.map((url, i) => [url, status[i]])),
    })),
    catchError(() => of({ urls: null, statusByUrl: {} })), // top-level error fallback
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

Use when: one source, multiple derived properties where at least one fans out
per-item into async child operations.

---

### Pattern C — Independent parallel sub-loaders

When a report has multiple independent data sources that have nothing to derive
from each other, make each source its own named sub-loader. Compose them into
a combined state with `combineLatest`.

```ts
// Each sub-loader is independently subscribable for debugging
function createALoader(input: Input): Observable<AState> {
  return fetchA(input).pipe(
    map((data) => processA(data)), // derive A state
    catchError(() => of(null_A)), // map errors to null state
    shareReplay(1), // prevent re-execution
  );
}

function createBLoader(input: Input): Observable<BState> {
  return fetchB(input).pipe(
    map((data) => processB(data)), // derive B state
    catchError(() => of(null_B)), // map errors to null state
    shareReplay(1), // prevent re-execution
  );
}

export function createLoader(input: Input): Observable<CombinedState> {
  return combineLatest({
    a: createALoader(input).pipe(startWith(null_A)), // emit immediately so combineLatest doesn't stall
    b: createBLoader(input).pipe(startWith(null_B)), // emit immediately so combineLatest doesn't stall
  }).pipe(
    takeUntil(timer(TIMEOUT_MS)), // hard deadline for the combined stream
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

**Why named sub-loaders:** if the combined loader hangs, subscribe to each
sub-loader individually to isolate which source is stuck. Named functions also
make the composition readable.

**`startWith` placement:** add it _after_ each sub-loader (not inside it).
The sub-loader itself should not emit an initial null — it should emit real
data as soon as it arrives. `startWith` is a `combineLatest` compatibility
shim applied at the composition layer.

Use when: multiple independent async sources that don't depend on each other's
results, but whose state needs to be presented together.

---

### Pattern D — Per-item scan accumulation

When you need to stream events from multiple sources simultaneously and
accumulate the best result per key. `scan` rebuilds state incrementally as
events arrive.

```ts
export function createLoader(items: string[]): Observable<CoverageState> {
  const perItem$ = items.map((id) =>
    streamEvents(id).pipe(
      takeUntil(timer(ITEM_TIMEOUT_MS)), // cut each stream at its own deadline
      scan(
        (best, event) => {
          // keep the best event seen so far
          if (!best || event.score > best.score) return event;
          return best;
        },
        null as Event | null,
      ),
      catchError(() => of(null)), // map stream errors to null
      startWith(null), // emit immediately for combineLatest
      map((best) => ({ id, best })), // tag result with the item id
    ),
  );

  return combineLatest(perItem$).pipe(
    map((results) => ({
      // assemble the coverage map
      items,
      coverage: new Map(results.map((r) => [r.id, r.best])),
    })),
    catchError(() => of({ items, coverage: new Map() })),
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

Use when: you need to know which specific source produced which result (not
just "best overall"), and results trickle in over time.

---

### Pattern E — Nested fan-out

Two-dimensional composition: fan out per item, then per sub-item. Each level
uses `combineLatestByIndex` or `combineLatestBy` independently.

```ts
// For each user, get their contacts; for each contact, get their profile
function friendsOfFriendsView(user$: Observable<User>) {
  return user$.pipe(
    switchMap((user) => user.contacts$), // switch to user's contact list
    defined(), // wait for contacts to load
    combineLatestByIndex(
      // fan out per contact
      switchMap((contact) =>
        combineLatestBy({
          // for each contact, derive two things
          name: contact.profile$.pipe(
            map((p) => p?.displayName ?? contact.id.slice(0, 12) + "…"),
          ),
          contacts: contact.contacts$.pipe(
            takeUntil(timer(10_000)), // 10s timeout for each contact list
            catchError((err) => of(err)), // pass errors back to the view
          ),
        }),
      ),
    ),
  );
}
```

Use when: you have a list of items, each of which has its own list of
sub-items, and you want to stream updates at both levels.

**Completion:** the outer `combineLatestByIndex` completes only when all inner
`combineLatestBy` branches have completed. Per-item timeouts (`takeUntil`) are
essential to bound how long each inner branch runs.

---

## Consuming a loader in a view

The view applies the hard deadline and wraps the raw stream with `toLoaderState()`:

```ts
const loaderState = use$(
  () =>
    input
      ? createLoader(input).pipe(
          takeUntil(timer(TIMEOUT_MS)), // hard deadline owned by the view
          toLoaderState(), // add complete flag
        )
      : undefined,
  [input.id], // re-subscribe when input identity changes
);

const isLoading = !loaderState?.complete;
const state = loaderState?.data; // may be partial while loading
```

### Three render states

| `loaderState`         | Meaning                        | What to render            |
| --------------------- | ------------------------------ | ------------------------- |
| `undefined`           | No emission yet                | Spinner + Skip button     |
| `{ complete: false }` | Partial state, still streaming | Spinner + partial content |
| `{ complete: true }`  | Final state                    | Full report UI            |

**`takeUntil` goes before `toLoaderState()`** — when the deadline fires, the
loader completes, and `toLoaderState()` stamps the last partial state as
`complete: true`. The view gets whatever was loaded before the deadline.

**The view owns the deadline** because different views consuming the same
loader may have different acceptable wait times. Keeping the timeout out of the
loader also makes the loader easier to test.

---

## Composing loaders

Loaders are plain functions returning observables — they compose naturally:

```ts
import { createListsLoader } from "./lists-loader.ts";

export function createLoader(input: Input): Observable<DerivedState> {
  return createListsLoader(input).pipe(
    last(), // wait for the upstream loader to complete
    switchMap((listsState) => {
      // use its final state as input
      return deriveFurtherState(listsState);
    }),
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
```

**Compose when:** one loader's complete output is a prerequisite for another
loader's work (sequential dependency).

**Inline when:** the logic is specific to one loader and a full abstraction
would add indirection without reuse benefit.

---

---

## Appendix: dr-nostr specifics

### `createLoader(user: User)` — the loader contract

Every report loader exports exactly one function with this signature:

```ts
import type { User } from "applesauce-common/casts";
import type { Observable } from "rxjs";

export function createLoader(user: User): Observable<MyReportState> {
  return /* ... */.pipe(
    shareReplay(1),
  );
}
```

`User` is the applesauce cast that provides typed observable properties:
`user.pubkey`, `user.outboxes$`, `user.inboxes$`, `user.profile$`, etc.

### Data source decision

| Data role                          | Source                                               | Why                                                   |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Addressable event for this subject | `loadAddressableEvent(user, kind)`                   | Merges outbox hints + default relays automatically    |
| Non-replaceable event              | `eventLoader({ kind, pubkey })` + `last(null, null)` | EOSE-completing; never emits `undefined`              |
| Relay URLs already in cache        | `user.outboxes$.pipe(defined(), first())`            | Fast from cache; `defined()` skips `undefined`/`null` |

**Never use `eventStore.replaceable()` for primary data fetches.** It emits
`undefined` synchronously on cache-miss, which immediately disarms any
`timeout({ first: N })` placed after it — the loader then hangs indefinitely
if the relay never responds. `eventLoader` and `loadAddressableEvent` never
emit `undefined`.

### Project helpers

```ts
// Fetch an addressable event from the user's outbox relays + default relays
import { loadAddressableEvent } from "src/observable/loaders/load-addressable-event.ts";

// Probe a relay for NIP-42 auth enforcement (completes after first result)
import { probeRelayAuth } from "src/observable/loaders/probe-relay-auth.ts";

// Compute online/offline verdict for a relay via NIP-66 monitors
import { relayVerdict } from "src/lib/relay-monitors.ts";

// Merge relay URL arrays, deduplicate, ignore undefined/null entries
import { relaySet } from "applesauce-core/helpers";

// Filter undefined and null from an observable stream
import { defined } from "applesauce-core/observable";
```

### Loader vs page responsibility

**Rule: if data determines a report verdict, it belongs in the loader.**
The page only owns user interaction state.

| Concern                              | Loader | Page |
| ------------------------------------ | ------ | ---- |
| Fetching events from store or relays | ✓      |      |
| Relay list resolution                | ✓      |      |
| Per-relay presence checks            | ✓      |      |
| Per-relay NIP-11 / supported NIPs    | ✓      |      |
| Per-relay auth probing               | ✓      |      |
| Per-relay online/offline verdict     | ✓      |      |
| Checkbox / selection UI state        |        | ✓    |
| Publish actions                      |        | ✓    |
| Navigation (next / skip)             |        | ✓    |
| Auto-advance timers                  |        | ✓    |
| `takeUntil(timer(N))` deadline       |        | ✓    |
| `toLoaderState()` wrapping           |        | ✓    |
