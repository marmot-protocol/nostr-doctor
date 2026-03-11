// ---------------------------------------------------------------------------
// LoaderState — the wrapper type used by report page components.
//
// Loaders (loader.ts) return Observable<TState> — raw state streams with no
// complete flag. The page layer applies the toLoaderState() operator from
// src/observable/toLoaderState.ts to wrap the raw stream into LoaderState<T>.
//
// See src/pages/reports/LOADER_PATTERN.md for the full pattern reference.
// ---------------------------------------------------------------------------

/**
 * The wrapper type produced by the `toLoaderState()` operator.
 *
 * - `{ data, complete: false }` — a partial state emission mid-stream.
 *   The loader is still running; more updates may arrive.
 * - `{ data, complete: true }` — the final emission. The observable
 *   completes immediately after. The page switches from loading mode
 *   to report mode on this emission.
 *
 * The page derives its render mode from `loaderState?.complete`:
 *   - `undefined`        → observable not yet emitted (loading)
 *   - `complete: false`  → partial state, still streaming (loading)
 *   - `complete: true`   → final state, report ready
 */
export type LoaderState<T> = {
  /** Current accumulated state. May be partial while `complete` is false. */
  data: T;
  /**
   * True only on the final emission. The observable completes after this.
   * Pages use `!loaderState?.complete` as their `isLoading` flag.
   */
  complete: boolean;
};
