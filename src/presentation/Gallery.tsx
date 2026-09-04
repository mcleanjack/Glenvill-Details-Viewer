import { useEffect } from 'react'
import { usePublishStore } from '../store/usePublishStore'

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** `/presentation` — every currently published model, newest first. No equivalent screen exists
 * in the Detail Viewer reference design either; built as brushed-plate cards in the same visual
 * language rather than inventing a mismatched UI. */
export function Gallery({ onSelect }: { onSelect: (id: string) => void }) {
  const snapshots = usePublishStore((s) => s.snapshots)
  const loading = usePublishStore((s) => s.loading)
  const error = usePublishStore((s) => s.error)
  const loadAll = usePublishStore((s) => s.loadAll)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  return (
    <div className="pv-root pv-gallery">
      <header className="pv-gallery__header">
        <div className="pv-gallery__brand">GLENVILL HOMES</div>
        <div className="pv-gallery__subtitle">Published Details</div>
      </header>

      <main className="pv-gallery__main">
        {loading && <div className="pv-gallery__status">Loading…</div>}
        {error && <div className="pv-gallery__status pv-gallery__status--error">{error}</div>}
        {!loading && !error && snapshots.length === 0 && (
          <div className="pv-gallery__status">Nothing has been published yet.</div>
        )}

        <div className="pv-gallery__grid">
          {snapshots.map((snap) => (
            <button key={snap.id} className="pv-card" onClick={() => onSelect(snap.id)}>
              <div className="pv-card__thumb">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.6 20.9 7.3v9.4L12 21.4 3.1 16.7V7.3z" />
                  <path d="M12 12 20.9 7.3M12 12 3.1 7.3M12 12v9.4" />
                </svg>
              </div>
              <div className="pv-card__body">
                <div className="pv-card__name">{snap.label}</div>
                <div className="pv-card__meta">
                  <span>{snap.modelName}</span>
                  <span>{formatDate(snap.createdAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
