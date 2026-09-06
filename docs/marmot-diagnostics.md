# Marmot diagnostic coverage

Reviewed against Marmot commit
[`4a2bc65f8db5866cec3b2a127dedb37818eaf207`](https://github.com/marmot-protocol/marmot/tree/4a2bc65f8db5866cec3b2a127dedb37818eaf207)
on 2026-09-06. Doctor checks public account configuration and invitation material.
It does not need a private account key to validate public KeyPackages.

## What Doctor verifies

| Surface                | Checks and interpretation                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication relays     | Refreshes signed kind 10002 NIP-65 lists. Uses unmarked and `write` entries, excludes `read` entries, and searches lookup relays as a fallback.                                                                                                                                                                              |
| Inbox relays           | Refreshes signed kind 10050 lists with `relay` tags. These are NIP-17 inboxes, not private group-message relays.                                                                                                                                                                                                             |
| Relay URLs             | Absolute `ws`/`wss`, host present, no credentials or fragment, valid UTF-8, at most 512 bytes. Validates raw signed text before connection normalization.                                                                                                                                                                    |
| Relay observations     | NIP-66 monitor results; NIP-11 NIP-09 advertisement on KeyPackage write relays. Missing advertisements are inconclusive. Monitoring can be stale; no write or deletion success is inferred.                                                                                                                                  |
| Gift wraps             | Nostr signatures and recipient-filter matching for kind 1059. Authentication-required inboxes are expected, not broken. Opaque gift wraps can contain private messages or Welcomes; their contents and eventual delivery are not inferred.                                                                                   |
| Signed publications    | Kind 30443, account author and Nostr signature. Ignores cached/fake verification marks used by local draft previews.                                                                                                                                                                                                         |
| Public tags            | Canonical padded base64, singleton `d`/`i`/version, 32-byte lowercase-hex slot, canonical distinct id lists, current v2 component advertisement. Rejects legacy `encoding` and per-package `relays` tags.                                                                                                                    |
| MLS framing            | Exactly one complete MLS 1.0 `MLSMessage` with `mls_key_package` wire format. Re-encoding must preserve every byte; truncated data, trailing bytes, noncanonical lengths, bare structs and private bundles fail.                                                                                                             |
| MLS signatures         | Verifies both LeafNode and KeyPackage signatures with the package's declared suite. Supports all seven standard RFC 9420 suites using maintained cryptographic primitives.                                                                                                                                                   |
| Public keys            | Validates public encryption key encodings/curve points, rejects low-order/unusable keys and identical init/leaf keys. Checks signing-key formats.                                                                                                                                                                            |
| Account identity       | BasicCredential contains the raw, valid 32-byte x-only secp256k1 account identity and matches the Nostr author.                                                                                                                                                                                                              |
| Identity proof v2      | Correct LeafNode dictionary location, support entry, 104-byte proof and signer identity. Reconstructs the exact local kind 450 template through applesauce and verifies the account's BIP-340 signature over that exact MLS key/ciphersuite binding. No arbitrary proof-age limit. Never publishes the proof template.       |
| KeyPackageRef          | Recomputes the reference over the inner KeyPackage and compares it with `i`.                                                                                                                                                                                                                                                 |
| Lifetime               | Inclusive current validity and maximum duration 7,261,200 seconds (84 days + 1 hour). Warns within seven days of expiry. NIP-40 relay expiration is checked separately.                                                                                                                                                      |
| Capabilities           | MLS 1.0, actual suite, BasicCredential, extension `0x0006`, proposal `0x0008`, and component `0x8009`; validates extension placement and decoded/public advertisement consistency. Rejects default MLS extension/proposal types incorrectly advertised as non-default capabilities. Unknown/GREASE values remain extensible. |
| Component dictionaries | Canonical TLS vectors, sorted unique entries/support ids, valid known component locations. Distinguishes LeafNode data from KeyPackage-level data.                                                                                                                                                                           |
| Last-resort packages   | Recognizes the empty-data component `0x0004` in the KeyPackage dictionary. Shows reuse as an improvement opportunity; it does not relax lifetime or identity checks.                                                                                                                                                         |
| Revision inventory     | Shows every observed revision, including broken newer ones. Selects the newest verified active candidate in each `(pubkey, kind, d)` slot, with lower event id on timestamp ties. Slot identity is not authenticated device identity.                                                                                        |
| Deletion requests      | Valid same-author kind 5 evidence. Exact `e` targets have no timestamp bound; `a` targets apply through the request timestamp. Requests do not prove relay erasure. User-selected cleanup emits only exact event-id targets so it cannot delete another revision by slot address.                                            |
| Legacy data            | Kinds 443 and 10051 are fetched only by the dedicated Legacy Marmot Cleanup section. Current relay and KeyPackage reports never fetch or assess legacy data.                                                                                                                                                                 |

Warnings identify missing support for admin policy, Nostr group routing, and group
lifecycle, as well as near expiry, last-resort reuse, incomplete retrieval, and
publication coverage gaps. These explain compatibility or maintenance concerns
without equating every optional feature with malformed MLS. A group requiring a
missing capability cannot add that package. Fetching from every relay is not a
Marmot interoperability requirement.

The public `app_components` tag advertises Marmot components and need not equal
the entire signed MLS support list. Every advertised id must occur in the signed
LeafNode support list, and the tag must include `0x8009`. Upstream component
`0x0001` may be omitted from the tag but must remain in the signed support list.
Component structure and the `0x8009` identity proof are validated independently;
group compatibility uses the signed support list, not the public tag subset.

The final section outcome distinguishes verified public candidates, invalid
publications, and incomplete checks. Unverified packages never become green
because a request timed out. Cleanup does not claim to rotate a package or erase
private keys.

## Legacy cleanup

The dedicated cleanup section searches signed kind 443 and 10051 events on lookup
and NIP-65 write relays, then follows valid relay URLs in every legacy list found
there, including older revisions. It preserves events received before a timeout,
deduplicates by event id, and flags incomplete searches. No legacy MLS decoding or
legacy relay-health checks are performed.

“Delete all legacy data” submits NIP-09 requests for all observed legacy events.
Requests use exact `e` targets and `k` tags, with at most 100 ids per source-relay
batch. The current 30443 packages and 10050 inbox list are never cleanup targets.
Standard event-reference relay hints survive draft/referral serialization, so
signed-out users can queue cleanup and later publish it to the old source relays.
Rejected or missing source-relay acknowledgements are errors; retries attempt only
failed batches. A successful request does not establish erasure, and cleanup does
not guarantee discovery of every historical copy across the network.

## Implementation and limits

The implementation uses pinned `ts-mls@2.0.0-rc.16` for MLS parsing, canonical
serialization, signature domain separation and reference hashing, and pinned
Noble 2.2 cryptographic primitives. The small patch in `patches/` exposes existing
upstream functions through a narrow `ts-mls/diagnostics` entrypoint. It changes no
upstream parser or cryptographic algorithm. The exact dependency and patch are
locked; changes need the regression/vector checks below. The upstream dependency
is a release candidate, and this integration is not an independent security audit.

Marmot's draft-10 component dictionary and identity-proof rules are a local
validation layer over MLS. See `src/lib/marmot/`. Full group state is never
created just to inspect a package.

At most two browser workers run concurrently, with a five-second budget per
package and a 64 KiB decoded input limit. Worker failure, unsupported ciphersuites,
resource limits, and unfinished validation produce **unverified** results. These
are Doctor limits, not protocol-invalidity claims. The normal report deadline can
leave some packages unverified; it retains completed checks and partial network
results. List discovery bypasses the loader cache; an empty shared-loader
completion is inconclusive because that loader can suppress upstream errors.
Discovery does not prove global freshness or complete relay retention.

Public validation cannot establish private `init_key` possession or deletion,
actual Welcome decryption/acceptance, client runtime health, successful publication
to every relay, compatibility with a particular private group's full membership
and policies, convergence, or restart durability. Group kind 445 routing uses
private authenticated group state. Kind 444 rumors require NIP-59 unwrapping.
Authorization-proof kinds 450, 451 and 452 are local templates, not relay probes.
Doctor neither asks for private keys nor sends test invitations to establish
these properties.

## Sources and regression evidence

- [Nostr transport](https://github.com/marmot-protocol/marmot/blob/4a2bc65f8db5866cec3b2a127dedb37818eaf207/transports/nostr.md)
- [KeyPackage validity and lifecycle](https://github.com/marmot-protocol/marmot/blob/4a2bc65f8db5866cec3b2a127dedb37818eaf207/foundation/key-packages.md)
- [Identity proof v2](https://github.com/marmot-protocol/marmot/blob/4a2bc65f8db5866cec3b2a127dedb37818eaf207/app-components/account-identity-proof-v2.md)
- [Component model](https://github.com/marmot-protocol/marmot/blob/4a2bc65f8db5866cec3b2a127dedb37818eaf207/app-components/README.md)
- [Registries](https://github.com/marmot-protocol/marmot/blob/4a2bc65f8db5866cec3b2a127dedb37818eaf207/foundation/registries.md)
- [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html), especially sections 7.2, 7.3 and 10.1
- [MLS extensions draft 10](https://www.ietf.org/archive/id/draft-ietf-mls-extensions-10.html)
- [MLS Working Group public vectors](https://github.com/mlswg/mls-implementations/blob/cfd450286d1bfd9cd2519b95c80f9771f94a5b1a/test-vectors/passive-client-welcome.json)

`pnpm test` runs Vitest. Tests cover valid signed current-profile packages across
all seven standard suites; independent MLS Working Group signatures and reference
hashes; tampered signatures/proofs, wrong identities, malformed dictionaries,
invalid lifetimes/keys, unknown suites, tag mismatch, candidate revision selection,
relay failures/authentication, partial rendering, worker concurrency/cancellation,
and final summary classification. A local real-browser smoke check also exercised
the actual worker and report UI with valid and forged-proof packages. Existing
live-relay tests depend on external relay availability and may be intermittent.
