import type * as THREE from 'three'

/** Shows only the objects belonging to one build stage (plus their ancestors, so the visible
 * branch of the scene graph actually renders — three.js hides a whole subtree when any ancestor's
 * `.visible` is false) — or everything, when `stageId` is null. Mirrors the spirit of
 * `useAppStore.ts`'s `isolateSelected()`/`applyVisibility` (include descendants of the target),
 * extended to also include ancestors since here the "target" can be deep in the tree rather than
 * always starting from an explicit user selection. */
export function applyStageIsolation(root: THREE.Object3D, stageId: string | null) {
  if (stageId === null) {
    root.traverse((obj) => {
      obj.visible = true
    })
    return
  }

  const include = new Set<THREE.Object3D>()
  root.traverse((obj) => {
    if ((obj.userData.buildStageId as string | undefined) !== stageId) return
    obj.traverse((descendant) => include.add(descendant))
    let p: THREE.Object3D | null = obj.parent
    while (p) {
      include.add(p)
      p = p.parent
    }
  })
  root.traverse((obj) => {
    obj.visible = include.has(obj)
  })
}
