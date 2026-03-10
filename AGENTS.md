# AGENTS.md — dr-nostr

Coding agent reference for the **dr-nostr** repository: a greenfield Nostr protocol client built with React 19, TypeScript, Vite, and the `applesauce` library suite.

---

## Project Overview

dr-nostr is a Nostr decentralized-social client. All Nostr protocol work goes through the `applesauce-*` packages (EventStore, Relay, Accounts, Signers, Common). The UI layer uses React 19 + Tailwind CSS v4 + DaisyUI v5. The `src/` directory is early-stage; components, hooks, and pages are yet to be built.

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

### Development

```bash
pnpm dev              # start Vite dev server (HMR enabled)
pnpm preview          # preview the production build locally
```

### Build

```bash
pnpm build            # type-check (tsc -b) then bundle (vite build)
```

The build runs `tsc -b`, which checks both `tsconfig.app.json` (src/) and `tsconfig.node.json` (vite.config.ts). Fix all type errors before committing.

### Lint

```bash
pnpm lint             # run ESLint across all .ts and .tsx files
```

Fix all lint errors before committing. The lint config uses ESLint 9 flat config format (`eslint.config.js`).

### Tests

**No test framework is currently configured.** When Vitest is added, the commands will be:

```bash
pnpm vitest run                          # run all tests once
pnpm vitest run src/path/to/file.test.ts # run a single test file
pnpm vitest                              # interactive watch mode
```

Use **Vitest** (not Jest) when adding tests — it integrates natively with Vite.

---

## TypeScript

The project uses strict TypeScript 5.9. These compiler options are **enforced as errors**:

| Option                             | Implication                                                |
| ---------------------------------- | ---------------------------------------------------------- |
| `strict: true`                     | All strict checks enabled; no implicit `any`               |
| `noUnusedLocals: true`             | Every declared local must be used                          |
| `noUnusedParameters: true`         | Every function parameter must be used or prefixed with `_` |
| `verbatimModuleSyntax: true`       | Type-only imports **must** use `import type`               |
| `erasableSyntaxOnly: true`         | No `const enum`, no `namespace`, no decorator metadata     |
| `noFallthroughCasesInSwitch: true` | Switch cases need explicit `break` or `return`             |

### Import syntax rules

```ts
// Type-only imports — required by verbatimModuleSyntax
import type { NostrEvent } from "nostr-tools";

// Local imports require file extensions
import App from "./App.tsx";
import { useStore } from "./hooks/useStore.ts";

// No `import React` needed — react-jsx transform handles it
```

### Unused parameters

Prefix with `_` to suppress unused-parameter errors:

```ts
function handler(_event: MouseEvent) {
  /* intentionally unused */
}
```

---

## Code Style

No Prettier is configured. Follow these conventions observed in the codebase and enforced by lint:

### Formatting

- **2-space indentation**
- **Single quotes** for strings
- **No semicolons** (in config files; follow the pattern in source files as established)
- Trailing newline at end of file

### Naming

| Entity                | Convention               | Example                             |
| --------------------- | ------------------------ | ----------------------------------- |
| React components      | PascalCase               | `UserProfile`, `NoteCard`           |
| Hooks                 | camelCase + `use` prefix | `useEventStore`, `useRelayPool`     |
| Functions / variables | camelCase                | `fetchProfile`, `eventStore`        |
| Constants             | UPPER_SNAKE or camelCase | `DEFAULT_RELAYS`, `maxRetries`      |
| CSS classes           | kebab-case               | `.note-card`, `.relay-status`       |
| Files (components)    | PascalCase               | `NoteCard.tsx`                      |
| Files (hooks/utils)   | camelCase                | `useEventStore.ts`, `formatDate.ts` |

### React components

```tsx
// Named function declaration, default export
function NoteCard({ event }: { event: NostrEvent }) {
  return <div className="note-card">...</div>;
}

export default NoteCard;
```

- Prefer **named function declarations** over arrow function components at the top level
- Use `export default` for the primary component in a file
- Use React 19 `use()` hook for promises/context where applicable
- `<StrictMode>` is enabled in `main.tsx` — components must be side-effect-safe in double-render

### State and hooks

```tsx
// Destructuring convention for useState
const [count, setCount] = useState(0);

// useEffect cleanup always returned
useEffect(() => {
  const sub = relay.subscribe(filters);
  return () => sub.close();
}, [relay]);
```

---

## Styling

Tailwind CSS v4 with DaisyUI v5. Use utility classes; avoid custom CSS unless necessary.

```css
/* src/index.css — global entrypoint, do not modify this pattern */
@import "tailwindcss";
@plugin "daisyui";
```

- Use **DaisyUI component classes** (`btn`, `card`, `modal`, etc.) before reaching for raw Tailwind utilities
- Responsive design: use Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`)
- Dark mode: DaisyUI handles theming via `data-theme` attribute on `<html>`

---

## Nostr / Applesauce Patterns

All Nostr protocol interaction goes through the `applesauce-*` packages. Never construct or parse Nostr events manually.

```ts
// Event storage and reactive queries
import { EventStore } from "applesauce-core";

// Relay connections
import { RelayPool } from "applesauce-relay";

// Account management
import { AccountManager } from "applesauce-accounts";

// Signers (NIP-07 browser extension, NIP-46 bunker, etc.)
import { ExtensionSigner } from "applesauce-signers";
```

Consult the applesauce MCP server (`https://mcp.applesauce.build/mcp`) for API details. Consult the nostr MCP server for NIP specifications before implementing any protocol feature.

---

## Project Structure (target layout as the app grows)

```
src/
├── main.tsx                  # App entry point — do not restructure
├── App.tsx                   # Root component and routing
├── components/               # Reusable UI components
│   └── <Feature>/
│       ├── ComponentName.tsx
│       └── index.ts          # barrel export
├── hooks/                    # Custom React hooks
├── pages/                    # Route-level page components
├── stores/                   # applesauce EventStore instances
├── relay/                    # RelayPool setup and helpers
├── signers/                  # Signer factory/management
├── lib/                      # Pure utility functions
└── assets/                   # Static assets
```

---

## Error Handling

- Prefer explicit error types over `unknown`/`any` in catch blocks
- Relay and network errors from `applesauce-relay` are Observable errors — handle in RxJS `catchError` operators
- User-facing errors should surface via UI state, not `console.error` alone
- Never swallow errors silently

---

## Pre-commit Checklist

Before marking any task complete:

1. `pnpm build` passes with zero TypeScript errors
2. `pnpm lint` passes with zero ESLint errors
3. No `console.log` left in committed code (use proper logging or remove)
4. No unused imports (compiler enforces this)
5. All `import type` used for type-only imports
