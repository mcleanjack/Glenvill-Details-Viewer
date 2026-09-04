import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE_NAMES, isLocalHost, serializeCookie, type SessionKind } from '../_lib/session.js'

/** Logs out of either area — POST { kind: 'owner' | 'presentation' }. Only ever clears the one
 * cookie asked for, so logging out of the Presentation section can never touch an owner session
 * (or vice versa) even if both happen to be present in the same browser. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const kind = req.body?.kind as SessionKind | undefined
  if (kind !== 'owner' && kind !== 'presentation') {
    res.status(400).json({ error: 'Invalid kind' })
    return
  }
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAMES[kind], '', { clear: true, secure: !isLocalHost(req.headers.host) }))
  res.status(200).json({ ok: true })
}
