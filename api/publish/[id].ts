import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE_NAMES, parseCookies, verifySessionToken } from '../_lib/session.js'
import { getStorage } from '../_lib/storage.js'

async function isOwner(req: VercelRequest): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  const cookies = parseCookies(req.headers.cookie)
  return verifySessionToken(cookies[COOKIE_NAMES.owner], 'owner', secret)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' })
    return
  }

  if (!(await isOwner(req))) {
    res.status(403).json({ error: 'Owner session required' })
    return
  }

  const storage = getStorage()

  if (req.method === 'PATCH') {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : ''
    if (!label) {
      res.status(400).json({ error: 'label is required' })
      return
    }
    const existing = await storage.getMeta(id)
    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const glb = await storage.getGlb(id)
    if (!glb) {
      res.status(404).json({ error: 'Snapshot data missing' })
      return
    }
    const meta = await storage.put(id, glb, { ...existing, label, updatedAt: Date.now() })
    res.status(200).json(meta)
    return
  }

  if (req.method === 'DELETE') {
    await storage.remove(id)
    res.status(204).end()
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
