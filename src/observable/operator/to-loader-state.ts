// ---------------------------------------------------------------------------
// toLoaderState — custom RxJS operator
//
// Wraps a raw loader Observable<T> into Observable<LoaderState<T>> for use
// in report page components.
//
// Behaviour:
//   - Each source emission is forwarded as { data, complete: false }
//   - When the source completes, the last emitted data is re-emitted as
//     { data, complete: true } and then the outer observable completes.
//   - If the source completes without emitting (e.g. all startWith() values
//     but the real fetch was cut by takeUntil), no terminal emission is sent —
//     loaders must always emit at least one value (use startWith on sources).
//   - Source errors are forwarded as-is; the page should wrap in catchError
//     if needed, or the loader should handle errors internally.
//
// Usage in a page component:
//
//   import { timer } from "rxjs";
//   import { takeUntil } from "rxjs/operators";
//   import { toLoaderState } from "../../observable/toLoaderState.ts";
//   import { EVENT_LOAD_TIMEOUT_MS } from "../../lib/timeouts.ts";
//
//   const loaderState = use$(
//     () =>
//       subject
//         ? createLoader(subject).pipe(
//             takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
//             toLoaderState(),
//           )
//         : undefined,
//     [subject?.pubkey],
//   );
// ---------------------------------------------------------------------------

import { Observable, type OperatorFunction } from "rxjs";
import type { LoaderState } from "../../pages/reports/loader-types.ts";

/**
 * RxJS operator that wraps a raw state observable into a `LoaderState<T>`
 * observable suitable for consumption by report page components.
 *
 * - Each source emission → `{ data, complete: false }`
 * - Source completion  → `{ data: lastData, complete: true }` then completes
 */
export function toLoaderState<T>(): OperatorFunction<T, LoaderState<T>> {
  return (source$: Observable<T>): Observable<LoaderState<T>> =>
    new Observable<LoaderState<T>>((subscriber) => {
      let lastData: T | undefined;

      const subscription = source$.subscribe({
        next(data) {
          lastData = data;
          subscriber.next({ data, complete: false });
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          // Only emit the terminal state if the source emitted at least once.
          // Loaders should always emit via startWith() so this is always true.
          if (lastData !== undefined) {
            subscriber.next({ data: lastData, complete: true });
          }
          subscriber.complete();
        },
      });

      return () => subscription.unsubscribe();
    });
}
