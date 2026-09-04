import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE_NAMES, createSessionToken, isLocalHost, serializeCookie, timingSafeEqual } from '../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.SESSION_SECRET
  const ownerPassword = process.env.OWNER_PASSWORD
  if (!secret || !ownerPassword) {
    res.status(500).json({ error: 'Server is not configured (missing SESSION_SECRET or OWNER_PASSWORD).' })
    return
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  console.log('[owner-login debug]', {
    submittedLength: password.length,
    envLength: ownerPassword.length,
    exactMatch: password === ownerPassword,
    trimmedMatch: password.trim() === ownerPassword.trim(),
  })
  if (!password || !(await timingSafeEqual(password, ownerPassword))) {
    res.status(401).json({ error: 'Incorrect password.' })
    return
  }

  const token = await createSessionToken('owner', secret)
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAMES.owner, token, { secure: !isLocalHost(req.headers.host) }))
  res.status(200).json({ ok: true })
}
