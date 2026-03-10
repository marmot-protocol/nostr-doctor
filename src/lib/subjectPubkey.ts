import { BehaviorSubject } from "rxjs";

/** Subject pubkey when diagnosing without signing in; cleared on start over. */
export const subjectPubkey$ = new BehaviorSubject<string | null>(null);
