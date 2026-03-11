# AGENTS.md — dr-nostr

Coding agent reference for the **dr-nostr** repository: a Nostr protocol diagnostic client built with React 19, TypeScript, Vite, and the `applesauce` library suite.

---

## Project Overview

dr-nostr is a step-by-step Nostr account diagnostic tool ("nostr.doctor"). Users enter a pubkey, optionally sign in, and walk through sequential diagnostic report pages. All Nostr protocol work goes through `applesauce-*` packages. The UI layer uses React 19 + Tailwind CSS v4 + DaisyUI v5.

**MCP servers are available** for agent use:

- `nostr` — local MCP server for Nostr NIP documentation
- `applesauce` — remote MCP at `https://mcp.applesauce.build/mcp` for applesauce API docs

---

## Package Manager

**Always use `pnpm`.** Never use `npm` or `yarn`.

```bash
pnpm install          # install dependencies
pnpm add <pkg>        # add a production dependency
pnpm add -D <pkg>     # add a dev dependency
```

---

## Commands

```bash
pnpm dev              # start Vite dev server (HMR enabled)
pnpm build            # tsc -b (type-check) then vite build
pnpm lint             # ESLint across all .ts/.tsx files
pnpm format           # Prettier --write . (auto-format)
pnpm preview          # preview production build locally
```

**Before committing:** `pnpm build` and `pnpm lint` must both pass with zero errors.

### Tests

No test framework is configured yet. When Vitest is added, use:

```bash
pnpm vitest run                           # run all tests once
pnpm vitest run src/path/to/file.test.ts  # run a single test file
pnpm vitest                               # interactive watch mode
```

Use **Vitest** (not Jest) — it integrates natively with Vite.

---

## Project Structure

```
src/
├── main.tsx              # Entry point — BrowserRouter + StrictMode
├── App.tsx               # Root providers + route tree (AppRoutes, RequireSubject)
├── index.css             # Tailwind + DaisyUI import (do not restructure)
├── context/
│   └── AppContext.tsx    # AppProvider, useApp, PageDefinition, subjectPubkey$
├── lib/                  # Singleton instances and pure utilities
│   ├── accounts.ts       # AccountManager (session-only, no localStorage)
│   ├── factory.ts        # EventFactory wired to manager.signer (ProxySigner)
│   ├── relay.ts          # RelayPool + DEFAULT_RELAYS + LOOKUP_RELAYS
│   ├── relay-monitors.ts # monitors$ observable + APPROVED_MONITOR_PUBKEYS
│   ├── store.ts          # EventStore + eventLoader
│   └── timeouts.ts       # Shared timeout constants for all report pages
└── pages/
    ├── reports.tsx       # REPORTS registry — add new diagnostic pages here
    ├── reports/          # One folder per diagnostic report
    │   ├── loader-types.ts          # Shared LoaderState<T> type
    │   └── <report-name>/
    │       ├── loader.ts            # Pure RxJS loader — must complete + shareReplay(1)
    │       └── page.tsx             # React component — loading/report modes
    ├── complete/         # Terminal destination after all report pages
    └── signin/           # Sign-in flow (layout + method pages)
```

**Adding a diagnostic page:** create a folder `src/pages/reports/<kebab-name>/` with `loader.ts` and `page.tsx`, then register it in `src/pages/reports.tsx`. See **Report Loader Architecture** below for the full contract. The `next()` context method walks the `REPORTS` array in order and navigates to `/complete` after the last entry.

---

## TypeScript

Strict TypeScript 5.9. All options below are **compiler errors**, not warnings:

| Option                         | Implication                                                |
| ------------------------------ | ---------------------------------------------------------- |
| `strict: true`                 | All strict checks enabled; no implicit `any`               |
| `noUnusedLocals: true`         | Every declared local must be used                          |
| `noUnusedParameters: true`     | Every function parameter must be used or prefixed with `_` |
| `verbatimModuleSyntax: true`   | Type-only imports **must** use `import type`               |
| `erasableSyntaxOnly: true`     | No `const enum`, no `namespace`, no decorator metadata     |
| `noFallthroughCasesInSwitch`   | Switch cases need explicit `break` or `return`             |
| `noUncheckedSideEffectImports` | Side-effect imports must be intentional                    |

### Import rules

```ts
// Type-only imports — REQUIRED by verbatimModuleSyntax
import type { NostrEvent } from "applesauce-core/helpers";
import type { RelayMonitor } from "applesauce-common/casts";

// Local imports require explicit file extensions
import App from "./App.tsx";
import { useApp } from "./context/AppContext.tsx";
import { pool } from "./lib/relay.ts";

// No `import React` needed — react-jsx transform handles it
```

