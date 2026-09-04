import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** Navigation gizmo in the top-right of the viewport — ported from the standalone Detail Viewer
 * prototype's `app/js/orbit-cube.js`. Renders its own tiny three.js canvas kept live-synced to the
 * main viewport camera's quaternion (polled per frame via `getQuaternion`, no React re-renders
 * while orbiting), plus four directional snap arrows. */

const STYLE = {
  faceColor: '#4a4a48',
  faceColorHover: '#4e4e4c',
  edgeColor: '#5c5b59',
  edgeOpacity: 0.35,
  roughness: 0.55,
  metalness: 0.06,
  ambient: 0.16,
  keyIntensity: 3.2,
  keyPosition: [-0.9, 1.5, 0.9] as const,
  keyColor: '#f2efe9',
  rimIntensity: 0.16,
  rimPosition: [-1.1, 0.35, -0.9] as const,
  rimColor: '#9aa09b',
  cubeScale: 0.62,
  hoverLift: 1.035,
}

const FACES = [
  { name: 'right', normal: [1, 0, 0] },
  { name: 'left', normal: [-1, 0, 0] },
  { name: 'top', normal: [0, 1, 0] },
  { name: 'bottom', normal: [0, -1, 0] },
  { name: 'front', normal: [0, 0, 1] },
  { name: 'back', normal: [0, 0, -1] },
] as const

type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export function OrbitCubeGizmo({
  size = 78,
  getQuaternion,
  onSelectView,
}: {
  size?: number
  getQuaternion: () => THREE.Quaternion | null
  onSelectView: (name: ViewName) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<string | null>(null)
  const getQuatRef = useRef(getQuaternion)
  const onSelectRef = useRef(onSelectView)
  useEffect(() => {
    getQuatRef.current = getQuaternion
    onSelectRef.current = onSelectView
  }, [getQuaternion, onSelectView])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(4)
    renderer.setSize(size, size)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    Object.assign(renderer.domElement.style, { width: size + 'px', height: size + 'px', display: 'block', cursor: 'pointer' })

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
    camera.position.set(0, 0, 5)

    scene.add(new THREE.AmbientLight(0xffffff, STYLE.ambient))
    const key = new THREE.DirectionalLight(new THREE.Color(STYLE.keyColor), STYLE.keyIntensity)
    key.position.set(...STYLE.keyPosition)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(STYLE.rimColor), STYLE.rimIntensity)
    rim.position.set(...STYLE.rimPosition)
    scene.add(rim)

    const pivot = new THREE.Group()
    scene.add(pivot)
    const s = STYLE.cubeScale * 1.55

    const ramp = (() => {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 128
      const cx = cv.getContext('2d')!
      const g = cx.createLinearGradient(0, 0, 128, 128)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.45, '#c9c9c7')
      g.addColorStop(1, '#6e6e6c')
      cx.fillStyle = g
      cx.fillRect(0, 0, 128, 128)
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()

    const mats = FACES.map(
      () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(STYLE.faceColor),
          map: ramp,
          roughness: STYLE.roughness,
          metalness: STYLE.metalness,
        }),
    )
    // BoxGeometry material order: +x -x +y -y +z -z — matches FACES.
    const cube = new THREE.Mesh(new THREE.BoxGeometry(s, s, s, 4, 4, 4), mats)
    pivot.add(cube)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry, 1),
      new THREE.LineBasicMaterial({ color: new THREE.Color(STYLE.edgeColor), transparent: true, opacity: STYLE.edgeOpacity }),
    )
    pivot.add(edges)

    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const el = renderer.domElement

    const pick = (ev: PointerEvent): string | null => {
      const r = el.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObject(cube, false)[0]
      if (!hit || hit.faceIndex == null) return null
      return FACES[Math.floor(hit.faceIndex / 2)].name
    }

    const onMove = (ev: PointerEvent) => {
      hoverRef.current = pick(ev)
    }
    const onLeave = () => {
      hoverRef.current = null
    }
    const onDown = (ev: PointerEvent) => ev.stopPropagation()
    const onUp = (ev: PointerEvent) => {
      const n = pick(ev)
      if (n) onSelectRef.current(n as ViewName)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)

    const q = new THREE.Quaternion()
    const inv = new THREE.Quaternion()
    const lerpTarget = new THREE.Vector3()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const src = getQuatRef.current()
      if (src) {
        q.copy(src)
        inv.copy(q).invert()
        pivot.quaternion.copy(inv)
      }
      const hover = hoverRef.current
      const target = hover ? STYLE.hoverLift : 1
      lerpTarget.set(target, target, target)
      pivot.scale.lerp(lerpTarget, 0.2)
      FACES.forEach((f, i) => {
        mats[i].color.lerp(new THREE.Color(f.name === hover ? STYLE.faceColorHover : STYLE.faceColor), 0.25)
      })
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      renderer.dispose()
      el.remove()
    }
  }, [size])

  const arrow = (cls: string, name: ViewName) => (
    <button key={name} type="button" className={`pv-gizmo__arrow ${cls}`} title={`${name} view`} onClick={() => onSelectRef.current(name)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V6M7 11l5-5 5 5" />
      </svg>
    </button>
  )

  return (
    <div className="pv-gizmo" style={{ width: size + 22, height: size + 22 }}>
      {arrow('pv-gizmo__arrow--top', 'top')}
      {arrow('pv-gizmo__arrow--front', 'front')}
      {arrow('pv-gizmo__arrow--left', 'left')}
      {arrow('pv-gizmo__arrow--right', 'right')}
      <div ref={hostRef} className="pv-gizmo__canvas-host" style={{ width: size, height: size }} />
    </div>
  )
}
