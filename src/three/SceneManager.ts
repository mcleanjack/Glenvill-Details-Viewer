import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { COMPONENT_ID_KEY, isAuxiliaryMesh } from '../types/scene'
import type { SunSettings } from '../types/sun'
import { getCanonicalGeometry, getFaceCount, getFaceLocalPositions, toCanonicalFaceIndex } from './faceMaterials'

export type ProjectionMode = 'perspective' | 'orthographic'

const SELECTION_COLOR = 0x3b82f6
const HOVER_COLOR = 0xf59e0b
const FACE_HIGHLIGHT_COLOR = 0xff5fa8

/** Above this face count, marquee (box) face selection is skipped rather than run. The
 * screen-projection pass over every face is cheap even at this scale — what's actually expensive
 * is the occlusion raycast fired for each face whose projected centroid lands inside the
 * rectangle, so real-world cost tracks the marquee's on-screen area rather than raw face count;
 * this is a backstop against pathological cases (a huge box over a very dense mesh), not the
 * common case. */
const MARQUEE_FACE_COUNT_LIMIT = 250000

/** Default sun shadow-map resolution. Backed off automatically for larger models — see
 * `setModel()` — so enabling shadows doesn't tank frame rate on a dense Revit export. */
const SHADOW_MAP_SIZE_DEFAULT = 2048
const SHADOW_MAP_SIZE_LARGE = 1536
const SHADOW_MAP_SIZE_HUGE = 1024
const SHADOW_MAP_LARGE_TRIANGLE_THRESHOLD = 500_000
const SHADOW_MAP_HUGE_TRIANGLE_THRESHOLD = 1_500_000

export interface FaceHit {
  mesh: THREE.Mesh
  componentId: string
  canonicalFaceIndex: number
}

export interface FaceRectPick {
  componentId: string
  faceIndices: number[]
  /** true if the target mesh was too dense for a per-face occlusion test and nothing was picked. */
  tooDense: boolean
}

export class SceneManager {
  readonly scene = new THREE.Scene()
  readonly perspectiveCamera: THREE.PerspectiveCamera
  readonly orthographicCamera: THREE.OrthographicCamera
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  readonly renderer: THREE.WebGLRenderer
  controls: OrbitControls

  readonly modelGroup = new THREE.Group()
  readonly edgesGroup = new THREE.Group()
  private readonly selectionHelpers = new THREE.Group()
  private readonly hoverHelpers = new THREE.Group()
  private readonly faceHighlightGroup = new THREE.Group()
  private readonly grid: THREE.GridHelper
  private readonly axes: THREE.AxesHelper

  /** "Sun" preview light — see src/types/sun.ts. Off by default (invisible, not just dim), so
   * with the sun disabled the scene renders under exactly the same hemi/key/fill lighting as
   * before this feature existed. */
  private readonly sunLight: THREE.DirectionalLight
  private readonly sunTarget = new THREE.Object3D()
  /** Shadow-catcher ground plane — a THREE.ShadowMaterial renders nothing except where a shadow
   * falls on it, so it stays visually unobtrusive. Viewport-only: added directly to `scene`, not
   * `modelGroup`, so export (which only ever clones modelGroup's own child) never sees it. */
  private readonly groundPlane: THREE.Mesh
  private modelBox: THREE.Box3 | null = null
  private shadowMapSize = SHADOW_MAP_SIZE_DEFAULT

  private container: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private rafId = 0
  private wireframe = false
  /** Extra per-frame callbacks run before render — e.g. the Presentation section's eased
   * camera-snap animation (src/presentation/cameraSnap.ts) or its orbit-cube gizmo's live
   * quaternion sync. Nothing in the editor itself uses this. */
  private readonly tickCallbacks = new Set<() => void>()