### Unused parameters

Prefix with `_` to suppress the `noUnusedParameters` error:

```ts
function handler(_event: MouseEvent) {
  /* intentionally unused */
}
```

---

## Code Style

Prettier is configured (`.prettierrc`): `tabWidth: 2`, `useTabs: false`. Run `pnpm format` before committing. ESLint 9 flat config (`eslint.config.js`) enforces `react-hooks` and `react-refresh` rules on all `.ts`/`.tsx` files.

### Formatting conventions

- **2-space indentation**, no tabs
- Trailing newline at end of file
- Conditional class merging pattern used throughout:
  ```tsx
  className={['base-class', condition ? 'extra' : ''].filter(Boolean).join(' ')}
  ```

### Naming

| Entity                | Convention               | Example                            |
| --------------------- | ------------------------ | ---------------------------------- |
| React components      | PascalCase               | `RelayRow`, `VerdictBadge`         |
| Hooks                 | camelCase + `use` prefix | `useRelayVerdict`, `useApp`        |
| Functions / variables | camelCase                | `handleRemove`, `relayList`        |
| Constants             | UPPER_SNAKE or camelCase | `DEFAULT_RELAYS`, `monitors$`      |
| RxJS subjects/obs.    | camelCase + `$` suffix   | `subjectPubkey$`, `monitors$`      |
| Files (components)    | PascalCase               | `SignInLayout.tsx`, `CompleteView` |
| Files (hooks/utils)   | camelCase or kebab-case  | `relay-monitors.ts`, `accounts.ts` |

### React components

```tsx
// Named function declaration, default export — always
function RelayRow({
  relayUrl,
  monitors,
}: {
  relayUrl: string;
  monitors: RelayMonitor[];
}) {
  return <div className="rounded-xl border p-4">...</div>;
}

export default RelayRow;
```

- Prefer **named function declarations** over arrow function components at module top-level
- One primary component per file; use `export default` for it
- Sub-components used only within a file are declared **above** the main component in the same file
- React 19 `use()` hook is used for context — prefer it over `useContext`
- `<StrictMode>` is active — components must be side-effect-safe under double-render

### Hooks and effects

```tsx
useEffect(() => {
  const timer = setTimeout(() => next(), 1500);
  return () => clearTimeout(timer); // always return cleanup
}, [next]);
```

---

## Styling

Tailwind CSS v4 + DaisyUI v5. Utility-first; avoid custom CSS.

```css
/* src/index.css — do not modify this pattern */
@import "tailwindcss";
@plugin "daisyui";
```

- Reach for **DaisyUI classes** (`btn`, `card`, `badge`, `loading`, `modal`, etc.) before raw Tailwind utilities
- Responsive: use Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`)
- Dark mode: controlled by `data-theme` on `<html>` (DaisyUI)
- Page layout pattern: `min-h-screen bg-base-100 flex items-center justify-center p-4` with a centered `w-full max-w-md` card

---

## Nostr / Applesauce Patterns

Never construct, sign, or parse Nostr events manually. Use applesauce exclusively.

```ts
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core/event-factory";
import { RelayPool } from "applesauce-relay";
import { AccountManager } from "applesauce-accounts";
import { use$ } from "applesauce-react/hooks";
```

- `eventStore` (`lib/store.ts`) — all event storage and reactive queries
- `pool` (`lib/relay.ts`) — all relay connections
- `manager` (`lib/accounts.ts`) — session-only account management; no `localStorage`
- `factory` (`lib/factory.ts`) — event creation and signing via `manager.signer` (ProxySigner)
- `monitors$` (`lib/relay-monitors.ts`) — RxJS observable of live NIP-66 relay monitors
- `lib/timeouts.ts` — **canonical source for all timeout and auto-advance durations**; import from here instead of declaring local constants in report pages
- Relay/network errors from `applesauce-relay` are RxJS Observable errors — handle with `catchError`
- Subscribe to observables in components via `use$` from `applesauce-react/hooks`
- Always provide a `shareReplay(1)` when an observable is shared across multiple subscribers

Consult the applesauce MCP server for API details. Consult the nostr MCP for NIP specs before implementing any protocol feature.

---

## Error Handling

- Use explicit error types; narrow with `instanceof Error` in catch blocks:
  ```ts
  catch (e) {
    setError(e instanceof Error ? e.message : "Operation failed.");
  }
  ```
- User-facing errors must surface in UI state — not `console.error` alone
- Never swallow errors silently
- Read-only mode (no signer): unsigned `EventTemplate` objects are collected in `draftEvents` via `AppContext`; they are not published until the user signs in

---

## Report Loader Architecture

Every diagnostic report is split into three concerns across two files inside `src/pages/reports/<kebab-name>/`:

| File        | Responsibility                                                     |
| ----------- | ------------------------------------------------------------------ |
| `loader.ts` | Pure RxJS — streams raw state as fetches resolve. No UI concepts.  |
| `page.tsx`  | React component — renders loading/report modes, owns all mutations |

See `docs/streaming-state-loaders.md` for the full pattern reference and RxJS recipes.

### `LoaderState<T>`

```ts
// src/pages/reports/loader-types.ts
export type LoaderState<T> = {
  data: T; // current accumulated state (may be partial during load)
  complete: boolean; // true on the final emission only
};
```

`LoaderState<T>` is a **page-layer type** produced by the `toLoaderState()` operator in `src/observable/toLoaderState.ts`. Loaders themselves return `Observable<TState>` — not `Observable<LoaderState<TState>>`.

### `createLoader(user: User)` contract

Every `loader.ts` exports one function with this signature:

```ts
import type { User } from "applesauce-common/casts";
import type { Observable } from "rxjs";

