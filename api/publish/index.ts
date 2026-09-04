import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { COOKIE_NAMES, parseCookies, verifySessionToken } from '../_lib/session.js'
import { getStorage, type BuildStageSummary } from '../_lib/storage.js'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
}

interface PublishRequestMeta {
  /** Present on a re-publish (update in place); absent on a first publish (new id minted). */
  id?: string
  label: string
  modelName: string
  buildStages?: BuildStageSummary[]
  componentsWithProductInfo?: string[]
}

async function isOwner(req: VercelRequest): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  const cookies = parseCookies(req.headers.cookie)
  return verifySessionToken(cookies[COOKIE_NAMES.owner], 'owner', secret)
}

async function isPresentationOrOwner(req: VercelRequest): Promise<boolean> {
  if (await isOwner(req)) return true
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  const cookies = parseCookies(req.headers.cookie)
  return verifySessionToken(cookies[COOKIE_NAMES.presentation], 'presentation', secret)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const storage = getStorage()

  if (req.method === 'GET') {
    if (!(await isPresentationOrOwner(req))) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    res.status(200).json(await storage.list())
    return
  }

  if (req.method === 'POST') {
    if (!(await isOwner(req))) {
      res.status(403).json({ error: 'Owner session required' })
      return
    }

    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('application/json')) {
      // The browser already uploaded the GLB directly to Blob storage (api/publish/upload-token.ts)
      // — this just records the metadata, well under the Function body-size limit either way.
      const body = req.body as (PublishRequestMeta & { glbUrl?: string; sizeBytes?: number }) | undefined
      if (!body || typeof body.glbUrl !== 'string' || typeof body.sizeBytes !== 'number') {
        res.status(400).json({ error: 'Expected glbUrl and sizeBytes in JSON body' })
        return
      }
      if (!body.label?.trim() || !body.modelName?.trim()) {
        res.status(400).json({ error: 'label and modelName are required' })
        return
      }

      const now = Date.now()
      const id = body.id ?? randomUUID()
      const existing = body.id ? await storage.getMeta(body.id) : null

      const meta = await storage.putFromUrl(id, body.glbUrl, body.sizeBytes, {
        id,
        label: body.label.trim(),
        modelName: body.modelName.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        buildStages: body.buildStages ?? [],
        componentsWithProductInfo: body.componentsWithProductInfo ?? [],
      })

      res.status(200).json(meta)
      return
    }

    const metaHeader = req.headers['x-snapshot-meta']
    if (typeof metaHeader !== 'string' || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Expected raw GLB body and an X-Snapshot-Meta header' })
      return
    }

    let parsed: PublishRequestMeta
    try {
      parsed = JSON.parse(decodeURIComponent(metaHeader))
    } catch {
      res.status(400).json({ error: 'X-Snapshot-Meta header is not valid JSON' })
      return
    }
    if (!parsed.label?.trim() || !parsed.modelName?.trim()) {
      res.status(400).json({ error: 'label and modelName are required' })
      return
    }

    const now = Date.now()
    const id = parsed.id ?? randomUUID()
    const existing = parsed.id ? await storage.getMeta(parsed.id) : null

    const meta = await storage.put(id, new Uint8Array(req.body), {
      id,
      label: parsed.label.trim(),
      modelName: parsed.modelName.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      buildStages: parsed.buildStages ?? [],
      componentsWithProductInfo: parsed.componentsWithProductInfo ?? [],
    })

    res.status(200).json(meta)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
