/**
 * Vercel Edge Middleware — the *real*, server-side route guard. Runs before the SPA's
 * `index.html` is ever served (see `vercel.json`'s catch-all rewrite), so a client hitting the
 * editor's URL directly — no JS, no UI — is redirected here, not just kept from seeing a link to
 * it. Two independent gates, matching the two independent cookies from `api/_lib/session.ts`:
 *
 *  - Anything under `/presentation` requires `presentation_session` (except its own login page).
 *  - Everything else (the owner's editor) requires `owner_session` (except `/login`).
 *
 * `/api/*` routes are exempted here and re-check the appropriate session themselves (see
 * `api/publish/*.ts`) — that keeps the "who can call which endpoint" rule in one place per
 * endpoint rather than duplicated in both this file and the handler, and avoids turning a JSON
 * fetch() failure into a confusing redirect-to-an-HTML-page response.
 */

import { COOKIE_NAMES, parseCookies, verifySessionToken } from './api/_lib/session.js'

export const config = {
  // Skip the SPA's own built assets — they must load regardless of which (or whether any)
  // session cookie is present, since both the owner UI and the presentation UI, and even the two
  // login screens, are served from the same bundle.
  matcher: ['/((?!assets/).*)'],
}

const PRESENTATION_PREFIX = '/presentation'
const PRESENTATION_LOGIN_PATH = '/presentation/login'
const OWNER_LOGIN_PATH = '/login'

function isStaticFile(pathname: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(pathname)
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)
  const { pathname } = url

  if (isStaticFile(pathname)) return undefined
  if (pathname.startsWith('/api/')) return undefined // each api handler re-checks its own session

  const secret = process.env.SESSION_SECRET
  const cookies = parseCookies(request.headers.get('cookie'))

  const inPresentationArea = pathname === PRESENTATION_PREFIX || pathname.startsWith(PRESENTATION_PREFIX + '/')

  if (inPresentationArea) {
    if (pathname === PRESENTATION_LOGIN_PATH) return undefined
    const ok = !!secret && (await verifySessionToken(cookies[COOKIE_NAMES.presentation], 'presentation', secret))
    if (!ok) return Response.redirect(new URL(PRESENTATION_LOGIN_PATH, url), 302)
    return undefined
  }

  if (pathname === OWNER_LOGIN_PATH) return undefined
  const ok = !!secret && (await verifySessionToken(cookies[COOKIE_NAMES.owner], 'owner', secret))
  if (!ok) return Response.redirect(new URL(OWNER_LOGIN_PATH, url), 302)
  return undefined
}
