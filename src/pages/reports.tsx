import { lazy } from "react";
import type { PageDefinition as ReportPageDefinition } from "../context/AppContext.tsx";

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
];

export default REPORTS;
