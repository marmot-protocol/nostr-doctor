// ---------------------------------------------------------------------------
// REPORT_SECTIONS — ordered registry of all diagnostic accordion sections.
// ---------------------------------------------------------------------------

import type { ReportSectionDefinition } from "./accordion-types.ts";

import { createLoader as createProfileMetadataLoader } from "./profile-metadata/loader.ts";
import { ReportContent as ProfileMetadataContent } from "./profile-metadata/page.tsx";

import deadRelaysLoader from "./dead-relays/loader.ts";
import { ReportContent as DeadRelaysContent } from "./dead-relays/page.tsx";

import { createLoader as createFollowListRelaysLoader } from "./follow-list-relays/loader.ts";
import { ReportContent as FollowListRelaysContent } from "./follow-list-relays/page.tsx";

import { createLoader as createMetadataBroadcastLoader } from "./metadata-broadcast/loader.ts";
import { ReportContent as MetadataBroadcastContent } from "./metadata-broadcast/page.tsx";

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
    name: "relay-health",
    label: "Relay Health",
    description: "Checks connectivity, NIP-50 search, and DM auth across all your relay lists",
    createLoader: deadRelaysLoader,
    Component: DeadRelaysContent,
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
    name: "key-packages",
    label: "Key Packages",
    description: "Looks for MLS key packages (kind:443) across your key package relays",
    createLoader: createKeyPackagesLoader,
    Component: KeyPackagesContent,
  },
];

export default REPORT_SECTIONS;
