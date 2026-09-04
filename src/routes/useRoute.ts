import { useCallback, useEffect, useState } from 'react'

/**
 * Minimal client-side "router" — just enough to switch between the owner editor (`/`), its login
 * screen (`/login`), and the Presentation section (`/presentation/*`) without pulling in a routing
 * library. This does *not* enforce access on its own: `middleware.ts` already guarantees the
 * browser can't get an HTML response for a protected path without the right session cookie, so by
 * the time any of this client code runs, the server has already decided the visitor is allowed to
 * be looking at whatever `pathname` currently is.
 */
export function useRoute() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, '', to)
    setPathname(to)
  }, [])

  return { pathname, navigate }
}
