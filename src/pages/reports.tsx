import { lazy } from "react";
import type { PageDefinition as ReportPageDefinition } from "../context/ReportContext.tsx";

// ---------------------------------------------------------------------------
// Page registry — add new diagnostic pages here in order.
// The next() context method walks this array sequentially.
// Each page is lazy-loaded for code-splitting.
// ---------------------------------------------------------------------------
const REPORTS: ReportPageDefinition[] = [
  {
    name: "profile-metadata",
    Component: lazy(() => import("./reports/profile-metadata/page.tsx")),
  },
  {
    name: "dead-relays",
    Component: lazy(() => import("./reports/dead-relays/page.tsx")),
  },
  {
    name: "dm-relay-auth",
    Component: lazy(() => import("./reports/dm-relay-auth/page.tsx")),
  },
  {
    name: "follow-list-relays",
    Component: lazy(() => import("./reports/follow-list-relays/page.tsx")),
  },
  {
    name: "metadata-broadcast",
    Component: lazy(() => import("./reports/metadata-broadcast/page.tsx")),
  },
  {
    name: "search-relay-nip50",
    Component: lazy(() => import("./reports/search-relay-nip50/page.tsx")),
  },
];

export default REPORTS;
