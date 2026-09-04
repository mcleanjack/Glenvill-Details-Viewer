import { useEffect, useRef, useState } from 'react'
import { SceneManager } from '../three/SceneManager'
import { usePublishStore } from '../store/usePublishStore'
import type { BuildStageSummary } from '../types/publish'
import { isProductInfoEmpty, type ProductInfo } from '../types/product'
import { CameraSnapper } from './cameraSnap'
import { OrbitCubeGizmo } from './OrbitCubeGizmo'
import { applyStageIsolation } from './stageIsolation'

function ChevIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M10.26 4.34 17.92 12 10.26 19.66 8.14 17.54 13.68 12 8.14 6.46Z" />
    </svg>
  )
}

function CycleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.2 11.4V9.6a3.4 3.4 0 0 1 3.4-3.4h7.6" />
      <path d="m15.4 3.4 2.9 2.8-2.9 2.8" />
      <path d="M17.8 12.6v1.8a3.4 3.4 0 0 1-3.4 3.4H6.8" />
      <path d="m8.6 20.6-2.9-2.8 2.9-2.8" />
    </svg>
  )
}

function ToolbarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" className="pv-toolbar__btn" title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** `/presentation/model/:id` — the read-only 3D viewer. Reuses `SceneManager` (materials,
 * lighting, edges, selection/hover highlighting) unmodified from the editor, loads the published
 * GLB via `GLTFLoader`, and reads `productInfo`/`buildStageId` straight off each node's `userData`
 * — both round-trip automatically through glTF `extras`, so no new plumbing was needed for either. */
