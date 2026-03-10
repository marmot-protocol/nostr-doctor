import { Navigate } from "react-router";
import { pagePath } from "../../lib/routing.ts";
import REPORTS from "../reports.tsx";

// ---------------------------------------------------------------------------
// ReportsIndex — mounted at /r
//
// Redirects to the first report in the sequence.
// RequireSubject guards this route, so if no subject pubkey is set the user
// is already redirected to / before this component renders.
// ---------------------------------------------------------------------------

function ReportsIndex() {
  return <Navigate to={pagePath(REPORTS[0].name)} replace />;
}

export default ReportsIndex;