  constructor() {
    this.scene.background = new THREE.Color(0x2b2d33)
    this.modelGroup.name = 'ImportedModel'
    this.edgesGroup.name = 'ComponentEdgesPreview'
    this.scene.add(this.modelGroup, this.edgesGroup, this.selectionHelpers, this.hoverHelpers, this.faceHighlightGroup)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.1)
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(5, 10, 7.5)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-6, 4, -6)
    this.scene.add(hemi, key, fill)

    // Plain white/neutral — no colour control per spec. Starts invisible; setModel()/
    // applySunSettings() position it and size its shadow frustum once a model + settings exist.
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3)
    this.sunLight.visible = false
    this.sunLight.castShadow = false
    this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize)
    this.sunLight.target = this.sunTarget
    this.scene.add(this.sunLight, this.sunTarget)

    this.groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }))
    this.groundPlane.name = '__ViewportShadowGround__'
    this.groundPlane.rotation.x = -Math.PI / 2
    this.groundPlane.receiveShadow = true
    this.groundPlane.castShadow = false
    this.groundPlane.visible = false
    this.scene.add(this.groundPlane)

    this.grid = new THREE.GridHelper(20, 20, 0x555862, 0x3a3d45)
    this.axes = new THREE.AxesHelper(1.5)
    this.scene.add(this.grid, this.axes)

    this.perspectiveCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000)
    this.perspectiveCamera.position.set(4, 3, 6)
    this.orthographicCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.01, 5000)
    this.orthographicCamera.position.set(4, 3, 6)
    this.camera = this.perspectiveCamera

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    // Off by default — turned on only while the sun + its shadows are both enabled, in
    // applySunSettings(). PCFShadowMap for a clean, non-jagged look on architectural detail: in
    // this three.js version PCFSoftShadowMap is a deprecated alias for it (three.js itself warns
    // and silently falls back), and PCFShadowMap already does soft, radius-adjustable filtering
    // (light.shadow.radius drives the blur — see the Shadow Softness slider) without VSMShadowMap's
    // side effect of forcing every shadow *receiver* to also render into the shadow pass as a
    // caster (which would needlessly pull the shadow-catcher ground plane into that pass).
    this.renderer.shadowMap.enabled = false
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 0.5, 0)
  }

  mount(container: HTMLElement) {
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.handleResize()
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)
    this.loop()
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private handleResize() {
    if (!this.container) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h)

    this.perspectiveCamera.aspect = w / h
    this.perspectiveCamera.updateProjectionMatrix()

    const aspect = w / h
    const viewSize = this.orthoViewSize
    this.orthographicCamera.left = (-viewSize * aspect) / 2
    this.orthographicCamera.right = (viewSize * aspect) / 2
    this.orthographicCamera.top = viewSize / 2
    this.orthographicCamera.bottom = -viewSize / 2
    this.orthographicCamera.updateProjectionMatrix()
  }

  private orthoViewSize = 10

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop)
    this.controls.update()
    for (const cb of this.tickCallbacks) cb()
    this.renderer.render(this.scene, this.camera)
  }

  /** Registers a per-frame callback run just before render; returns an unsubscribe function. */
  onTick(cb: () => void): () => void {
    this.tickCallbacks.add(cb)
    return () => this.tickCallbacks.delete(cb)
  }

  setProjection(mode: ProjectionMode) {
    const prevCamera = this.camera
    this.camera = mode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera
    this.camera.position.copy(prevCamera.position)
    this.controls.object = this.camera
    this.handleResize()
  }

  setModel(root: THREE.Group | null) {
    this.modelGroup.clear()
    if (root) this.modelGroup.add(root)

    if (!root) {
      this.modelBox = null
      return
    }

    let triangleCount = 0
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || isAuxiliaryMesh(mesh)) return
      // Real model geometry casts and receives shadows from other components (e.g. a parapet
      // shadowing the floor below). Auxiliary viewport-only meshes (edge preview lines, face
      // highlight overlays — the live-viewport analogue of the export-only __COMPONENT_EDGES__
      // mesh, which doesn't exist in this scene graph) are skipped: thin line/overlay geometry is
      // prone to shadow acne and isn't meant to represent real physical geometry.
      mesh.castShadow = true
      mesh.receiveShadow = true
      const geom = mesh.geometry
      const triCount = geom.index ? geom.index.count / 3 : (geom.attributes.position?.count ?? 0) / 3
      triangleCount += triCount
    })

    this.shadowMapSize =
      triangleCount > SHADOW_MAP_HUGE_TRIANGLE_THRESHOLD
        ? SHADOW_MAP_SIZE_HUGE
        : triangleCount > SHADOW_MAP_LARGE_TRIANGLE_THRESHOLD
          ? SHADOW_MAP_SIZE_LARGE
          : SHADOW_MAP_SIZE_DEFAULT
    this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize)
    // A shadow map's render target isn't resized in place — it must be disposed so the renderer
    // regenerates one at the new mapSize on the next frame.
    this.sunLight.shadow.map?.dispose()
    this.sunLight.shadow.map = null

    this.recomputeModelBox()
  }

  private recomputeModelBox() {
    const box = new THREE.Box3().setFromObject(this.modelGroup)
    this.modelBox = box.isEmpty() ? null : box
    this.updateGroundPlane()
  }

  private updateGroundPlane() {
    if (!this.modelBox) return
    const size = this.modelBox.getSize(new THREE.Vector3())
    const center = this.modelBox.getCenter(new THREE.Vector3())
    // Generous margin so the shadow catcher stays under the model as the sun swings around and
    // casts long, low-elevation shadows, without needing to rebuild geometry per model.
    const span = Math.max(size.x, size.z, 1) * 6
    this.groundPlane.scale.set(span, span, 1)
    // Nudged a hair below the grid (which sits exactly at box.min.y) to avoid z-fighting between
    // the two coplanar helpers.
    const epsilon = Math.max(size.length() * 0.0005, 0.001)
    this.groundPlane.position.set(center.x, this.modelBox.min.y - epsilon, center.z)
  }

  /** Applies Sun panel settings to the live viewport in real time — visibility, brightness,
   * shadow on/off, direction/elevation, and the shadow camera frustum (fit to the model's actual
   * bounding box rather than a fixed size, so shadow resolution stays sharp on both a small
   * bracket detail and a large balcony assembly). Purely a scene-graph/renderer change: never
   * touches material data, and (since it only ever touches objects added directly to `scene`,
   * never `modelGroup`) has no effect on GLB export. */
  applySunSettings(settings: SunSettings) {
    const light = this.sunLight
    light.visible = settings.enabled
    light.intensity = settings.intensity
    light.castShadow = settings.enabled && settings.shadowsEnabled
    light.shadow.radius = settings.shadowSoftness
    this.renderer.shadowMap.enabled = settings.enabled && settings.shadowsEnabled
    this.groundPlane.visible = settings.enabled && settings.shadowsEnabled

    if (!settings.enabled) return

    const box = this.modelBox
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0)
    const radius = box ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1) : 10

    const azimuthRad = THREE.MathUtils.degToRad(settings.azimuth)
    const elevationRad = THREE.MathUtils.degToRad(Math.max(settings.elevation, 0.01))
    const direction = new THREE.Vector3(
      Math.cos(elevationRad) * Math.sin(azimuthRad),
      Math.sin(elevationRad),
      Math.cos(elevationRad) * Math.cos(azimuthRad),
    )
    const distance = radius * 2.5
    light.position.copy(center).addScaledVector(direction, distance)
    this.sunTarget.position.copy(center)
    this.sunTarget.updateMatrixWorld()

    // normalBias (a world-space offset along the surface normal) suppresses shadow acne
    // consistently across very different model scales, unlike a fixed depth `bias`.
    light.shadow.normalBias = Math.max(radius * 0.0015, 0.001)

    const cam = light.shadow.camera
    cam.left = -radius * 1.15
    cam.right = radius * 1.15
    cam.top = radius * 1.15
    cam.bottom = -radius * 1.15
    cam.near = Math.max(distance - radius * 1.5, 0.05)
    cam.far = distance + radius * 1.5
    cam.updateProjectionMatrix()
  }

  setWireframe(enabled: boolean) {
    this.wireframe = enabled
    this.modelGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        if ('wireframe' in std) std.wireframe = enabled
      }
    })
  }

  isWireframe() {
    return this.wireframe
  }

  fitToScreen(target: THREE.Object3D = this.modelGroup) {
    const box = new THREE.Box3().setFromObject(target)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    this.controls.target.copy(center)

    const fov = this.perspectiveCamera.fov * (Math.PI / 180)
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.6
    const dir = new THREE.Vector3(1, 0.7, 1).normalize()
    this.perspectiveCamera.position.copy(center).addScaledVector(dir, distance)
    this.perspectiveCamera.near = Math.max(distance / 100, 0.01)
    this.perspectiveCamera.far = distance * 100
    this.perspectiveCamera.updateProjectionMatrix()

    this.orthoViewSize = maxDim * 1.6
    this.orthographicCamera.position.copy(center).addScaledVector(dir, distance)
    this.handleResize()

    this.grid.position.y = box.min.y
    if (target === this.modelGroup) this.recomputeModelBox()
  }

  resetCamera() {
    this.fitToScreen()
  }

  raycastAtNdc(ndcX: number, ndcY: number): THREE.Object3D | null {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = raycaster.intersectObject(this.modelGroup, true)
    if (hits.length === 0) return null
    return hits[0].object
  }

  /** Face Select mode: raycast for the individual triangle under the cursor, translated to a
   * stable canonical face index (see three/faceMaterials.ts). Skips viewport-only helper meshes
   * (edge preview lines) so clicking near an edge outline doesn't hit the outline geometry
   * instead of the model triangle underneath it. */
  raycastFaceAtNdc(ndcX: number, ndcY: number): FaceHit | null {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = raycaster.intersectObject(this.modelGroup, true)
    const hit = hits.find((h) => (h.object as THREE.Mesh).isMesh && !isAuxiliaryMesh(h.object) && h.faceIndex != null)
    if (!hit) return null
    const mesh = hit.object as THREE.Mesh
    const componentId = SceneManager.findComponentId(mesh)
    if (!componentId) return null
    return { mesh, componentId, canonicalFaceIndex: toCanonicalFaceIndex(mesh, hit.faceIndex!) }
  }

  /** Face Select mode marquee: finds the mesh under the rectangle's center, then tests every one
   * of its faces by projecting its centroid to screen space and — for candidates that land inside
   * the rectangle — firing a single-point raycast through that same screen position to confirm
   * this face (not some other, closer one) is what's actually visible there. Faces of other
   * objects are never considered, matching the single-object face-selection model used
   * throughout (mirrors how "SELECTED: N faces on X" is always scoped to one object). */
  pickFacesInRect(x0: number, y0: number, x1: number, y1: number, width: number, height: number): FaceRectPick | null {
    // The rectangle's exact center often lands in empty space between limbs/parts of a mesh
    // rather than on geometry, so the target object is resolved by trying several candidate
    // points across the rectangle (corners, edge midpoints, center) rather than the center alone.
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const candidates: [number, number][] = [
      [x0, y0],
      [x1, y1],
      [cx, cy],
      [x1, y0],
      [x0, y1],
      [cx, y0],
      [cx, y1],
      [x0, cy],
      [x1, cy],
    ]
    let hit: FaceHit | null = null
    for (const [px, py] of candidates) {
      hit = this.raycastFaceAtNdc((px / width) * 2 - 1, -(py / height) * 2 + 1)
      if (hit) break
    }
    if (!hit) return null
    const { mesh, componentId } = hit

    const canonical = getCanonicalGeometry(mesh)
    if (!canonical) return null
    const faceCount = getFaceCount(canonical)
    if (faceCount > MARQUEE_FACE_COUNT_LIMIT) return { componentId, faceIndices: [], tooDense: true }

    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)

    mesh.updateWorldMatrix(true, false)
    const centroid = new THREE.Vector3()
    const testRaycaster = new THREE.Raycaster()
    const faceIndices: number[] = []

    for (let f = 0; f < faceCount; f++) {
      const [a, b, c] = getFaceLocalPositions(canonical, f)
      centroid.set(0, 0, 0).add(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld)
      const screen = centroid.clone().project(this.camera)
      if (screen.z < -1 || screen.z > 1) continue
      const sx = ((screen.x + 1) / 2) * width
      const sy = ((-screen.y + 1) / 2) * height
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue

      testRaycaster.setFromCamera(new THREE.Vector2((sx / width) * 2 - 1, -(sy / height) * 2 + 1), this.camera)
      const testHits = testRaycaster.intersectObject(mesh, false)
      if (testHits.length === 0) continue
      const nearestFace = testHits[0].faceIndex
      if (nearestFace == null || toCanonicalFaceIndex(mesh, nearestFace) !== f) continue // occluded

      faceIndices.push(f)
    }

    return { componentId, faceIndices, tooDense: false }
  }

  /** Shows (or clears, when componentId is null) a semi-transparent overlay over the given
   * canonical face indices of one object. Built from the mesh's canonical geometry so it stays
   * correct regardless of whether that mesh currently has a derived multi-material geometry, and
   * kept as a scene-level sibling (not a child of the mesh) with a one-off copy of its world
   * matrix — like the selection/hover BoxHelpers — so it can never be mistaken for real model
   * geometry by code that walks the model tree (material application, export, raycasting). */
  setFaceHighlight(componentId: string | null, faceIndices: Iterable<number>) {
    for (const child of this.faceHighlightGroup.children) {
      const mesh = child as THREE.Mesh
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.faceHighlightGroup.clear()
    if (!componentId) return

    const obj = this.findObjectByComponentId(componentId)
    if (!obj || !(obj as THREE.Mesh).isMesh) return
    const mesh = obj as THREE.Mesh
    const canonical = getCanonicalGeometry(mesh)
    if (!canonical) return

    const positions: number[] = []
    for (const faceIndex of faceIndices) {
      const [a, b, c] = getFaceLocalPositions(canonical, faceIndex)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    }
    if (positions.length === 0) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.MeshBasicMaterial({
      color: FACE_HIGHLIGHT_COLOR,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    const highlight = new THREE.Mesh(geometry, material)
    highlight.userData.isFaceHighlight = true
    highlight.renderOrder = 998
    highlight.matrixAutoUpdate = false
    mesh.updateWorldMatrix(true, false)
    highlight.matrix.copy(mesh.matrixWorld)
    highlight.matrixWorldNeedsUpdate = true
    this.faceHighlightGroup.add(highlight)
  }

  /** Walks up from a raycast hit to find the node carrying a componentId (should be immediate,
   * since every imported node is stamped, but this stays robust if geometry gets re-parented). */
  static findComponentId(obj: THREE.Object3D | null): string | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      const id = cur.userData[COMPONENT_ID_KEY]
      if (id) return id
      cur = cur.parent
    }
    return null
  }

  findObjectByComponentId(componentId: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null
    this.modelGroup.traverse((obj) => {
      if (found) return
      if (obj.userData[COMPONENT_ID_KEY] === componentId) found = obj
    })
    return found
  }

  setSelection(componentIds: string[]) {
    this.selectionHelpers.clear()
    for (const id of componentIds) {
      const obj = this.findObjectByComponentId(id)
      if (!obj) continue
      const helper = new THREE.BoxHelper(obj, SELECTION_COLOR)
      const mat = helper.material as THREE.LineBasicMaterial
      mat.depthTest = false
      mat.transparent = true
      helper.renderOrder = 999
      helper.update()
      this.selectionHelpers.add(helper)
    }
  }

  setHover(componentId: string | null) {
    this.hoverHelpers.clear()
    if (!componentId) return
    const obj = this.findObjectByComponentId(componentId)
    if (!obj) return
    const helper = new THREE.BoxHelper(obj, HOVER_COLOR)
    const mat = helper.material as THREE.LineBasicMaterial
    mat.depthTest = false
    mat.transparent = true
    mat.opacity = 0.6
    helper.update()
    this.hoverHelpers.add(helper)
  }

  setGridVisible(visible: boolean) {
    this.grid.visible = visible
  }

  setAxesVisible(visible: boolean) {
    this.axes.visible = visible
  }
}
