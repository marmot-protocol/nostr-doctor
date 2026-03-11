/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { TimeoutConfig } from "rxjs";
import { delay, of, Subject } from "rxjs";
import { timeoutWithIgnore } from "../timeout-with-ignore.ts";

describe("timeoutWithIgnore", () => {
  it("passes through only-ignored values and completes without timing out", async () => {
    const source$ = of(undefined, undefined, undefined).pipe(delay(10));
    const ignore = (v: unknown) => v === undefined;
    const config: TimeoutConfig<undefined> = {
      first: 50,
      with: () => of(undefined),
    };

    const result = await new Promise<{
      values: unknown[];
      completed: boolean;
      error?: unknown;
    }>((resolve) => {
      const values: unknown[] = [];
      source$.pipe(timeoutWithIgnore({ ...config, ignore })).subscribe({
        next: (v) => values.push(v),
        complete: () => resolve({ values, completed: true }),
        error: (e) => resolve({ values, completed: false, error: e }),
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(result.values).toEqual([undefined, undefined, undefined]);
  });

  it("times out when first non-ignored value is too late", async () => {
    const source$ = of(undefined, "late").pipe(delay(100));
    const ignore = (v: unknown) => v === undefined;
    const fallback = "timeout-fallback";
    const config: TimeoutConfig<string | undefined> = {
      first: 30,
      with: () => of(fallback),
    };

    const result = await new Promise<{
      values: unknown[];
      completed: boolean;
      error?: unknown;
    }>((resolve) => {
      const values: unknown[] = [];
      source$.pipe(timeoutWithIgnore({ ...config, ignore })).subscribe({
        next: (v) => values.push(v),
        complete: () => resolve({ values, completed: true }),
        error: (e) => resolve({ values, completed: false, error: e }),
      });
    });

    // Timeout fires before "late" arrives → we get fallback; may or may not get undefined first (race)
    expect(result.values).toContain(fallback);
    expect(result.completed).toBe(true);
  });

  it("passes through non-ignored values when they arrive within timeout", async () => {
    const sub = new Subject<string | undefined>();
    const ignore = (v: string | undefined) => v === undefined;
    const config: TimeoutConfig<string | undefined> = {
      first: 200,
      each: 200,
      with: () => of("timeout"),
    };

    const result = await new Promise<{
      values: (string | undefined)[];
      completed: boolean;
    }>((resolve) => {
      const values: (string | undefined)[] = [];
      sub.pipe(timeoutWithIgnore({ ...config, ignore })).subscribe({
        next: (v) => values.push(v),
        complete: () => resolve({ values, completed: true }),
        error: () => resolve({ values, completed: false }),
      });

      sub.next(undefined);
      setTimeout(() => sub.next("a"), 20);
      setTimeout(() => sub.next(undefined), 40);
      setTimeout(() => sub.next("b"), 60);
      setTimeout(() => sub.complete(), 80);
    });

    expect(result.completed).toBe(true);
    expect(result.values).toEqual([undefined, "a", undefined, "b"]);
  });

  it("emits values in source order (merge of timeout and ignore branches)", async () => {
    const sub = new Subject<"ignore" | "count">();
    const ignore = (v: "ignore" | "count") => v === "ignore";
    const config: TimeoutConfig<"ignore" | "count"> = {
      first: 500,
      with: () => of("count"),
    };

    const result = await new Promise<{ values: ("ignore" | "count")[] }>(
      (resolve) => {
        const values: ("ignore" | "count")[] = [];
        sub.pipe(timeoutWithIgnore({ ...config, ignore })).subscribe({
          next: (v) => values.push(v),
          complete: () => resolve({ values }),
        });
        sub.next("ignore");
        sub.next("count");
        sub.next("ignore");
        sub.next("count");
        sub.complete();
      },
    );

    expect(result.values).toEqual(["ignore", "count", "ignore", "count"]);
  });

  it("only ignored values completing within first window do not trigger timeout", async () => {
    // Complete before first timeout so we never time out; only ignored values
    const sub = new Subject<number>();
    const ignore = (v: number) => v === 0;
    const config: TimeoutConfig<number> = {
      first: 200,
      with: () => of(-1),
    };

    const result = await new Promise<{
      values: number[];
      completed: boolean;
      error?: unknown;
    }>((resolve) => {
      const values: number[] = [];
      sub.pipe(timeoutWithIgnore({ ...config, ignore })).subscribe({
        next: (v) => values.push(v),
        complete: () => resolve({ values, completed: true }),
        error: (e) => resolve({ values, completed: false, error: e }),
      });

      sub.next(0);
      setTimeout(() => sub.next(0), 20);
      setTimeout(() => sub.next(0), 40);
      setTimeout(() => sub.complete(), 60);
    });

    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(result.values).toEqual([0, 0, 0]);
  });
});
