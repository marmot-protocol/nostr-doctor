# AGENTS.md — dr-nostr

Coding agent reference for the **dr-nostr** repository: a Nostr protocol diagnostic client built with React 19, TypeScript, Vite, and the `applesauce` library suite.

---

## Project Overview

dr-nostr is a step-by-step Nostr account diagnostic tool ("nostr.doctor"). Users enter a pubkey, optionally sign in, and walk through sequential diagnostic pages. All Nostr protocol work goes through `applesauce-*` packages. The UI layer uses React 19 + Tailwind CSS v4 + DaisyUI v5.

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

## TypeScript

Strict TypeScript 5.9. All options below are **compiler errors**, not warnings:

| Option                          | Implication                                                |
| ------------------------------- | ---------------------------------------------------------- |
| `strict: true`                  | All strict checks enabled; no implicit `any`               |
| `noUnusedLocals: true`          | Every declared local must be used                          |
| `noUnusedParameters: true`      | Every function parameter must be used or prefixed with `_` |
| `verbatimModuleSyntax: true`    | Type-only imports **must** use `import type`               |
| `erasableSyntaxOnly: true`      | No `const enum`, no `namespace`, no decorator metadata     |
| `noFallthroughCasesInSwitch`    | Switch cases need explicit `break` or `return`             |
| `noUncheckedSideEffectImports`  | Side-effect imports must be intentional                    |

### Import rules

```ts
// Type-only imports — REQUIRED by verbatimModuleSyntax
import type { NostrEvent } from "applesauce-core/helpers";

// Local imports require explicit file extensions
import App from "./App.tsx";
import { useApp } from "./context/AppContext.tsx";
import { pool } from "./lib/relay.ts";

// No `import React` needed — react-jsx transform handles it
```

### Unused parameters

Prefix with `_` to suppress errors:

```ts
function handler(_event: MouseEvent) { /* intentionally unused */ }
```

---

## Code Style

Prettier is configured (`.prettierrc`): 2-space indentation, spaces (not tabs). Run `pnpm format` to auto-format. ESLint 9 flat config (`eslint.config.js`) enforces react-hooks and react-refresh rules.

### Formatting conventions

- **2-space indentation**, no tabs
- **Single quotes** for strings (observed throughout source)
- Trailing newline at end of file

### Naming

| Entity                | Convention               | Example                             |
| --------------------- | ------------------------ | ----------------------------------- |
| React components      | PascalCase               | `UserProfile`, `NoteCard`           |
| Hooks                 | camelCase + `use` prefix | `useEventStore`, `useRelayPool`     |
| Functions / variables | camelCase                | `fetchProfile`, `eventStore`        |
| Constants             | UPPER_SNAKE or camelCase | `DEFAULT_RELAYS`, `maxRetries`      |
| CSS classes           | kebab-case               | `.note-card`, `.relay-status`       |
| Files (components)    | PascalCase               | `NoteCard.tsx`, `SignInLayout.tsx`  |
| Files (hooks/utils)   | camelCase                | `useEventStore.ts`, `formatDate.ts` |

### React components

```tsx
// Named function declaration, default export — always
function NoteCard({ event }: { event: NostrEvent }) {
  return <div className="note-card">...</div>;
}

export default NoteCard;
```

- Prefer **named function declarations** over arrow function components at module top-level
- One primary component per file; use `export default` for it
- Sub-components used only within a file may be declared above the main component in the same file
- React 19 `use()` hook is used for context (see `AppContext.tsx`) — prefer it over `useContext`
- `<StrictMode>` is active — components must be side-effect-safe under double-render

### Hooks and effects

```tsx
const [count, setCount] = useState(0);

useEffect(() => {
  const sub = relay.subscribe(filters);
  return () => sub.close();   // always return cleanup
}, [relay]);
```

---

## Project Structure

```
src/
├── main.tsx              # Entry point — BrowserRouter + StrictMode
├── App.tsx               # Root providers + route tree
├── index.css             # Tailwind + DaisyUI import (do not restructure)
├── context/              # React context + providers
│   └── AppContext.tsx    # AppProvider, useApp, PageDefinition type
├── lib/                  # Singleton instances and pure utilities
│   ├── accounts.ts       # AccountManager (session-only, no localStorage)
│   ├── factory.ts        # EventFactory wired to manager.signer
│   ├── relay.ts          # RelayPool + DEFAULT_RELAYS + LOOKUP_RELAYS
│   ├── store.ts          # EventStore + eventLoader
│   └── primal.ts         # PrimalCache for search
└── pages/
    ├── pages.tsx         # PAGES registry — add new diagnostic pages here
    ├── Page1.tsx         # First diagnostic page (template)
    └── SignIn/           # Sign-in flow (layout + method pages)
```

**Adding a diagnostic page:** register it in `src/pages/pages.tsx`; the `next()` context method walks the array in order.

---

## Styling

Tailwind CSS v4 + DaisyUI v5. Utility-first; avoid custom CSS.

```css
/* src/index.css — do not modify this pattern */
@import "tailwindcss";
@plugin "daisyui";
```

- Reach for **DaisyUI classes** (`btn`, `card`, `input`, `modal`, `loading`, etc.) before raw Tailwind utilities
- Responsive: use Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`)
- Dark mode: controlled by `data-theme` on `<html>` (DaisyUI)
- Conditional class merging pattern used in codebase:
  ```tsx
  className={['base-class', condition ? 'extra' : ''].filter(Boolean).join(' ')}
  ```

---

## Nostr / Applesauce Patterns

Never construct, sign, or parse Nostr events manually. Use applesauce exclusively.

```ts
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core/event-factory";
import { RelayPool } from "applesauce-relay";
import { AccountManager } from "applesauce-accounts";
import { ExtensionSigner } from "applesauce-signers";
```

- `eventStore` (singleton in `lib/store.ts`) — all event storage and reactive queries
- `pool` (singleton in `lib/relay.ts`) — all relay connections
- `manager` (singleton in `lib/accounts.ts`) — account management; no localStorage persistence
- `factory` (singleton in `lib/factory.ts`) — event signing via `manager.signer` (ProxySigner)
- Relay/network errors from `applesauce-relay` are RxJS Observable errors — handle with `catchError`

Consult the applesauce MCP server for API details. Consult the nostr MCP for NIP specs before implementing any protocol feature.

---

## Error Handling

- Use explicit error types; avoid `unknown`/`any` in catch blocks
- User-facing errors must surface in UI state — not `console.error` alone
- Never swallow errors silently
- Read-only mode: unsigned `EventTemplate` objects are collected in `draftEvents` (see `AppContext`) rather than published directly

---

## Pre-commit Checklist

1. `pnpm build` — zero TypeScript errors
2. `pnpm lint` — zero ESLint errors
3. No `console.log` left in committed code
4. No unused imports or variables
5. All type-only imports use `import type`
6. `useEffect` cleanups return a teardown function
