// ---------------------------------------------------------------------------
// REPORT_SECTIONS — ordered registry of all diagnostic accordion sections.
// ---------------------------------------------------------------------------

import type { ReportSectionDefinition } from "./accordion-types.ts";

import { createLoader as createProfileMetadataLoader } from "./profile-metadata/loader.ts";
import { ReportContent as ProfileMetadataContent } from "./profile-metadata/page.tsx";

import deadRelaysLoader from "./dead-relays/loader.ts";
import { ReportContent as DeadRelaysContent } from "./dead-relays/page.tsx";

import { createLoader as createKeyPackageRelaysLoader } from "./key-package-relays/loader.ts";
import { ReportContent as KeyPackageRelaysContent } from "./key-package-relays/page.tsx";

import { createLoader as createFollowListRelaysLoader } from "./follow-list-relays/loader.ts";
import { ReportContent as FollowListRelaysContent } from "./follow-list-relays/page.tsx";

import { createLoader as createMetadataBroadcastLoader } from "./metadata-broadcast/loader.ts";
import { ReportContent as MetadataBroadcastContent } from "./metadata-broadcast/page.tsx";

import { createLoader as createBlossomServersLoader } from "./blossom-servers/loader.ts";
import { ReportContent as BlossomServersContent } from "./blossom-servers/page.tsx";

import { createLoader as createKeyPackagesLoader } from "./key-packages/loader.ts";
import { ReportContent as KeyPackagesContent } from "./key-packages/page.tsx";

import { createLoader as createLegacyCleanupLoader } from "./marmot-legacy-cleanup/loader.ts";
import LegacyCleanupContent from "./marmot-legacy-cleanup/page.tsx";

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
    name: "follow-list-relays",
    label: "Follow List Relays",
    description: "Checks for embedded relay data in your kind:3 follow list",
    createLoader: createFollowListRelaysLoader,
    Component: FollowListRelaysContent,
  },
  {
    name: "relay-health",
    label: "Relay Health",
    description:
      "Checks connectivity, NIP-50 search, and DM auth across your main relay lists",
    createLoader: deadRelaysLoader,
    Component: DeadRelaysContent,
  },
  {
    name: "marmot-key-package-relays",
    label: "Marmot Relay Discovery",
    description:
      "Checks NIP-65 publication relays and kind 10050 Welcome inboxes",
    createLoader: createKeyPackageRelaysLoader,
    Component: KeyPackageRelaysContent,
  },
  {
    name: "metadata-broadcast",
    label: "Metadata Broadcast",
    description: "Checks whether your metadata events are on all your relays",
    createLoader: createMetadataBroadcastLoader,
    Component: MetadataBroadcastContent,
  },
  {
    name: "blossom-servers",
    label: "Blossom Servers",
    description: "Checks whether your Blossom servers respond to HTTP GET /",
    createLoader: createBlossomServersLoader,
    Component: BlossomServersContent,
  },
  {
    name: "key-packages",
    label: "Marmot KeyPackages",
    description: "Decodes and validates current kind 30443 KeyPackages",
    createLoader: createKeyPackagesLoader,
    Component: KeyPackagesContent,
  },
  {
    name: "marmot-legacy-cleanup",
    label: "Legacy Marmot Cleanup",
    description: "Finds obsolete kind 443 and 10051 events for deletion",
    createLoader: createLegacyCleanupLoader,
    Component: LegacyCleanupContent,
  },
];

export default REPORT_SECTIONS;
