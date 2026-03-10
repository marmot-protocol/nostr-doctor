import { BehaviorSubject } from "rxjs";
import type { EventTemplate } from "applesauce-core/helpers";

/**
 * Unsigned EventTemplate objects collected during the report flow (read-only mode)
 * or loaded from a referral pack. Persists across navigation and sign-in redirects.
 * Cleared after events are published or the user starts over.
 */
export const draftEvents$ = new BehaviorSubject<EventTemplate[]>([]);
