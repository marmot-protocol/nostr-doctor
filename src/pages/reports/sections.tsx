// ---------------------------------------------------------------------------
// REPORT_SECTIONS — ordered registry of all diagnostic accordion sections.
//
// Each entry includes:
//   - name/label/description for the accordion header UI
//   - createLoader — called once per page mount to start the RxJS stream
//   - Component    — renders the section body, receives loaderState as a prop
// ---------------------------------------------------------------------------

import type { ReportSectionDefinition } from "./accordion-types.ts";

import { createLoader as createProfileMetadataLoader } from "./profile-metadata/loader.ts";
import { ReportContent as ProfileMetadataContent } from "./profile-metadata/page.tsx";

import deadRelaysLoader from "./dead-relays/loader.ts";
import { ReportContent as DeadRelaysContent } from "./dead-relays/page.tsx";

import { createLoader as createDmRelayAuthLoader } from "./dm-relay-auth/loader.ts";
import { ReportContent as DmRelayAuthContent } from "./dm-relay-auth/page.tsx";

import { createLoader as createFollowListRelaysLoader } from "./follow-list-relays/loader.ts";
import { ReportContent as FollowListRelaysContent } from "./follow-list-relays/page.tsx";

import { createLoader as createMetadataBroadcastLoader } from "./metadata-broadcast/loader.ts";
import { ReportContent as MetadataBroadcastContent } from "./metadata-broadcast/page.tsx";

import { createLoader as createSearchRelayNip50Loader } from "./search-relay-nip50/loader.ts";
import { ReportContent as SearchRelayNip50Content } from "./search-relay-nip50/page.tsx";

import { createLoader as createKeyPackagesLoader } from "./key-packages/loader.ts";
import { ReportContent as KeyPackagesContent } from "./key-packages/page.tsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REPORT_SECTIONS: ReportSectionDefinition<any>[] = [
  {
    name: "profile-metadata",
    label: "Profile Metadata",
    description: "Checks for non-standard fields in your kind:0 profile event",
    createLoader: createProfileMetadataLoader,
    Component: ProfileMetadataContent,
  },
  {
    name: "dead-relays",
    label: "Dead Relays",
    description: "Checks online/offline status across all your relay lists",
    createLoader: deadRelaysLoader,
    Component: DeadRelaysContent,
  },
  {
    name: "dm-relay-auth",
    label: "DM Relay Auth",
    description: "Checks whether your DM relays enforce NIP-42 authentication",
    createLoader: createDmRelayAuthLoader,
    Component: DmRelayAuthContent,
  },
  {
    name: "follow-list-relays",
    label: "Follow List Relays",
    description: "Checks for embedded relay data in your kind:3 follow list",
    createLoader: createFollowListRelaysLoader,
    Component: FollowListRelaysContent,
  },
  {
    name: "metadata-broadcast",
    label: "Metadata Broadcast",
    description: "Checks whether your metadata events are on all your relays",
    createLoader: createMetadataBroadcastLoader,
    Component: MetadataBroadcastContent,
  },
  {
    name: "search-relay-nip50",
    label: "Search Relays",
    description: "Checks whether your search relays support NIP-50",
    createLoader: createSearchRelayNip50Loader,
    Component: SearchRelayNip50Content,
  },
  {
    name: "key-packages",
    label: "Key Packages",
    description: "Looks for MLS key packages (kind:443) across your key package relays",
    createLoader: createKeyPackagesLoader,
    Component: KeyPackagesContent,
  },
];

export default REPORT_SECTIONS;