export function createLoader(user: User): Observable<TState> { ... }
```

**Rules that every loader must follow:**

1. **Pure RxJS** — no React imports, no hooks, no context. Receives `User` as its only argument.
2. **Returns `Observable<TState>`** — raw state only. The `LoaderState` wrapper (`complete` flag) is applied by `toLoaderState()` at the page layer, not in the loader.
3. **Streams state as it builds** — use `combineLatest` + `startWith(null)` on parallel sources so the state object updates incrementally as each fetch resolves. The page sees partial state immediately. **Critical:** `combineLatest` will not emit anything until every inner observable has emitted at least once. Every inner observable passed to `combineLatest` MUST use `startWith(initialValue)`. A missing `startWith` on any one source silently hangs the entire loader — no partial state, no terminal emission, report stuck in loading mode even after `takeUntil` fires.
4. **Classify data before choosing a source:**
   - **Primary output** (event being diagnosed) → `eventLoader({ kind, pubkey })` + `last(null, null)`. Completes after EOSE; never emits `undefined`; no timeout-disarm risk.
   - **Required input from cache** (e.g. outbox URLs for a downstream pool request) → `user.outboxes$` (or other `User` cast observable) + `defined()` + `first()`. Fast from cache; `defined()` from `applesauce-core/observable` safely skips `undefined` and `null`.
5. **Never use `eventStore.replaceable()` for event fetching in loaders** — it emits `undefined` synchronously on cache-miss, which silently disarms any timeout before the relay fetch starts.
6. **Use `relaySet()` when building relay lists for pool requests** — `relaySet(...sources)` from `applesauce-core/helpers` accepts `undefined`/`null` entries and ignores them, merges and deduplicates, and always returns `string[]`. Use it to safely combine outboxes with fallback relays: `relaySet(outboxes, LOOKUP_RELAYS)`.
7. **`shareReplay(1)` last** — required on every loader. Prevents re-execution when multiple subscribers attach (React StrictMode double-invoke, `toLoaderState()` subscription). Late subscribers after completion receive the final state immediately.
8. **Error-safe** — use `catchError` internally. Map errors into the state type (null fields). The observable must never error to the page.

### How the page consumes the loader

```tsx
function MyReport() {
  const { subject, next, publish } = useReport();

  const loaderState = use$(
    () =>
      subject
        ? createLoader(subject).pipe(
            // takeUntil gives the whole pipeline a hard deadline.
            // toLoaderState() detects completion and stamps complete: true.
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            toLoaderState(),
          )
        : undefined,
    [subject?.pubkey],
  );

  // undefined  → observable not yet emitted (loading)
  // complete: false → partial state mid-stream (loading)
  // complete: true  → final state (report mode)
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  if (isLoading) {
    // Render spinner + any partial state already in `state`
    return <LoadingView partial={state} onSkip={next} />;
  }
  return <ReportView state={state!} next={next} publish={publish} />;
}
```

**During loading**, render a spinner at the top plus whatever partial `state` data is already available. Individual relay rows or field lists can appear and fill in as the stream progresses — the loading indicator just sits at the top until `complete: true`.

**`takeUntil` placement** — before `toLoaderState()`, on the raw state stream. When the deadline fires, `toLoaderState()` detects the completion and emits the last partial state as `{ complete: true }`.

### Loader vs page responsibility

**Rule: if data determines a report verdict, it belongs in the loader.**
The page only owns user interaction state.

| Concern                                                | Loader | Page |
| ------------------------------------------------------ | ------ | ---- |
| Fetching events from store or relays                   | ✓      |      |
| Relay list resolution                                  | ✓      |      |
| Per-relay presence checks (metadata-broadcast)         | ✓      |      |
| Per-relay NIP-11 / supported NIPs (search-relay-nip50) | ✓      |      |
| Per-relay auth probing (dm-relay-auth)                 | ✓      |      |
| Per-relay online/offline verdict (dead-relays)         | ✓      |      |
| Checkbox / selection UI state                          |        | ✓    |
| Publish actions                                        |        | ✓    |
| Navigation (next / skip)                               |        | ✓    |
| Auto-advance timers                                    |        | ✓    |
| `takeUntil(timer(N))` deadline                         |        | ✓    |
| `toLoaderState()` wrapping                             |        | ✓    |

**Why verdict data belongs in the loader:** `relay.supported$`, `probeRelayAuth()`,
and `relayVerdict()` are all completable observables (complete after a fetch or
timeout). They compose cleanly into the loader's `combineLatest` fan-out. Keeping
them in the page creates React hook-based async state management that duplicates
the loader pattern and is harder to reason about.

**`combineLatestByKey`** (`src/observable/combineLatestByKey.ts`) — used inside
`relayVerdict()` to fan out per-relay checks to each monitor without re-creating
subscriptions when `monitors$` re-emits the same set of monitors.

**Shared helpers** in `src/observable/relay-loaders.ts`:

- `fetchRelayListUrls(kind, pubkey, hints?)` — fetch relay list event URLs
- `relayNip11Streaming(url)` — per-relay NIP-11 with `startWith(null)` for `combineLatest`
- `probeRelayAuth(url, pubkey)` — completable NIP-42 auth probe

**`relayVerdict(url)`** in `src/lib/relay-monitors.ts` — computes online/offline
verdict using `monitors$` + `combineLatestByKey`.

---

## Report Page Design Contract

This section defines the behavioral contract every diagnostic report page must follow.

### File & Registration

1. Create the folder `src/pages/reports/<kebab-name>/` with `loader.ts` and `page.tsx`.
2. Register it in `src/pages/reports.tsx` by adding an entry to `REPORTS`:
   ```ts
   {
     name: "my-report",
     Component: lazy(() => import("./reports/my-report/page.tsx")),
   }
   ```
3. Routes are automatically created at `/r/<name>` by `AppContext`.

### Loading State

Show a spinner **plus a short progress description** while fetching. Render any partial `state` data already available — individual rows can fill in as the stream progresses:

```tsx
if (isLoading) {
  return (
    <div className="flex flex-col gap-6">
      <span className="loading loading-spinner loading-lg text-primary" />
      <p className="text-sm text-base-content/60">Loading your profile…</p>
      {/* render partial state here if useful */}
      <button className="btn btn-ghost btn-sm" onClick={next}>
        Skip
      </button>
    </div>
  );
}
```

**Always show a Skip button during loading** — from the very first frame, not only after a timeout fires.

**The three loader states:**

| Value                            | Meaning                        | UI to show                |
| -------------------------------- | ------------------------------ | ------------------------- |
| `loaderState === undefined`      | Observable not yet emitted     | Spinner + Skip button     |
| `loaderState.complete === false` | Partial state, still streaming | Spinner + partial content |
| `loaderState.complete === true`  | Final state, report ready      | Full report UI            |

```tsx
const isLoading = !loaderState?.complete;
const state = loaderState?.data; // may be partial/undefined during loading
```

**Timeouts belong in the loader**, not in React state. The loader uses `timeout({ first: N, with: () => of(null) })` + `first()` or `takeUntil(timer(N))` + `last()` to guarantee the observable completes. The page never needs its own timeout for data fetching.

**Verdict timeouts:** For pages that check per-relay or per-item statuses (which may stay `"unknown"` indefinitely), use a React-layer `setTimeout` as a secondary timeout (e.g. 15 s) since per-item status streams already have their own per-item timeouts (see `relayStatusWithTimeout`). After the secondary timeout fires, treat remaining `"unknown"` items as skippable and enable the Next button:

```tsx
const [verdictTimedOut, setVerdictTimedOut] = useState(false);
useEffect(() => {
  if (!dataLoaded || items.length === 0) return;
  const timer = setTimeout(() => setVerdictTimedOut(true), 15_000);
  return () => clearTimeout(timer);
}, [dataLoaded, items.length]);

