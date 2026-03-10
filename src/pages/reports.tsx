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
    Component: lazy(() => import("./reports/profile-metadata.tsx")),
  },
  {
    name: "outbox-relay-health",
    Component: lazy(() => import("./reports/outbox-relays-health.tsx")),
  },
  {
    name: "follow-list-relays",
    Component: lazy(() => import("./reports/follow-list-relays.tsx")),
  },
  {
    name: "metadata-broadcast",
    Component: lazy(() => import("./reports/metadata-broadcast.tsx")),
  },
];

export default REPORTS;
