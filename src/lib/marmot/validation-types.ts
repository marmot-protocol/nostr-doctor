import type { NostrEvent } from "applesauce-core/helpers";
export const MAX_KEY_PACKAGE_BYTES = 65_536;
export type ValidationRequest = {
  event: NostrEvent;
  pubkey: string;
  now: number;
};
