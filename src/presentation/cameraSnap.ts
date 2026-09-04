import * as THREE from 'three'
import type { SceneManager } from '../three/SceneManager'

const DIRS: Record<string, [number, number, number]> = {
  front: [0, 0.02, 1],
  back: [0, 0.02, -1],
  right: [1, 0.02, 0],
  left: [-1, 0.02, 0],
  top: [0.001, 1, 0.001],
  bottom: [0.001, -1, 0.001],
  iso: [1, 0.78, 1.1],
}

/** Eased camera snap-to-preset-view, driving `SceneManager`'s existing camera/controls (no changes
 * to SceneManager needed beyond the generic `onTick` hook) — ported from the standalone Detail
 * Viewer prototype's `snap()`/`tickSnap()` (app/js/viewer.js), which used the same easing against
 * its own hand-rolled camera. Register `tick()` via `sceneManager.onTick(...)`. */
export class CameraSnapper {
  private anim: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number } | null = null
  private sm: SceneManager

  constructor(sm: SceneManager) {
    this.sm = sm
  }

  snapTo(name: keyof typeof DIRS) {
    const dir = DIRS[name] ?? DIRS.iso
    const t = this.sm.controls.target
    const dist = this.sm.camera.position.distanceTo(t)
    const to = new THREE.Vector3(...dir).normalize().multiplyScalar(dist)
    this.anim = { from: this.sm.camera.position.clone().sub(t), to, t0: performance.now(), dur: 520 }
  }

  tick() {
    const a = this.anim
    if (!a) return
    const k = Math.min(1, (performance.now() - a.t0) / a.dur)
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2 // easeInOutCubic
    const t = this.sm.controls.target
    const off = new THREE.Vector3().copy(a.from).lerp(a.to, e)
    off.normalize().multiplyScalar(a.from.length() * (1 - e) + a.to.length() * e)
    this.sm.camera.position.copy(t.clone().add(off))
    this.sm.camera.lookAt(t)
    if (k >= 1) this.anim = null
  }
}
