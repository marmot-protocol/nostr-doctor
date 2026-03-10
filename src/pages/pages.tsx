import { lazy } from 'react'
import type { PageDefinition } from '../context/AppContext.tsx'

// ---------------------------------------------------------------------------
// Page registry — add new diagnostic pages here in order.
// The next() context method walks this array sequentially.
// Each page is lazy-loaded for code-splitting.
// ---------------------------------------------------------------------------
const PAGES: PageDefinition[] = [
  { path: '/page/1', name: 'page1', Component: lazy(() => import('./Page1.tsx')) },
]

export default PAGES
