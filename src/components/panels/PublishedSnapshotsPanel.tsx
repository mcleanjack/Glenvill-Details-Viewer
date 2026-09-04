import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { usePublishStore } from '../../store/usePublishStore'
import type { PublishedSnapshotMeta } from '../../types/publish'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { Icon } from '../common/Icon'
import { PromptDialog } from '../common/PromptDialog'
import { PanelShell } from './PanelShell'

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Owner-only — lists every published snapshot with re-publish/unpublish/rename actions. Clients
 * in the Presentation section never see this panel; they only see the resulting list at
 * GET /api/publish, rendered by src/presentation/Gallery.tsx. */
export function PublishedSnapshotsPanel() {
  const setActiveRightPanel = useAppStore((s) => s.setActiveRightPanel)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const snapshots = usePublishStore((s) => s.snapshots)
  const loading = usePublishStore((s) => s.loading)
  const publishing = usePublishStore((s) => s.publishing)
  const error = usePublishStore((s) => s.error)
  const loadAll = usePublishStore((s) => s.loadAll)
  const republish = usePublishStore((s) => s.republish)
  const unpublish = usePublishStore((s) => s.unpublish)
  const renameLabel = usePublishStore((s) => s.renameLabel)

  const [confirmingUnpublish, setConfirmingUnpublish] = useState<PublishedSnapshotMeta | null>(null)
  const [renaming, setRenaming] = useState<PublishedSnapshotMeta | null>(null)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function handleRepublish(id: string) {
    try {
      await republish(id)
      setStatusMessage('Re-published — the Presentation section now shows the current model state.')
    } catch (err) {
      setStatusMessage(`Re-publish failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleUnpublish(snap: PublishedSnapshotMeta) {
    setConfirmingUnpublish(null)
    try {
      await unpublish(snap.id)
      setStatusMessage(`Unpublished "${snap.label}" — it no longer appears in the Presentation section.`)
    } catch (err) {
      setStatusMessage(`Unpublish failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleRename(label: string) {
    if (!renaming) return
    const snap = renaming
    setRenaming(null)
    try {
      await renameLabel(snap.id, label)
    } catch (err) {
      setStatusMessage(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <PanelShell title="Published Snapshots" onClose={() => setActiveRightPanel(null)}>
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
          Everything listed here is visible to anyone with the Presentation section's access code. Use{' '}
          <span className="text-[var(--text)]">Publish…</span> in the top bar to add a new one.
        </p>

        {loading && <p className="text-xs text-[var(--text-dim)]">Loading…</p>}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        {!loading && snapshots.length === 0 && <p className="text-xs text-[var(--text-faint)]">Nothing published yet.</p>}

        {snapshots.map((snap) => (
          <div key={snap.id} className="rounded-md border p-2.5" style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-bg-alt)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-[var(--text)]">{snap.label}</div>
                <div className="truncate text-[10.5px] text-[var(--text-dim)]">{snap.modelName}</div>
              </div>
              <button
                title="Rename"
                className="shrink-0 rounded p-1 text-[var(--text-dim)] hover:bg-white/10 hover:text-[var(--text)]"
                onClick={() => setRenaming(snap)}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-[var(--text-faint)]">
              <span>Published {formatDate(snap.createdAt)}</span>
              {snap.updatedAt !== snap.createdAt && <span>Updated {formatDate(snap.updatedAt)}</span>}
            </div>
            {snap.buildStages.length > 0 && (
              <div className="mt-1 text-[10.5px] text-[var(--text-faint)]">{snap.buildStages.length} build stage(s)</div>
            )}
            <div className="mt-2 flex gap-1.5">
              <Button variant="secondary" className="flex-1" disabled={publishing} onClick={() => void handleRepublish(snap.id)}>
                RE-PUBLISH
              </Button>
              <Button variant="danger" className="flex-1" disabled={publishing} onClick={() => setConfirmingUnpublish(snap)}>
                UNPUBLISH
              </Button>
            </div>
          </div>
        ))}
      </div>

      {confirmingUnpublish && (
        <ConfirmDialog
          title="Unpublish this model?"
          message={`"${confirmingUnpublish.label}" will be removed from the Presentation section immediately. This can't be undone — publishing it again will create a new snapshot.`}
          confirmLabel="UNPUBLISH"
          danger
          onCancel={() => setConfirmingUnpublish(null)}
          onConfirm={() => void handleUnpublish(confirmingUnpublish)}
        />
      )}

      {renaming && (
        <PromptDialog
          title="Rename published snapshot"
          initialValue={renaming.label}
          confirmLabel="SAVE"
          onCancel={() => setRenaming(null)}
          onConfirm={(label) => void handleRename(label)}
        />
      )}
    </PanelShell>
  )
}
