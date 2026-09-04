import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE_NAMES, parseCookies, verifySessionToken } from '../../_lib/session.js'
import { getStorage } from '../../_lib/storage.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const id = req.query.id
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' })
    return
  }

  const secret = process.env.SESSION_SECRET
  const cookies = parseCookies(req.headers.cookie)
  const authorized =
    !!secret &&
    ((await verifySessionToken(cookies[COOKIE_NAMES.owner], 'owner', secret)) ||
      (await verifySessionToken(cookies[COOKIE_NAMES.presentation], 'presentation', secret)))
  if (!authorized) {
    res.status(403).json({ error: 'Not authorized' })
    return
  }

  const storage = getStorage()
  const glb = await storage.getGlb(id)
  if (!glb) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.setHeader('Content-Type', 'model/gltf-binary')
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(200).send(Buffer.from(glb))
}
