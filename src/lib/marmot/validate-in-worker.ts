import { Observable, type Subscriber } from "rxjs";
import type { NostrEvent } from "applesauce-core/helpers";
import type { KeyPackageValidation } from "./key-package-validation.ts";
import { KEY_PACKAGE_VALIDATION_TIMEOUT_MS } from "../timeouts.ts";
import { MAX_KEY_PACKAGE_BYTES } from "./validation-types.ts";

// Bound worker count across concurrent/StrictMode report subscriptions.
const queue: Array<() => void> = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) queue.shift()!();
}
function unavailable(
  subscriber: Subscriber<KeyPackageValidation>,
  detail: string,
) {
  subscriber.next({
    status: "unverified",
    checks: [
      {
        id: "validation",
        label: "Public KeyPackage validation",
        status: "unverified",
        detail,
        remedy: "Retry this diagnostic in a current browser.",
      },
    ],
  });
  subscriber.complete();
}

export function validateInWorker(event: NostrEvent, pubkey: string) {
  return new Observable<KeyPackageValidation>((subscriber) => {
    if (event.content.length > Math.ceil(MAX_KEY_PACKAGE_BYTES / 3) * 4) {
      unavailable(
        subscriber,
        "Package exceeds Doctor's 64 KiB validation limit.",
      );
      return;
    }
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    let released = false;
    function release() {
      if (released) return;
      released = true;
      clearTimeout(timer);
      worker?.terminate();
      if (started) running--;
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      pump();
    }
    function start() {
      started = true;
      running++;
      try {
        worker = new Worker(
          new URL("./validation.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (message: MessageEvent<KeyPackageValidation>) => {
          subscriber.next(message.data);
          subscriber.complete();
          release();
        };
        worker.onerror = () => {
          unavailable(
            subscriber,
            "The validation worker failed to start or run.",
          );
          release();
        };
        timer = setTimeout(() => {
          unavailable(
            subscriber,
            "KeyPackage validation exceeded its time limit.",
          );
          release();
        }, KEY_PACKAGE_VALIDATION_TIMEOUT_MS);
        worker.postMessage({
          event,
          pubkey,
          now: Math.floor(Date.now() / 1000),
        });
      } catch {
        unavailable(
          subscriber,
          "This browser could not start the KeyPackage validator.",
        );
        release();
      }
    }
    queue.push(start);
    pump();
    return release;
  });
}
