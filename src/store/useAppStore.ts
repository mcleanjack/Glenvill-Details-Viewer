import { create } from 'zustand'
import * as THREE from 'three'
import type { ObjectMeta, EdgeSettings, ExportSettings } from '../types/scene'
import { DEFAULT_EDGE_SETTINGS, DEFAULT_EXPORT_SETTINGS, clampEdgeSettings } from '../types/scene'
import type { ObjectTreeNode } from '../types/tree'
import type { TreeFolder } from '../types/folder'
import { collectFolderComponentIds, getBuildStageFolders } from '../types/folder'
import type { SunSettings } from '../types/sun'
import { DEFAULT_SUN_SETTINGS } from '../types/sun'
import type { ProductInfo } from '../types/product'
import { isProductInfoEmpty } from '../types/product'
import { importFbx } from '../three/fbxImport'
import { SceneManager, type ProjectionMode } from '../three/SceneManager'
import { EdgePreviewController } from '../three/edges/fatLineEdges'
import { buildThreeMaterial } from '../three/materialFactory'
import { getCanonicalGeometry, getFaceCount, rebuildMeshFaceMaterials, restoreCanonicalGeometry } from '../three/faceMaterials'
import { useMaterialLibraryStore } from './useMaterialLibraryStore'
import { makeId } from '../utils/id'

export type ActiveTool = 'select' | 'orbit' | 'pan' | 'zoom' | 'measure' | 'faceSelect'
export type RightPanelKey = 'objectTree' | 'materials' | 'materialEditor' | 'edgeSettings' | 'sun' | 'published' | null

/** componentId -> canonical face index -> assigned custom material id. Serializable as-is for
 * project save/restore. */
export type FaceMaterialAssignments = Record<string, Record<number, string>>

interface AppState {
  sceneManager: SceneManager | null
  edgePreview: EdgePreviewController | null

  // Model / import
  modelRoot: THREE.Group | null
  objectTree: ObjectTreeNode | null
  objectMeta: Map<string, ObjectMeta>
  fbxMaterialNames: string[]
  fbxFileName: string | null
  importing: boolean
  importError: string | null

  // Assignment
  materialAssignments: Record<string, string>
  applyingMaterials: boolean

  // Product information — per-component metadata, independent of materials/edges/geometry.
  // See src/types/product.ts. componentId -> ProductInfo (only entries with at least one
  // non-empty field are kept, so "has product info" is a plain key-presence check).
  productInfo: Record<string, ProductInfo>

  // Face-level assignment
  faceMaterialAssignments: FaceMaterialAssignments
  faceSelectComponentId: string | null
  faceSelectedFaceIndices: Set<number>

  // Visibility / isolation
  hiddenComponentIds: Set<string>
  isolateActive: boolean

  // Object Tree folder grouping — organizational only, never touches the scene graph, the
  // FBX-derived hierarchy, or GLB export. See src/types/folder.ts.
  folders: Record<string, TreeFolder>
  /** componentId -> id of the folder directly containing it (only for objects the user has
   * explicitly grouped; everything else renders at its original tree position). */
  folderMembership: Record<string, string>

  // Selection
  selectedComponentIds: string[]
  hoveredComponentId: string | null

  // Viewport / tools
  activeTool: ActiveTool
  wireframe: boolean
  projection: ProjectionMode
  gridVisible: boolean
  axesVisible: boolean

  // Edge system
  edgeSettings: EdgeSettings

  // Sun (viewport-only lighting/shadow preview — see src/types/sun.ts)
  sunSettings: SunSettings

  // Export
  exportSettings: ExportSettings

  // UI
  activeRightPanel: RightPanelKey
  editingMaterialId: string | null
  statusMessage: string

  // Actions
  initSceneManager: (sm: SceneManager) => void
  importFbxFile: (file: File) => Promise<void>

  selectComponent: (componentId: string | null, additive?: boolean) => void
  setHover: (componentId: string | null) => void

