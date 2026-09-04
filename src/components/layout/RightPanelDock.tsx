import { useAppStore, type RightPanelKey } from '../../store/useAppStore'
import { Icon, type IconName } from '../common/Icon'
import { ObjectTreePanel } from '../panels/ObjectTreePanel'
import { MaterialLibraryPanel } from '../panels/MaterialLibraryPanel'
import { MaterialEditorPanel } from '../panels/MaterialEditorPanel'
import { EdgeSettingsPanel } from '../panels/EdgeSettingsPanel'
import { SunSettingsPanel } from '../panels/SunSettingsPanel'
import { PublishedSnapshotsPanel } from '../panels/PublishedSnapshotsPanel'

const RAIL_ITEMS: { key: RightPanelKey; icon: IconName; label: string }[] = [
  { key: 'objectTree', icon: 'tree', label: 'Object Tree' },
  { key: 'materials', icon: 'material', label: 'Custom Material Library' },
  { key: 'edgeSettings', icon: 'edges', label: 'Component Edge Settings' },
  { key: 'published', icon: 'flag', label: 'Published Snapshots' },
]

export function RightPanelDock() {
  const activeRightPanel = useAppStore((s) => s.activeRightPanel)
  const setActiveRightPanel = useAppStore((s) => s.setActiveRightPanel)

  return (
    <div className="flex h-full">
      {activeRightPanel === 'objectTree' && <ObjectTreePanel />}
      {activeRightPanel === 'materials' && <MaterialLibraryPanel />}
      {activeRightPanel === 'materialEditor' && <MaterialEditorPanel />}
      {activeRightPanel === 'edgeSettings' && <EdgeSettingsPanel />}
      {activeRightPanel === 'sun' && <SunSettingsPanel />}
      {activeRightPanel === 'published' && <PublishedSnapshotsPanel />}

      <div
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-l py-2"
        style={{ background: 'var(--rail-bg)', borderColor: 'var(--panel-border)' }}
      >
        {RAIL_ITEMS.map((item) => {
          const active = activeRightPanel === item.key || (item.key === 'materials' && activeRightPanel === 'materialEditor')
          return (
            <button
              key={item.key}
              title={item.label}
              onClick={() => setActiveRightPanel(active && activeRightPanel === item.key ? null : item.key)}
              className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                active ? 'bg-blue-600 text-white' : 'text-[var(--text-dim)] hover:bg-white/10 hover:text-[var(--text)]'
              }`}
            >
              <Icon name={item.icon} size={17} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
