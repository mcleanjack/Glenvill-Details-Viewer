import { create } from 'zustand'
import { exportGlb } from '../three/exportGlb'
import { getBuildStageFolders } from '../types/folder'
import type { PublishedSnapshotMeta } from '../types/publish'
import { useAppStore } from './useAppStore'

interface PublishState {
  snapshots: PublishedSnapshotMeta[]
  loading: boolean
  publishing: boolean
  error: string | null

  loadAll: () => Promise<void>
  /** Always creates a new published snapshot (the TopBar "Publish…" action). */
  publish: (label: string) => Promise<PublishedSnapshotMeta>
  /** Re-exports the current in-editor model state over an existing snapshot's id — the
   * Published Snapshots panel's per-row "Re-publish" action. */
  republish: (id: string) => Promise<PublishedSnapshotMeta>
  renameLabel: (id: string, label: string) => Promise<void>
  unpublish: (id: string) => Promise<void>
}

async function buildSnapshotBlob() {
  const app = useAppStore.getState()
  if (!app.modelRoot || !app.sceneManager) throw new Error('No model loaded to publish.')
  const blob = await exportGlb({
    modelGroup: app.sceneManager.modelGroup,
    exportSettings: app.exportSettings,
    edgeSettings: app.edgeSettings,
    folders: app.folders,
    folderMembership: app.folderMembership,
  })
  const buildStages = getBuildStageFolders(app.folders).map((f) => ({
    id: f.id,
    name: f.name,
    order: f.buildStageOrder!,
    // The authoritative per-object stage membership travels inside the GLB itself (see
    // exportGlb.ts's stampBuildStages) — this copy is metadata-only, for the gallery/panel.
    objectNames: [] as string[],
  }))
  const componentsWithProductInfo = Object.keys(app.productInfo)
  const modelName = (app.fbxFileName ?? 'Untitled model').replace(/\.fbx$/i, '')
  return { blob, buildStages, componentsWithProductInfo, modelName }
}

/** Posts a GLB straight through the Function body (works for local dev without Blob configured,
 * and for anything small enough to fit under Vercel's ~4.5MB request body cap). */
async function legacyPostSnapshot(payload: { id?: string; label: string }, meta: object, blob: Blob): Promise<PublishedSnapshotMeta> {
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'model/gltf-binary',
      'X-Snapshot-Meta': encodeURIComponent(JSON.stringify({ ...payload, ...meta })),
    },
    body: blob,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(body.error || `Publish failed (${res.status})`)
  }
  return (await res.json()) as PublishedSnapshotMeta
}

async function postSnapshot(payload: { id?: string; label: string }): Promise<PublishedSnapshotMeta> {
  const { blob, buildStages, componentsWithProductInfo, modelName } = await buildSnapshotBlob()
  const meta = { buildStages, componentsWithProductInfo, modelName }
  const id = payload.id ?? crypto.randomUUID()

  // A real building model's GLB routinely exceeds Vercel's ~4.5MB Function body cap, so upload it
  // straight to Blob storage from the browser instead of through the API route. Checking
  // blobConfigured up front (rather than trying upload() and catching failure) is deliberate:
  // @vercel/blob's upload() discards the real error body on a failed token request, so a caught
  // failure there can't be distinguished from an actual auth/network error.
  const statusRes = await fetch('/api/publish/upload-token')
  const { blobConfigured } = statusRes.ok ? ((await statusRes.json()) as { blobConfigured: boolean }) : { blobConfigured: false }

  if (!blobConfigured) {
    return legacyPostSnapshot(payload, meta, blob)
  }

  const { upload } = await import('@vercel/blob/client')
  const uploaded = await upload(`snapshots/${id}/model.glb`, blob, {
    access: 'public',
    handleUploadUrl: '/api/publish/upload-token',
    contentType: 'model/gltf-binary',
  })
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...meta, id, glbUrl: uploaded.url, sizeBytes: blob.size }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(body.error || `Publish failed (${res.status})`)
  }
  return (await res.json()) as PublishedSnapshotMeta
}

export const usePublishStore = create<PublishState>((set, get) => ({
  snapshots: [],
  loading: false,
  publishing: false,
  error: null,

  loadAll: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/publish')
      if (!res.ok) throw new Error(`Failed to load published snapshots (${res.status})`)
      set({ snapshots: (await res.json()) as PublishedSnapshotMeta[], loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load published snapshots' })
    }
  },

  publish: async (label) => {
    set({ publishing: true, error: null })
    try {
      const saved = await postSnapshot({ label })
      set((s) => ({ publishing: false, snapshots: [saved, ...s.snapshots.filter((sn) => sn.id !== saved.id)] }))
      return saved
    } catch (err) {
      set({ publishing: false, error: err instanceof Error ? err.message : 'Publish failed' })
      throw err
    }
  },

  republish: async (id) => {
    const existing = get().snapshots.find((s) => s.id === id)
    if (!existing) throw new Error('Unknown snapshot')
    set({ publishing: true, error: null })
    try {
      const saved = await postSnapshot({ id, label: existing.label })
      set((s) => ({ publishing: false, snapshots: s.snapshots.map((sn) => (sn.id === id ? saved : sn)) }))
      return saved
    } catch (err) {
      set({ publishing: false, error: err instanceof Error ? err.message : 'Re-publish failed' })
      throw err
    }
  },

  renameLabel: async (id, label) => {
    const res = await fetch(`/api/publish/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    if (!res.ok) throw new Error(`Rename failed (${res.status})`)
    const meta = (await res.json()) as PublishedSnapshotMeta
    set((s) => ({ snapshots: s.snapshots.map((sn) => (sn.id === id ? meta : sn)) }))
  },

  unpublish: async (id) => {
    const res = await fetch(`/api/publish/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`Unpublish failed (${res.status})`)
    set((s) => ({ snapshots: s.snapshots.filter((sn) => sn.id !== id) }))
  },
}))
