/**
 * Snapshot storage — a small backend-agnostic interface with two implementations:
 *
 *  - Vercel Blob (`@vercel/blob`), used whenever `BLOB_READ_WRITE_TOKEN` is set (real deployments,
 *    and `vercel dev` once Blob storage is linked to the project).
 *  - A local filesystem stub under `.data/snapshots/` (gitignored), used otherwise, so a plain
 *    `node`/`vercel dev` environment without Blob configured still works end-to-end for testing.
 *
 * A "snapshot" is one published GLB + its metadata (label, model name, build-stage summary, which
 * componentIds carry product info). Metadata for every snapshot lives denormalized in one small
 * `index.json` object (fine at the scale of "one person's published detail models"); the GLB
 * itself is stored separately since it can be several MB.
 */

export interface BuildStageSummary {
  id: string
  name: string
  order: number
  objectNames: string[]
}

export interface SnapshotMeta {
  id: string
  label: string
  modelName: string
  createdAt: number
  updatedAt: number
  buildStages: BuildStageSummary[]
  /** componentIds that carry non-empty ProductInfo — informational only (e.g. for a gallery
   * badge); the actual product info travels inside the GLB's own node extras. */
  componentsWithProductInfo: string[]
  sizeBytes: number
}

export interface SnapshotStorage {
  list(): Promise<SnapshotMeta[]>
  getMeta(id: string): Promise<SnapshotMeta | null>
  getGlb(id: string): Promise<Uint8Array | null>
  put(id: string, glb: Uint8Array, meta: Omit<SnapshotMeta, 'sizeBytes'>): Promise<SnapshotMeta>
  remove(id: string): Promise<void>
}

function hasBlobToken(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

// ---- Vercel Blob backend -------------------------------------------------

interface IndexEntry extends SnapshotMeta {
  /** Internal — the blob's own URL, used to fetch/delete it. Never returned to API callers. */
  glbUrl: string
}

const INDEX_PATHNAME = 'snapshots/index.json'

class BlobStorage implements SnapshotStorage {
  private async readIndex(): Promise<IndexEntry[]> {
    const { list } = await import('@vercel/blob')
    const res = await list({ prefix: INDEX_PATHNAME, limit: 1 })
    const entry = res.blobs.find((b) => b.pathname === INDEX_PATHNAME)
    if (!entry) return []
    const r = await fetch(entry.url, { cache: 'no-store' })
    if (!r.ok) return []
    return (await r.json()) as IndexEntry[]
  }

  private async writeIndex(entries: IndexEntry[]): Promise<void> {
    const { put } = await import('@vercel/blob')
    await put(INDEX_PATHNAME, JSON.stringify(entries), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    })
  }

  async list(): Promise<SnapshotMeta[]> {
    const entries = await this.readIndex()
    return entries.map(({ glbUrl: _glbUrl, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getMeta(id: string): Promise<SnapshotMeta | null> {
    const entries = await this.readIndex()
    const found = entries.find((e) => e.id === id)
    if (!found) return null
    const { glbUrl: _glbUrl, ...meta } = found
    return meta
  }

  async getGlb(id: string): Promise<Uint8Array | null> {
    const entries = await this.readIndex()
    const found = entries.find((e) => e.id === id)
    if (!found) return null
    const r = await fetch(found.glbUrl, { cache: 'no-store' })
    if (!r.ok) return null
    return new Uint8Array(await r.arrayBuffer())
  }

  async put(id: string, glb: Uint8Array, meta: Omit<SnapshotMeta, 'sizeBytes'>): Promise<SnapshotMeta> {
    const { put } = await import('@vercel/blob')
    const glbBlob = await put(`snapshots/${id}/model.glb`, Buffer.from(glb), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'model/gltf-binary',
      allowOverwrite: true,
    })
    const fullMeta: SnapshotMeta = { ...meta, sizeBytes: glb.byteLength }
    const entries = await this.readIndex()
    const next = entries.filter((e) => e.id !== id)
    next.push({ ...fullMeta, glbUrl: glbBlob.url })
    await this.writeIndex(next)
    return fullMeta
  }

  async remove(id: string): Promise<void> {
    const { del } = await import('@vercel/blob')
    const entries = await this.readIndex()
    const found = entries.find((e) => e.id === id)
    if (found) await del(found.glbUrl)
    await this.writeIndex(entries.filter((e) => e.id !== id))
  }
}

// ---- Local filesystem backend (dev/testing without Blob configured) -----

class LocalStorage implements SnapshotStorage {
  private async paths() {
    const path = await import('node:path')
    const dir = path.join(process.cwd(), '.data', 'snapshots')
    return { path, dir, indexFile: path.join(dir, 'index.json') }
  }

  private async readIndex(): Promise<SnapshotMeta[]> {
    const fs = await import('node:fs/promises')
    const { indexFile } = await this.paths()
    try {
      return JSON.parse(await fs.readFile(indexFile, 'utf8')) as SnapshotMeta[]
    } catch {
      return []
    }
  }

  private async writeIndex(entries: SnapshotMeta[]): Promise<void> {
    const fs = await import('node:fs/promises')
    const { dir, indexFile } = await this.paths()
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(indexFile, JSON.stringify(entries, null, 2), 'utf8')
  }

  async list(): Promise<SnapshotMeta[]> {
    const entries = await this.readIndex()
    return entries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getMeta(id: string): Promise<SnapshotMeta | null> {
    const entries = await this.readIndex()
    return entries.find((e) => e.id === id) ?? null
  }

  async getGlb(id: string): Promise<Uint8Array | null> {
    const fs = await import('node:fs/promises')
    const { dir, path } = await this.paths()
    try {
      return new Uint8Array(await fs.readFile(path.join(dir, `${id}.glb`)))
    } catch {
      return null
    }
  }

  async put(id: string, glb: Uint8Array, meta: Omit<SnapshotMeta, 'sizeBytes'>): Promise<SnapshotMeta> {
    const fs = await import('node:fs/promises')
    const { dir, path } = await this.paths()
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${id}.glb`), glb)
    const fullMeta: SnapshotMeta = { ...meta, sizeBytes: glb.byteLength }
    const entries = await this.readIndex()
    await this.writeIndex([...entries.filter((e) => e.id !== id), fullMeta])
    return fullMeta
  }

  async remove(id: string): Promise<void> {
    const fs = await import('node:fs/promises')
    const { dir, path } = await this.paths()
    await fs.rm(path.join(dir, `${id}.glb`), { force: true })
    const entries = await this.readIndex()
    await this.writeIndex(entries.filter((e) => e.id !== id))
  }
}

let storage: SnapshotStorage | null = null

export function getStorage(): SnapshotStorage {
  if (!storage) storage = hasBlobToken() ? new BlobStorage() : new LocalStorage()
  return storage
}
