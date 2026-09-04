import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE_NAMES, createSessionToken, isLocalHost, serializeCookie, timingSafeEqual } from '../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.SESSION_SECRET
  const accessCode = process.env.PRESENTATION_ACCESS_CODE
  if (!secret || !accessCode) {
    res.status(500).json({ error: 'Server is not configured (missing SESSION_SECRET or PRESENTATION_ACCESS_CODE).' })
    return
  }

  const code = typeof req.body?.code === 'string' ? req.body.code : ''
  console.log('[presentation-login debug]', {
    submittedLength: code.length,
    envLength: accessCode.length,
    exactMatch: code === accessCode,
    trimmedMatch: code.trim() === accessCode.trim(),
  })
  if (!code || !(await timingSafeEqual(code, accessCode))) {
    res.status(401).json({ error: 'Incorrect access code.' })
    return
  }

  const token = await createSessionToken('presentation', secret)
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAMES.presentation, token, { secure: !isLocalHost(req.headers.host) }))
  res.status(200).json({ ok: true })
}