// Derive: user can proceed when no issues AND (all known OR timed out)
const canProceed = !hasIssues && (allKnown || verdictTimedOut);
```

The Next button must use `canProceed`; also render a visible Skip button while `!canProceed`.

### Auto-Advance Rules

- **No issues found:** auto-advance to the next report after **1500 ms**.
- **After a successful publish:** auto-advance after **1500 ms**.
- Both use a `setTimeout` inside `useEffect` with a cleanup return — see the Hooks and effects pattern above.
- Auto-advance always calls `next()` from `useApp()`.

### Missing Prerequisite Event

If a report requires a Nostr event that doesn't exist (e.g. no NIP-65 relay list), **do not auto-advance**. Show an explicit error state:

```tsx
// Example: required event not found
return (
  <div className="flex flex-col gap-4">
    <p className="text-error text-sm">
      No relay list (NIP-65) found for this account. An earlier report should
      have created one.
    </p>
    <button className="btn btn-outline btn-sm" onClick={next}>
      Next
    </button>
  </div>
);
```

Design the report flow so earlier pages create prerequisite events. If a later page still can't find what it needs, show this error state with a Next button — never crash or silently skip.

### Read-Only Mode (No Signer)

Call `publish()` from `useApp()` exactly as you would in signed-in mode. When no signer is present, `publish()` automatically queues the `EventTemplate` into `draftEvents`. **Do not add inline sign-in prompts on report pages** — the `complete/` page handles surfacing drafts and prompting sign-in.

### Fix Granularity & Multi-Event Publishing

- Fix granularity is driven by the **underlying Nostr event model**: if multiple items are stored in one event (e.g. all relays in a single kind:10002), batch them into one `publish()` call. If separate events are needed, multiple `publish()` calls are fine.
- All `publish()` calls are **fire-and-forget** (independent). Do not await or serialize them. Dispatch all needed publishes, then show a success state and auto-advance after 1500 ms.

### Skip / Next Button

Always provide a way to proceed without fixing. When issues are present, a "Skip" button (or "Next" if the page is in a done state) must be visible and call `next()`.

```tsx
<button className="btn btn-ghost btn-sm" onClick={next}>
  Skip
