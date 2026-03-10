import { BehaviorSubject } from "rxjs";
import type { EventTemplate } from "applesauce-core/helpers";

/**
 * A fully decoded referral pack fetched from a Blossom server.
 * Written by the /ref/:sha256 page after a successful fetch+decode.
 * Cleared after the user publishes the events.
 */
export type DecodedReferralPack = {
  /** sha256 of the blob — used to skip re-fetch on sign-in return */
  sha256: string;
  /** hex pubkey of the account the fixes are intended for */
  subjectPubkey: string;
  /** decoded event templates with pubkey already injected */
  events: (EventTemplate & { pubkey: string })[];
};

/**
 * Holds the currently loaded referral pack, or null if none.
 * Persists across sign-in navigation so the /ref page never needs
 * to re-fetch after the user returns from the sign-in flow.
 */
export const referralPack$ = new BehaviorSubject<DecodedReferralPack | null>(
  null,
);
