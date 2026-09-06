import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "rxjs";
import type { NostrEvent } from "applesauce-core/helpers";
import { validateInWorker } from "../validate-in-worker.ts";
import type { KeyPackageValidation } from "../key-package-validation.ts";
import { KEY_PACKAGE_VALIDATION_TIMEOUT_MS } from "../../timeouts.ts";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: KeyPackageValidation }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
const subscriptions: Subscription[] = [];
const event = { content: "AQIDBA==" } as NostrEvent;
const valid: KeyPackageValidation = { status: "valid", checks: [] };
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  subscriptions.splice(0).forEach((s) => s.unsubscribe());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const subscribe = () => {
  const results: KeyPackageValidation[] = [];
  const sub = validateInWorker(event, "a".repeat(64)).subscribe((v) =>
    results.push(v),
  );
  subscriptions.push(sub);
  return { sub, results };
};
describe("bounded validation workers", () => {
  it("runs at most two workers and starts queued validation when one finishes", () => {
    const first = subscribe();
    subscribe();
    const third = subscribe();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[0].onmessage!({ data: valid });
    expect(first.results).toEqual([valid]);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(3);
    FakeWorker.instances[2].onmessage!({ data: valid });
    expect(third.results).toEqual([valid]);
  });
  it("terminates stalled work and reports uncertainty, not a bad package", () => {
    const { results } = subscribe();
    vi.advanceTimersByTime(KEY_PACKAGE_VALIDATION_TIMEOUT_MS);
    expect(results[0].status).toBe("unverified");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it("cancels queued jobs and running workers when a report is abandoned", () => {
    const first = subscribe();
    subscribe();
    const queued = subscribe();
    queued.sub.unsubscribe();
    first.sub.unsubscribe();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it("handles unavailable workers without crashing the report", () => {
    vi.stubGlobal("Worker", undefined);
    expect(subscribe().results[0].status).toBe("unverified");
  });
  it("handles a worker script error", () => {
    const { results } = subscribe();
    FakeWorker.instances[0].onerror!();
    expect(results[0].status).toBe("unverified");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