  toggleVisibility: (componentId: string) => void
  isolateSelected: () => void
  exitIsolate: () => void
  showAll: () => void

  createFolderFromSelection: (name: string, componentIds: string[]) => string
  renameFolder: (folderId: string, name: string) => void
  deleteFolder: (folderId: string) => void
  moveComponentsToFolder: (componentIds: string[], folderId: string | null) => void
  moveFolderToFolder: (folderId: string, parentId: string | null) => void
  toggleFolderVisibility: (folderId: string) => void
  selectFolderContents: (folderId: string, additive?: boolean) => void

  /** Marks/unmarks a folder as a build stage — see src/types/folder.ts. Marking assigns the
   * next free stage order (current max + 1); unmarking clears it. */
  setFolderBuildStage: (folderId: string, isStage: boolean) => void
  /** Swaps this stage's order with its immediate neighbor in stage sequence — the up/down
   * reorder control in the Build Stages list. */
  moveBuildStageOrder: (folderId: string, direction: 'up' | 'down') => void
  /** Selects a folder's contents and isolates them — the stage preview/stepper reuses this
   * exact isolate path rather than any new visibility system. */
  isolateFolder: (folderId: string) => void

  assignMaterialToComponents: (materialId: string | null, componentIds: string[]) => Promise<void>
  assignMaterialToFbxMaterialName: (materialId: string | null, fbxMaterialName: string) => Promise<void>
  reapplyAllAssignments: () => Promise<void>

  setProductInfo: (componentId: string, info: ProductInfo) => void
  /** Applies the same ProductInfo to every given componentId in one batched update (mirrors
   * assignMaterialToComponents' multi-select pattern) — replaces each object's existing product
   * information, if any, with these identical values. */
  setProductInfoForComponents: (componentIds: string[], info: ProductInfo) => void
  /** Re-stamps every stored ProductInfo onto the live model's userData.productInfo — needed
   * because the store's record survives across model re-imports/project loads but the actual
   * THREE objects it targets don't. Mirrors reapplyAllAssignments' role for material data. */
  reapplyProductInfo: () => void

  // Face-level assignment
  selectFace: (componentId: string, faceIndex: number, additive: boolean) => void
  addFacesToSelection: (componentId: string, faceIndices: number[]) => void
  clearFaceSelection: () => void
  assignMaterialToFaceSelection: (materialId: string | null) => Promise<void>

  setActiveTool: (tool: ActiveTool) => void
  setWireframe: (v: boolean) => void
  setProjection: (mode: ProjectionMode) => void
  setGridVisible: (v: boolean) => void
  setAxesVisible: (v: boolean) => void
  fitToScreen: () => void
  resetCamera: () => void

  setEdgeSettings: (partial: Partial<EdgeSettings>) => void
  setSunSettings: (partial: Partial<SunSettings>) => void
  setExportSettings: (partial: Partial<ExportSettings>) => void

  setActiveRightPanel: (panel: RightPanelKey) => void
  openMaterialEditor: (materialId: string | null) => void
  closeMaterialEditor: () => void
  setStatusMessage: (msg: string) => void
}

function applyVisibility(root: THREE.Object3D, hidden: Set<string>, isolate: Set<string> | null) {
  root.traverse((obj) => {
    const id = obj.userData.componentId as string | undefined
    if (!id) return
    if (isolate) {
      obj.visible = isolate.has(id)
    } else {
      obj.visible = !hidden.has(id)
    }
  })
}

let isolateSet: Set<string> | null = null

/** True if `folderId` is `maybeAncestorId` itself, or nested inside it — used to reject a
 * folder-into-folder drag that would create a cycle. */
function isFolderOrDescendant(folders: Record<string, TreeFolder>, folderId: string, maybeAncestorId: string): boolean {
  let cur: string | null = folderId
  while (cur) {
    if (cur === maybeAncestorId) return true
    cur = folders[cur]?.parentId ?? null
  }
  return false
}

