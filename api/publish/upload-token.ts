import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { COOKIE_NAMES, parseCookies, verifySessionToken } from '../_lib/session.js'

/**
 * Issues short-lived client tokens so the browser can upload a published GLB straight to Vercel
 * Blob, bypassing this project's other Functions entirely. That's required, not optional: Vercel
 * Functions cap request bodies at 4.5MB regardless of any in-app config, and a real building
 * model's exported GLB routinely exceeds that (see `api/publish/index.ts`, which still accepts a
 * raw-body POST too — that path stays for local dev without Blob configured, and for models
 * small enough to fit under the limit).
 */

async function isOwner(req: VercelRequest): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  const cookies = parseCookies(req.headers.cookie)
  return verifySessionToken(cookies[COOKIE_NAMES.owner], 'owner', secret)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Cheap, unauthenticated status probe — the client checks this before attempting a direct
    // upload at all, since @vercel/blob's `upload()` discards the real error body on a failed
    // token request (it always throws a generic "Failed to retrieve the client token").
    res.status(200).json({ blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(501).json({ error: 'BLOB_NOT_CONFIGURED' })
    return
  }

  if (!(await isOwner(req))) {
    res.status(403).json({ error: 'Owner session required' })
    return
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^snapshots\/[^/]+\/model\.glb$/.test(pathname)) {
          throw new Error('Invalid snapshot upload path')
        }
        return {
          allowedContentTypes: ['model/gltf-binary'],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        }
      },
    })
    res.status(200).json(jsonResponse)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload token request failed' })
  }
}
