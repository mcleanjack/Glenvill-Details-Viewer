/** Client-side mirror of `api/_lib/storage.ts`'s `SnapshotMeta` — kept as a separate type rather
 * than importing across the client/server boundary, since `api/` runs in Vercel's Node/Edge
 * runtimes and must never be pulled into the browser bundle. */

export interface BuildStageSummary {
  id: string
  name: string
  order: number
  objectNames: string[]
}

export interface PublishedSnapshotMeta {
  id: string
  label: string
  modelName: string
  createdAt: number
  updatedAt: number
  buildStages: BuildStageSummary[]
  componentsWithProductInfo: string[]
  sizeBytes: number
}