export const useAppStore = create<AppState>((set, get) => ({
  sceneManager: null,
  edgePreview: null,

  modelRoot: null,
  objectTree: null,
  objectMeta: new Map(),
  fbxMaterialNames: [],
  fbxFileName: null,
  importing: false,
  importError: null,

  materialAssignments: {},
  applyingMaterials: false,

  productInfo: {},

  faceMaterialAssignments: {},
  faceSelectComponentId: null,
  faceSelectedFaceIndices: new Set(),

  hiddenComponentIds: new Set(),
  isolateActive: false,

  folders: {},
  folderMembership: {},

  selectedComponentIds: [],
  hoveredComponentId: null,

  activeTool: 'select',
  wireframe: false,
  projection: 'perspective',
  gridVisible: true,
  axesVisible: true,

  edgeSettings: { ...DEFAULT_EDGE_SETTINGS },
  sunSettings: { ...DEFAULT_SUN_SETTINGS },
  exportSettings: { ...DEFAULT_EXPORT_SETTINGS },

  activeRightPanel: 'objectTree',
  editingMaterialId: null,
  statusMessage: 'Ready. Import an FBX to begin.',

  initSceneManager: (sm) => {
    const edgePreview = new EdgePreviewController()
    set({ sceneManager: sm, edgePreview })
  },

  importFbxFile: async (file) => {
    set({ importing: true, importError: null, statusMessage: `Importing ${file.name}…` })
    try {
      const result = await importFbx(file)
      const sm = get().sceneManager
      sm?.setModel(result.root)

      isolateSet = null
      set({
        modelRoot: result.root,
        objectTree: result.tree,
        objectMeta: result.objectMeta,
        fbxMaterialNames: result.fbxMaterialNames,
        fbxFileName: file.name,
        importing: false,
        materialAssignments: {},
        productInfo: {},
        faceMaterialAssignments: {},
        faceSelectComponentId: null,
        faceSelectedFaceIndices: new Set(),
        hiddenComponentIds: new Set(),
        isolateActive: false,
        folders: {},
        folderMembership: {},
        selectedComponentIds: [],
        hoveredComponentId: null,
        statusMessage: `Imported ${file.name} — ${result.objectMeta.size} objects, ${result.fbxMaterialNames.length} FBX materials.`,
      })

      sm?.setFaceHighlight(null, [])
      sm?.fitToScreen()
      get().setEdgeSettings({})
      get().setSunSettings({})
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown FBX import error'
      set({ importing: false, importError: message, statusMessage: `Import failed: ${message}` })
    }
  },

  selectComponent: (componentId, additive = false) => {
    set((s) => {
      if (componentId === null) return { selectedComponentIds: [] }
      if (additive) {
        const has = s.selectedComponentIds.includes(componentId)
        return {
          selectedComponentIds: has
            ? s.selectedComponentIds.filter((id) => id !== componentId)
            : [...s.selectedComponentIds, componentId],
        }
      }
      return { selectedComponentIds: [componentId] }
    })
    get().sceneManager?.setSelection(get().selectedComponentIds)
  },

  setHover: (componentId) => {
    set({ hoveredComponentId: componentId })
    get().sceneManager?.setHover(componentId)
  },

  toggleVisibility: (componentId) => {
    set((s) => {
      const next = new Set(s.hiddenComponentIds)
      if (next.has(componentId)) next.delete(componentId)
      else next.add(componentId)
      return { hiddenComponentIds: next }
    })
    const { modelRoot, hiddenComponentIds, isolateActive } = get()
    if (modelRoot) applyVisibility(modelRoot, hiddenComponentIds, isolateActive ? isolateSet : null)
  },

  isolateSelected: () => {
    const { modelRoot, selectedComponentIds } = get()
    if (!modelRoot || selectedComponentIds.length === 0) return
    const include = new Set<string>()
    // Include selected components plus all their descendants so isolate reads as "show me
    // this component's part of the tree", not just the exact clicked node.
    modelRoot.traverse((obj) => {
      const id = obj.userData.componentId as string | undefined
      if (!id) return
      let cur: THREE.Object3D | null = obj
      while (cur) {
        const curId = cur.userData.componentId as string | undefined
        if (curId && selectedComponentIds.includes(curId)) {
          include.add(id)
          break
        }
        cur = cur.parent
      }
    })
    isolateSet = include
    set({ isolateActive: true })
    applyVisibility(modelRoot, get().hiddenComponentIds, isolateSet)
  },

  exitIsolate: () => {
    isolateSet = null
    set({ isolateActive: false })
    const { modelRoot, hiddenComponentIds } = get()
    if (modelRoot) applyVisibility(modelRoot, hiddenComponentIds, null)
  },

  showAll: () => {
    isolateSet = null
    set({ hiddenComponentIds: new Set(), isolateActive: false })
    const { modelRoot } = get()
    if (modelRoot) applyVisibility(modelRoot, new Set(), null)
  },

  createFolderFromSelection: (name, componentIds) => {
    const id = makeId('folder')
    set((s) => {
      const membership = { ...s.folderMembership }
      for (const cid of componentIds) membership[cid] = id
      return {
        folders: { ...s.folders, [id]: { id, name, parentId: null } },
        folderMembership: membership,
      }
    })
    return id
  },

  renameFolder: (folderId, name) => {
    set((s) => {
      const folder = s.folders[folderId]
      if (!folder) return {}
      return { folders: { ...s.folders, [folderId]: { ...folder, name } } }
    })
  },

  deleteFolder: (folderId) => {
    // Ungroup: contents (subfolders and objects alike) move up to the deleted folder's own
    // parent level — a top-level folder's contents return to the tree at their original
    // position. The underlying objects/subfolders themselves are never deleted.
    set((s) => {
      const folder = s.folders[folderId]
      if (!folder) return {}
      const parentId = folder.parentId

      const folders = { ...s.folders }
      delete folders[folderId]
      for (const f of Object.values(folders)) {
        if (f.parentId === folderId) folders[f.id] = { ...f, parentId }
      }

      const folderMembership = { ...s.folderMembership }
      for (const [cid, fid] of Object.entries(folderMembership)) {
        if (fid !== folderId) continue
        if (parentId) folderMembership[cid] = parentId
        else delete folderMembership[cid]
      }

      return { folders, folderMembership }
    })
  },

  moveComponentsToFolder: (componentIds, folderId) => {
    set((s) => {
      const membership = { ...s.folderMembership }
      for (const cid of componentIds) {
        if (folderId) membership[cid] = folderId
        else delete membership[cid]
      }
      return { folderMembership: membership }
    })
  },

  moveFolderToFolder: (folderId, parentId) => {
    set((s) => {
      const folder = s.folders[folderId]
      if (!folder) return {}
      if (folderId === parentId) return {}
      // Reject a drop that would nest a folder inside its own descendant (or itself).
      if (parentId && isFolderOrDescendant(s.folders, parentId, folderId)) return {}
      return { folders: { ...s.folders, [folderId]: { ...folder, parentId } } }
    })
  },

  toggleFolderVisibility: (folderId) => {
    const { folders, folderMembership, hiddenComponentIds } = get()
    const ids = collectFolderComponentIds(folders, folderMembership, folderId)
    if (ids.length === 0) return
    const allHidden = ids.every((id) => hiddenComponentIds.has(id))
    set((s) => {
      const next = new Set(s.hiddenComponentIds)
      for (const id of ids) {
        if (allHidden) next.delete(id)
        else next.add(id)
      }
      return { hiddenComponentIds: next }
    })
    const { modelRoot, isolateActive } = get()
    if (modelRoot) applyVisibility(modelRoot, get().hiddenComponentIds, isolateActive ? isolateSet : null)
  },

  selectFolderContents: (folderId, additive = false) => {
    const { folders, folderMembership } = get()
    const ids = collectFolderComponentIds(folders, folderMembership, folderId)
    set((s) => {
      if (!additive) return { selectedComponentIds: ids }
      const nextSet = new Set(s.selectedComponentIds)
      const allSelected = ids.length > 0 && ids.every((id) => nextSet.has(id))
      if (allSelected) ids.forEach((id) => nextSet.delete(id))
      else ids.forEach((id) => nextSet.add(id))
      return { selectedComponentIds: Array.from(nextSet) }
    })
    get().sceneManager?.setSelection(get().selectedComponentIds)
  },

  setFolderBuildStage: (folderId, isStage) => {
    set((s) => {
      const folder = s.folders[folderId]
      if (!folder) return {}
      if (isStage) {
        if (folder.buildStageOrder !== undefined) return {} // already a stage
        const existingOrders = getBuildStageFolders(s.folders).map((f) => f.buildStageOrder!)
        const nextOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1
        return { folders: { ...s.folders, [folderId]: { ...folder, buildStageOrder: nextOrder } } }
      }
      if (folder.buildStageOrder === undefined) return {}
      const unmarked: TreeFolder = { id: folder.id, name: folder.name, parentId: folder.parentId }
      return { folders: { ...s.folders, [folderId]: unmarked } }
    })
  },

  moveBuildStageOrder: (folderId, direction) => {
    set((s) => {
      const stages = getBuildStageFolders(s.folders)
      const idx = stages.findIndex((f) => f.id === folderId)
      if (idx === -1) return {}
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= stages.length) return {}
      const a = stages[idx]
      const b = stages[swapIdx]
      return {
        folders: {
          ...s.folders,
          [a.id]: { ...a, buildStageOrder: b.buildStageOrder },
          [b.id]: { ...b, buildStageOrder: a.buildStageOrder },
        },
      }
    })
  },

  isolateFolder: (folderId) => {
    get().selectFolderContents(folderId, false)
    get().isolateSelected()
  },

  assignMaterialToComponents: async (materialId, componentIds) => {
    if (componentIds.length === 0) return
    set((s) => {
      const next = { ...s.materialAssignments }
      for (const id of componentIds) {
        if (materialId) next[id] = materialId
        else delete next[id]
      }
      return { materialAssignments: next }
    })
    await get().reapplyAllAssignments()
  },

  assignMaterialToFbxMaterialName: async (materialId, fbxMaterialName) => {
    const { objectMeta } = get()
    const targets = Array.from(objectMeta.values())
      .filter((m) => m.isMesh && m.fbxMaterialNames.includes(fbxMaterialName))
      .map((m) => m.componentId)
    await get().assignMaterialToComponents(materialId, targets)
  },

  reapplyAllAssignments: async () => {
    const { modelRoot, materialAssignments, faceMaterialAssignments } = get()
    if (!modelRoot) return
    set({ applyingMaterials: true })
    const library = useMaterialLibraryStore.getState()

    // A material can be assigned to a group node, not just a leaf mesh (e.g. selecting a whole
    // Revit family instance and assigning brick to it). Resolve each mesh's effective *base*
    // material by walking up to the nearest ancestor — including itself — that carries an
    // assignment, so it cascades onto every descendant mesh; a more specific assignment on the
    // mesh itself wins. Face-level overrides (below) always take priority over the base on the
    // specific faces they cover.
    function resolveAssignment(obj: THREE.Object3D): string | undefined {
      let cur: THREE.Object3D | null = obj
      while (cur) {
        const id = cur.userData.componentId as string | undefined
        if (id && materialAssignments[id]) return materialAssignments[id]
        cur = cur.parent
      }
      return undefined
    }

    interface MeshInfo {
      mesh: THREE.Mesh
      componentId: string
      baseMaterialId?: string
      faceOverrides?: Record<number, string>
    }

    const neededMaterialIds = new Set<string>()
    const meshInfos: MeshInfo[] = []
    modelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const componentId = mesh.userData.componentId as string | undefined
      if (!componentId) return
      const baseMaterialId = resolveAssignment(mesh)
      const faceOverrides = faceMaterialAssignments[componentId]
      if (baseMaterialId) neededMaterialIds.add(baseMaterialId)
      if (faceOverrides) for (const matId of Object.values(faceOverrides)) neededMaterialIds.add(matId)
      meshInfos.push({ mesh, componentId, baseMaterialId, faceOverrides })
    })

    const resolvedMap = new Map<string, THREE.MeshStandardMaterial>()
    await Promise.all(
      Array.from(neededMaterialIds).map(async (id) => {
        const customMaterial = library.getById(id)
        if (!customMaterial) return
        resolvedMap.set(id, await buildThreeMaterial(customMaterial))
      }),
    )

    for (const { mesh, baseMaterialId, faceOverrides } of meshInfos) {
      const hasFaceOverrides = faceOverrides && Object.keys(faceOverrides).length > 0

      if (!hasFaceOverrides) {
        // Exactly the pre-face-assignment behaviour: no face overrides means no reason to touch
        // geometry at all, and the true original material (which may itself be a multi-material
        // array from the source FBX) is restored as-is when nothing is assigned.
        const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[] | undefined
        const material = (baseMaterialId && resolvedMap.get(baseMaterialId)) || original
        if (material) restoreCanonicalGeometry(mesh, material)
        continue
      }

      // Face overrides exist: the "base" material covering every non-overridden face on this
      // mesh must be a single Material (three.js multi-material groups can't reference a nested
      // array), so an original FBX mesh that itself had multiple sub-materials falls back to its
      // first one here. This only affects meshes the user has actually started face-overriding.
      const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[] | undefined
      const originalSingle = Array.isArray(original) ? original[0] : original
      const baseMaterial = (baseMaterialId && resolvedMap.get(baseMaterialId)) || originalSingle || new THREE.MeshStandardMaterial({ color: 0x999999 })

      const canonical = getCanonicalGeometry(mesh)
      if (!canonical) continue
      const faceCount = getFaceCount(canonical)
      const slot = new Int32Array(faceCount)
      const materials: THREE.Material[] = [baseMaterial]
      const idToSlot = new Map<string, number>()

      for (const [faceIndexStr, matId] of Object.entries(faceOverrides!)) {
        const faceIndex = Number(faceIndexStr)
        if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= faceCount) continue
        const resolved = resolvedMap.get(matId)
        if (!resolved) continue // material was deleted from the library — face falls back to base
        let slotIndex = idToSlot.get(matId)
        if (slotIndex === undefined) {
          slotIndex = materials.length
          materials.push(resolved)
          idToSlot.set(matId, slotIndex)
        }
        slot[faceIndex] = slotIndex
      }

      rebuildMeshFaceMaterials(mesh, slot, materials)
    }

    set({ applyingMaterials: false })
  },

  setProductInfo: (componentId, info) => {
    get().setProductInfoForComponents([componentId], info)
  },

  setProductInfoForComponents: (componentIds, info) => {
    if (componentIds.length === 0) return
    set((s) => {
      const next = { ...s.productInfo }
      for (const componentId of componentIds) {
        if (isProductInfoEmpty(info)) delete next[componentId]
        else next[componentId] = info
      }
      return { productInfo: next }
    })
    get().reapplyProductInfo()
  },

  reapplyProductInfo: () => {
    const { modelRoot, productInfo } = get()
    if (!modelRoot) return
    // Stamped onto userData.productInfo (not materials, not geometry) so GLTFExporter's default
    // userData->extras serialization carries it through untouched — see three/exportGlb.ts,
    // which needs no changes at all for this to round-trip.
    modelRoot.traverse((obj) => {
      const componentId = obj.userData.componentId as string | undefined
      if (!componentId) return
      const info = productInfo[componentId]
      if (info) obj.userData.productInfo = info
      else delete obj.userData.productInfo
    })
  },

  selectFace: (componentId, faceIndex, additive) => {
    set((s) => {
      if (!additive || s.faceSelectComponentId !== componentId) {
        return { faceSelectComponentId: componentId, faceSelectedFaceIndices: new Set([faceIndex]) }
      }
      const next = new Set(s.faceSelectedFaceIndices)
      if (next.has(faceIndex)) next.delete(faceIndex)
      else next.add(faceIndex)
      return { faceSelectedFaceIndices: next }
    })
    const { faceSelectComponentId, faceSelectedFaceIndices, sceneManager } = get()
    sceneManager?.setFaceHighlight(faceSelectComponentId, faceSelectedFaceIndices)
  },

  addFacesToSelection: (componentId, faceIndices) => {
    if (faceIndices.length === 0) return
    set((s) => {
      if (s.faceSelectComponentId !== componentId) {
        return { faceSelectComponentId: componentId, faceSelectedFaceIndices: new Set(faceIndices) }
      }
      const next = new Set(s.faceSelectedFaceIndices)
      faceIndices.forEach((f) => next.add(f))
      return { faceSelectedFaceIndices: next }
    })
    const { faceSelectComponentId, faceSelectedFaceIndices, sceneManager } = get()
    sceneManager?.setFaceHighlight(faceSelectComponentId, faceSelectedFaceIndices)
  },

  clearFaceSelection: () => {
    set({ faceSelectComponentId: null, faceSelectedFaceIndices: new Set() })
    get().sceneManager?.setFaceHighlight(null, [])
  },

  assignMaterialToFaceSelection: async (materialId) => {
    const { faceSelectComponentId, faceSelectedFaceIndices } = get()
    if (!faceSelectComponentId || faceSelectedFaceIndices.size === 0) return
    set((s) => {
      const nextForComponent = { ...(s.faceMaterialAssignments[faceSelectComponentId] ?? {}) }
      for (const f of faceSelectedFaceIndices) {
        if (materialId) nextForComponent[f] = materialId
        else delete nextForComponent[f]
      }
      const nextAll = { ...s.faceMaterialAssignments }
      if (Object.keys(nextForComponent).length === 0) delete nextAll[faceSelectComponentId]
      else nextAll[faceSelectComponentId] = nextForComponent
      return { faceMaterialAssignments: nextAll }
    })
    await get().reapplyAllAssignments()
  },

  setActiveTool: (tool) => set({ activeTool: tool }),

  setWireframe: (v) => {
    set({ wireframe: v })
    get().sceneManager?.setWireframe(v)
  },

  setProjection: (mode) => {
    set({ projection: mode })
    get().sceneManager?.setProjection(mode)
  },

  setGridVisible: (v) => {
    set({ gridVisible: v })
    get().sceneManager?.setGridVisible(v)
  },

  setAxesVisible: (v) => {
    set({ axesVisible: v })
    get().sceneManager?.setAxesVisible(v)
  },

  fitToScreen: () => get().sceneManager?.fitToScreen(),
  resetCamera: () => get().sceneManager?.resetCamera(),

  setEdgeSettings: (partial) => {
    const merged = clampEdgeSettings({ ...get().edgeSettings, ...partial })
    set({ edgeSettings: merged })
    const { modelRoot, edgePreview } = get()
    if (!modelRoot || !edgePreview) return
    edgePreview.applyAppearance(merged)
    edgePreview.rebuild(modelRoot, merged.angleThreshold, merged.enabled)
  },

  setSunSettings: (partial) => {
    const merged = { ...get().sunSettings, ...partial }
    set({ sunSettings: merged })
    get().sceneManager?.applySunSettings(merged)
  },

  setExportSettings: (partial) => set((s) => ({ exportSettings: { ...s.exportSettings, ...partial } })),

  setActiveRightPanel: (panel) => set({ activeRightPanel: panel }),
  openMaterialEditor: (materialId) => set({ editingMaterialId: materialId, activeRightPanel: 'materialEditor' }),
  closeMaterialEditor: () => set({ editingMaterialId: null, activeRightPanel: 'materials' }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
}))
