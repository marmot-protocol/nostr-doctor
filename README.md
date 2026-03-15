# Nostr Doctor - nostr.doctor

## Overview

Nostr Doctor is a guided diagnostic and repair tool for Nostr users. Enter a pubkey (yours or someone else's), sign in if needed, and get a personalized flow to fix common issues: dead relays, bloated follow lists, oversized profile images, NIP-05 drift, poor indexer coverage, and more.

**Core Philosophy:**

- One issue at a time
- Boring, trustworthy design (white page, Typeform-style steps).
- Every button publishes a fix (signer-integrated).
- Referral links: Share pre-generated fixes for quick apply.
- Page-based mini-apps: Fetch once per step, discard after.
- Prioritize fixes dynamically (e.g., profile first if broken).
- Mobile/desktop, multi-auth (remote signers, etc.).
- Export unsigned events as ZIP or Blossom/HTT for bulk signing.

**Goal:** Clean up \"broken shit everywhere\" on Nostr—better UX, network health, marketing hook (\"I nuked your zombie relays!\").

## MVP Features

- **Relay Doctor:**
  - Counts per list type (2-5 recommended).
  - Liveness + NIP-66 RTT/ping (global monitors).
  - NIP-11 info (name, icon, desc, software).
  - Write ability (inbox auth challenges, esp. giftwrap).
  - Coverage diffs (% of recent 500 events per relay/indexer).
  - Dead relay alerts across all lists/NIP-05.

- **List Cleanups:**
  - Follow list: Remove relays, dead follows, garbage (groups/hashtags).
  - Skip mutes/other lists.
  - NIP-65 overlap checks.

- **Profile Fixes:**
  - Image optimization: Resize to 128px? WebP conversion, detect 10MB bloat.
  - Bad JSON/encoding validation.
  - Key packages: Broad relay fetch + count.

- **NIP-05/Well-Known:**
  - Relay drift detection (vs. dedicated lists).
  - Recommend removal (rarely used).

- **Blossom Servers:** Validate domain (no path), offline checks.

- **Advanced:**
  - Diff previews before publish.
  - Trust scores (event completeness).
  - \"Deeper\" expandable details.
  - Tag/share button: \"Fixed @pubkey's relays!\" + referral link.
  - Export unsigned events for referral/bulk fix.

## Planned Reports (Backlog)

### NIP-65 Relay List Size & Quality

Diagnose the user's kind:10002 relay list for hygiene issues: too many relays (NIP-65 recommends 2–4 per category), duplicate URLs appearing in both read and write, relays listed without a marker (implicitly both), and relays that are offline according to NIP-66 monitors. Offer to remove dead/duplicate entries and republish a trimmed list.

**NIP:** NIP-65 (kind:10002)
**Fix:** Republish kind:10002 with dead/duplicate relays removed.

---

### NIP-05 Identifier Verification

Fetch the user's `nip05` field from their kind:0 profile, hit the `/.well-known/nostr.json` endpoint, and verify: (a) the pubkey in the response matches the user's pubkey, (b) the endpoint is reachable with correct CORS headers (`Access-Control-Allow-Origin: *`), (c) the optional `relays` field in the response, if present, aligns with their NIP-65 relay list. Surface each failure mode clearly so the user knows exactly what is broken.

**NIP:** NIP-05, NIP-65
**Fix:** Informational only — points the user to what needs fixing on their server.

---

### Lightning Address / Zap Setup

Check kind:0 for `lud16` or `lud06`. If present, verify the resolved LNURL pay endpoint is reachable, returns `allowsNostr: true`, and has a valid `nostrPubkey`. All three must be true for the user to receive NIP-57 zaps. If `lud16`/`lud06` are absent, surface that as an issue. Silent LNURL misconfiguration is one of the most common reasons zaps fail.

**NIP:** NIP-57 (kind:9734, kind:9735)
**Fix:** Informational only — surfaces each layer of the zap stack that is broken or missing.

---

## UI/UX Notes

- One thing at a time (even one relay)—show each one-by-one.
- Fix via signer or export bundle of unsigned events (ZIP/Blossom/HTT) for referral/bulk signing.
- Use applesauce.
- DaisyUI components.
- **Relays**: Counts (per list type), liveness (dead alerts), quality (ping/RTT via NIP-66 global monitors), write ability (inbox/giftwrap auth), NIP-11 info (name/icon/desc).