</button>
```

### Error Display

Publish errors (relay failures, signer rejection, etc.) must be shown **above the Skip/Next buttons**, inline in the card. Do not use toasts or replace the whole page.

```tsx
{
  error && <p className="text-error text-sm">{error}</p>;
}
<div className="flex gap-2 justify-end">
  <button className="btn btn-ghost btn-sm" onClick={next}>
    Skip
  </button>
</div>;
```

### Expandable "Deeper" Details

Optional. Add a collapsible details section per item **only where it genuinely adds value** (e.g. NIP-11 metadata for a relay, raw event fields for a profile). Use a DaisyUI `<details>` / `collapse` component or a local `open` state toggle. There is no requirement that every item or every page has this.

### Relay Strategy for Fetching

Each report page chooses its own relay strategy. The **recommended approach** is to fetch the subject's events from their outbox relays (their NIP-65 write relays), as this gives the most accurate and up-to-date data. Fall back to `LOOKUP_RELAYS` from `lib/relay.ts` when the outbox list is unavailable.

### State Management Pattern

Report data comes from the loader via `use$`. Page-local UI state uses `useState` with discriminated boolean flags:

```ts
// Loader state — driven by createLoader()
const loaderState = use$(
  () => (subject ? createLoader(subject) : undefined),
  [subject?.pubkey],
);
const isLoading = !loaderState?.complete;
const state = loaderState?.data;

// Page-local mutation state
const [publishing, setPublishing] = useState(false);
const [done, setDone] = useState(false);
const [error, setError] = useState<string | null>(null);
```

Avoid `useReducer` unless the state transitions become genuinely complex.

### No Diff Preview

Publish immediately on button press. The button label (e.g. "Remove", "Fix") communicates the action clearly enough. No confirmation modals or before/after diffs are needed.

### Referral System

Report pages have no responsibility for referral links. Just call `publish()`. The `complete/` page handles draft collection, Blossom uploads, and referral URL generation.

### Sub-components

Declare sub-components (e.g. item rows, verdict badges) **above** the main page component in the same file. Only extract to a separate file if the sub-component is shared across multiple report pages.

---

## Pre-commit Checklist

1. `pnpm build` — zero TypeScript errors
2. `pnpm lint` — zero ESLint errors
3. No `console.log` left in committed code
4. No unused imports or variables
5. All type-only imports use `import type`
6. Every `useEffect` that sets up a subscription or timer returns a cleanup function
