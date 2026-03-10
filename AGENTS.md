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
│   └── store.ts          # EventStore + eventLoader
└── pages/
    ├── reports.tsx       # REPORTS registry — add new diagnostic pages here
    ├── reports/          # One file per diagnostic report page
    ├── complete/         # Terminal destination after all report pages
    └── signin/           # Sign-in flow (layout + method pages)
```

**Adding a diagnostic page:** create a component in `src/pages/reports/`, then register it in `src/pages/reports.tsx`. The `next()` context method walks the `REPORTS` array in order and navigates to `/complete` after the last entry.

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
function handler(_event: MouseEvent) { /* intentionally unused */ }
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

| Entity                | Convention               | Example                              |
| --------------------- | ------------------------ | ------------------------------------ |
| React components      | PascalCase               | `RelayRow`, `VerdictBadge`           |
| Hooks                 | camelCase + `use` prefix | `useRelayVerdict`, `useApp`          |
| Functions / variables | camelCase                | `handleRemove`, `relayList`          |
| Constants             | UPPER_SNAKE or camelCase | `DEFAULT_RELAYS`, `monitors$`        |
| RxJS subjects/obs.    | camelCase + `$` suffix   | `subjectPubkey$`, `monitors$`        |
| Files (components)    | PascalCase               | `SignInLayout.tsx`, `CompleteView`   |
| Files (hooks/utils)   | camelCase or kebab-case  | `relay-monitors.ts`, `accounts.ts`   |

### React components

```tsx
// Named function declaration, default export — always
function RelayRow({ relayUrl, monitors }: { relayUrl: string; monitors: RelayMonitor[] }) {
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
  return () => clearTimeout(timer);  // always return cleanup
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

## Pre-commit Checklist

1. `pnpm build` — zero TypeScript errors
2. `pnpm lint` — zero ESLint errors
3. No `console.log` left in committed code
4. No unused imports or variables
5. All type-only imports use `import type`
6. Every `useEffect` that sets up a subscription or timer returns a cleanup function
