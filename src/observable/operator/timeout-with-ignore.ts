import {
  endWith,
  filter,
  ignoreElements,
  merge,
  share,
  takeUntil,
  timeout,
  type ObservableInput,
  type ObservedValueOf,
  type OperatorFunction,
  type TimeoutConfig,
} from "rxjs";

/**
 * Like RxJS timeout, but only starts the timer for values which do NOT match ignoreFn.
 * When an ignored value is emitted, the timeout clears/resets and does not trigger for those.
 *
 * Example usage:
 *
 *   source$.pipe(
 *     timeoutWithIgnore(
 *       {
 *         first: 1500,
 *         each: 1000,
 *         with: () => of(null),
 *       },
 *       value => value === undefined
 *     )
 *   )
 *
 * @param config Standard RxJS timeout config (object form, not legacy form)
 * @param ignore Predicate — when true, disables or resets the timer for this emission
 */
export function timeoutWithIgnore<
  T,
  O extends ObservableInput<unknown> = ObservableInput<T>,
  M = unknown,
>(
  config: TimeoutConfig<T, O, M> & {
    ignore: unknown[] | ((value: T) => boolean);
  },
): OperatorFunction<T, T | ObservedValueOf<O>> {
  return (source) => {
    // Use share() to prevent multiple subscriptions
    const base$ = source.pipe(share());

    // Create a method for filtering ignored values
    const ignore = (v: T) =>
      typeof config.ignore === "function"
        ? config.ignore(v)
        : config.ignore.includes(v);

    // Create timeout stream
    const timeout$ = base$.pipe(
      filter((v) => !ignore(v)),
      timeout(config),
      share(),
    );

    // Create stream of ignored values
    const ignore$ = base$.pipe(filter(ignore));

    // Merge the timeout and ignore streams
    return merge(timeout$, ignore$).pipe(
      // Take until the timeout stream completes
      takeUntil(timeout$.pipe(ignoreElements(), endWith(true))),
    );
  };
}