export function PresentationViewer({ id, onBack }: { id: string; onBack: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const smRef = useRef<SceneManager | null>(null)
  const snapperRef = useRef<CameraSnapper | null>(null)
  const rootRef = useRef<import('three').Object3D | null>(null)
  const baseDistanceRef = useRef(10)

  const snapshots = usePublishStore((s) => s.snapshots)
  const loadAll = usePublishStore((s) => s.loadAll)
  const meta = snapshots.find((s) => s.id === id) ?? null

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buildStages, setBuildStages] = useState<BuildStageSummary[]>([])
  const [stageIdx, setStageIdx] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedInfo, setSelectedInfo] = useState<ProductInfo | null>(null)
  const [zoom, setZoom] = useState(50)

  useEffect(() => {
    if (snapshots.length === 0) void loadAll()
  }, [snapshots.length, loadAll])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false

    const sm = new SceneManager()
    smRef.current = sm
    sm.mount(container)
    const snapper = new CameraSnapper(sm)
    snapperRef.current = snapper
    const offTick = sm.onTick(() => snapper.tick())

    async function load() {
      setLoadState('loading')
      setLoadError(null)
      try {
        const res = await fetch(`/api/publish/${id}/model.glb`)
        if (!res.ok) throw new Error(res.status === 404 ? 'This model is no longer published.' : `Failed to load model (${res.status})`)
        const buf = await res.arrayBuffer()
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const gltf = await new GLTFLoader().parseAsync(buf, '')
        if (disposed) return
        rootRef.current = gltf.scene
        sm.setModel(gltf.scene)
        sm.fitToScreen()
        baseDistanceRef.current = sm.camera.position.distanceTo(sm.controls.target)
        setZoom(50)
        const stages = (gltf.userData?.buildStages as BuildStageSummary[] | undefined) ?? []
        setBuildStages([...stages].sort((a, b) => a.order - b.order))
        setStageIdx(null)
        setLoadState('ready')
      } catch (err) {
        if (!disposed) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load model')
          setLoadState('error')
        }
      }
    }
    void load()

    function ndcFromEvent(e: PointerEvent) {
      const rect = container!.getBoundingClientRect()
      return { x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }
    }

    let downPos: { x: number; y: number } | null = null
    function onPointerDown(e: PointerEvent) {
      downPos = { x: e.clientX, y: e.clientY }
    }
    function onPointerUp(e: PointerEvent) {
      const down = downPos
      downPos = null
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const { x, y } = ndcFromEvent(e)
      setSelectedId(SceneManager.findComponentId(sm.raycastAtNdc(x, y)))
    }
    function onPointerMove(e: PointerEvent) {
      if (e.buttons) return
      const { x, y } = ndcFromEvent(e)
      setHoveredId(SceneManager.findComponentId(sm.raycastAtNdc(x, y)))
    }
    function onPointerLeave() {
      setHoveredId(null)
    }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerleave', onPointerLeave)

    return () => {
      disposed = true
      offTick()
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      sm.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    smRef.current?.setSelection(selectedId ? [selectedId] : [])
    if (!selectedId) {
      setSelectedInfo(null)
      return
    }
    const obj = smRef.current?.findObjectByComponentId(selectedId)
    const info = (obj?.userData.productInfo as ProductInfo | undefined) ?? null
    setSelectedInfo(info && !isProductInfoEmpty(info) ? info : null)
  }, [selectedId])

  useEffect(() => {
    smRef.current?.setHover(hoveredId)
  }, [hoveredId])

  useEffect(() => {
    if (!rootRef.current) return
    const stageId = stageIdx === null ? null : (buildStages[stageIdx]?.id ?? null)
    applyStageIsolation(rootRef.current, stageId)
    setSelectedId(null)
  }, [stageIdx, buildStages])

  function cycleStage(dir: 1 | -1) {
    if (buildStages.length === 0) return
    setStageIdx((cur) => {
      const total = buildStages.length + 1 // "whole model" plus each stage
      const at = cur === null ? 0 : cur + 1
      const next = (((at + dir) % total) + total) % total
      return next === 0 ? null : next - 1
    })
  }

  function cycleComponent(dir: 1 | -1) {
    const ids = meta?.componentsWithProductInfo ?? []
    if (ids.length === 0) return
    const at = selectedId ? ids.indexOf(selectedId) : -1
    setSelectedId(ids[(((at + dir) % ids.length) + ids.length) % ids.length])
  }

  function handleZoom(v: number) {
    setZoom(v)
    const sm = smRef.current
    if (!sm) return
    const dist = baseDistanceRef.current * (1.8 - (v / 100) * 1.45)
    const t = sm.controls.target
    const dir = sm.camera.position.clone().sub(t).normalize()
    sm.camera.position.copy(t.clone().add(dir.multiplyScalar(dist)))
  }

  const currentStage = stageIdx === null ? null : buildStages[stageIdx]
  const viewTitle = currentStage ? currentStage.name : (meta?.modelName ?? 'Model')

  return (
    <div className="pv-root pv-viewer">
      <div className="pv-frame">
        <header className="pv-header">
          <button type="button" className="pv-header__back" onClick={onBack} title="Back to Published Details">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="pv-header__logo">GLENVILL HOMES</div>
          <div className="pv-header__toolbar">
            <ToolbarButton title="Previous stage" disabled={buildStages.length === 0} onClick={() => cycleStage(-1)}>
              <ChevIcon flip />
            </ToolbarButton>
            <ToolbarButton title="Next stage" disabled={buildStages.length === 0} onClick={() => cycleStage(1)}>
              <ChevIcon />
            </ToolbarButton>
            <ToolbarButton title="Cycle components" disabled={!meta || meta.componentsWithProductInfo.length === 0} onClick={() => cycleComponent(1)}>
              <CycleIcon />
            </ToolbarButton>
          </div>
          <div className="pv-header__spacer" />
        </header>

        <div className="pv-body">
          <aside className="pv-sidebar">
            <div className="pv-panel pv-panel--info">
              <div className="pv-panel__inner">
                {!selectedInfo ? (
                  <div className="pv-prompt">
                    <div className="pv-section-row">
                      <span className="pv-dot pv-dot--accent">+</span>
                      <span className="pv-section-label">Get started</span>
                      <span className="pv-section-line" />
                    </div>
                    <div className="pv-prompt__title">Click on model components to view product information</div>
                    <div className="pv-prompt__hint">Hover to preview a part, click to isolate it, or use the cycle icon above.</div>
                  </div>
                ) : (
                  <div className="pv-info">
                    <div className="pv-info__desc">
                      <div className="pv-section-row">
                        <span className="pv-section-label">Description</span>
                        <span className="pv-section-line" />
                      </div>
                      <div className="pv-info__text">{selectedInfo.description || '—'}</div>
                    </div>
                    {(selectedInfo.installationManualUrl || selectedInfo.productPageUrl) && (
                      <div className="pv-info__documents">
                        <div className="pv-section-row">
                          <span className="pv-section-label">Documents</span>
                          <span className="pv-section-line" />
                        </div>
                        {selectedInfo.installationManualUrl && (
                          <a className="pv-info__link" href={selectedInfo.installationManualUrl} target="_blank" rel="noopener noreferrer">
                            <span className="pv-dot pv-dot--dark">+</span>
                            <span>Installation manual</span>
                          </a>
                        )}
                        {selectedInfo.productPageUrl && (
                          <a className="pv-info__link" href={selectedInfo.productPageUrl} target="_blank" rel="noopener noreferrer">
                            <span className="pv-dot pv-dot--dark">+</span>
                            <span>Product page</span>
                          </a>
                        )}
                      </div>
                    )}
                    {(selectedInfo.supplierName || selectedInfo.contactName || selectedInfo.phone || selectedInfo.email) && (
                      <div className="pv-info__supplier">
                        <div className="pv-section-row">
                          <span className="pv-section-label">Supplier</span>
                          <span className="pv-section-line" />
                        </div>
                        {selectedInfo.supplierName && <div className="pv-info__supplier-name">{selectedInfo.supplierName}</div>}
                        {selectedInfo.contactName && (
                          <div className="pv-info__row">
                            <span className="pv-info__row-label">Contact</span>
                            <span className="pv-info__row-value">{selectedInfo.contactName}</span>
                          </div>
                        )}
                        {selectedInfo.phone && (
                          <div className="pv-info__row">
                            <span className="pv-info__row-label">Phone</span>
                            <span className="pv-info__row-value">{selectedInfo.phone}</span>
                          </div>
                        )}
                        {selectedInfo.email && (
                          <div className="pv-info__row">
                            <span className="pv-info__row-label">Email</span>
                            <a className="pv-info__row-value pv-info__email" href={`mailto:${selectedInfo.email}`}>
                              {selectedInfo.email}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pv-panel pv-panel--meta">
              <div className="pv-panel__meta-inner">
                <div className="pv-panel__dim">3D</div>
                <div className="pv-panel__meta-col">
                  <div className="pv-section-row pv-section-row--tight">
                    <span className="pv-dot pv-dot--dim">+</span>
                    <span className="pv-section-label">Active view</span>
                  </div>
                  <div className="pv-panel__meta-title">{viewTitle}</div>
                  <div className="pv-section-line" />
                </div>
              </div>
            </div>
          </aside>

          <main className="pv-viewport">
            {currentStage && (
              <div className="pv-stage">
                <div className="pv-stage__row">
                  <span className="pv-stage__line" />
                  <span className="pv-stage__label">Assembly stage</span>
                  <span className="pv-stage__line pv-stage__line--r" />
                </div>
                <div className="pv-stage__name">{currentStage.name}</div>
                <div className="pv-stage__count">
                  Stage {stageIdx! + 1} / {buildStages.length}
                </div>
              </div>
            )}

            <div ref={containerRef} className="pv-viewport__mount" />

            {loadState === 'loading' && <div className="pv-viewport__status">Loading model…</div>}
            {loadState === 'error' && <div className="pv-viewport__status pv-viewport__status--error">{loadError}</div>}

            {loadState === 'ready' && (
              <div className="pv-viewport__gizmo">
                <OrbitCubeGizmo getQuaternion={() => smRef.current?.camera.quaternion ?? null} onSelectView={(name) => snapperRef.current?.snapTo(name)} />
              </div>
            )}

            <div className="pv-viewport__zoom">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6.2" />
                <path d="m15.2 15.2 4.3 4.3M8 10.5h5" />
              </svg>
              <input type="range" min={0} max={100} value={zoom} onChange={(e) => handleZoom(Number(e.target.value))} />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6.2" />
                <path d="m15.2 15.2 4.3 4.3M8 10.5h5M10.5 8v5" />
              </svg>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
