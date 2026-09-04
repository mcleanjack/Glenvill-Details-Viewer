import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useProjectStore } from '../../store/useProjectStore'
import { usePublishStore } from '../../store/usePublishStore'
import { exportGlb, downloadBlob } from '../../three/exportGlb'
import { validateGlb, type GlbValidationReport } from '../../three/reimportValidate'
import { downloadProductInfoCsv } from '../../utils/exportProductInfo'
import { Icon } from '../common/Icon'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { PromptDialog } from '../common/PromptDialog'
import { ExportReportModal } from '../common/ExportReportModal'

export function TopBar() {
  const fbxInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [report, setReport] = useState<{ report: GlbValidationReport; fileName: string } | null>(null)
  const [confirmingPublish, setConfirmingPublish] = useState(false)
  const [namingPublish, setNamingPublish] = useState(false)

  const importFbxFile = useAppStore((s) => s.importFbxFile)
  const importing = useAppStore((s) => s.importing)
  const fbxFileName = useAppStore((s) => s.fbxFileName)
  const modelRoot = useAppStore((s) => s.modelRoot)
  const sceneManager = useAppStore((s) => s.sceneManager)
  const edgeSettings = useAppStore((s) => s.edgeSettings)
  const exportSettings = useAppStore((s) => s.exportSettings)
  const productInfo = useAppStore((s) => s.productInfo)
  const objectMeta = useAppStore((s) => s.objectMeta)
  const folders = useAppStore((s) => s.folders)
  const folderMembership = useAppStore((s) => s.folderMembership)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  const projectName = useProjectStore((s) => s.currentProjectName)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const setCurrentProjectName = useProjectStore((s) => s.setCurrentProjectName)
  const saveCurrentAsProject = useProjectStore((s) => s.saveCurrentAsProject)

  const publish = usePublishStore((s) => s.publish)
  const publishing = usePublishStore((s) => s.publishing)

  function handleFbxChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void importFbxFile(file)
    e.target.value = ''
  }

  function handleExportProductInfo() {
    const baseName = (fbxFileName ?? 'model').replace(/\.fbx$/i, '')
    downloadProductInfoCsv(productInfo, objectMeta, `${baseName}-product-info.csv`)
    setStatusMessage(`Exported product information for ${Object.keys(productInfo).length} object(s).`)
  }

  async function handlePublish(label: string) {
    setNamingPublish(false)
    try {
      const saved = await publish(label)
      setStatusMessage(`Published "${saved.label}" — visible in the Presentation section.`)
      useAppStore.getState().setActiveRightPanel('published')
    } catch (err) {
      setStatusMessage(`Publish failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleExport() {
    if (!modelRoot || !sceneManager) return
    setExporting(true)
    setStatusMessage('Exporting GLB…')
    try {
      const baseName = (fbxFileName ?? 'model').replace(/\.fbx$/i, '')
      const blob = await exportGlb({
        modelGroup: sceneManager.modelGroup,
        exportSettings,
        edgeSettings,
        folders,
        folderMembership,
      })
      downloadBlob(blob, `${baseName}.glb`)

      setStatusMessage('Validating exported GLB…')
      const validation = await validateGlb(blob)
      setReport({ report: validation, fileName: `${baseName}.glb` })
      setStatusMessage(`Exported ${baseName}.glb — ${validation.meshCount} meshes, ${validation.materialCount} materials.`)
    } catch (err) {
      setStatusMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-3 border-b px-3 text-[13px]"
      style={{ background: 'var(--topbar-bg)', borderColor: 'var(--panel-border)' }}
    >
      <div className="relative">
        <button
          className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/5"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="font-semibold tracking-wide text-[var(--text)]">Material Editor</span>
          <Icon name="chevronDown" size={12} className="text-[var(--text-dim)]" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] py-1 shadow-xl">
              <MenuItem icon="import" label="Import FBX…" onClick={() => fbxInputRef.current?.click()} />
              <MenuItem
                icon="export"
                label="Export GLB…"
                disabled={!modelRoot}
                onClick={() => void handleExport()}
              />
              <MenuItem
                icon="export"
                label="Export Product Information (CSV)…"
                disabled={Object.keys(productInfo).length === 0}
                onClick={handleExportProductInfo}
              />
              <div className="my-1 h-px bg-[var(--panel-border)]" />
              <MenuItem icon="save" label="Save Project" onClick={() => void saveCurrentAsProject()} />
              <MenuItem icon="folder" label="Open Project…" onClick={() => useAppStore.getState().setActiveRightPanel('objectTree')} />
              <div className="my-1 h-px bg-[var(--panel-border)]" />
              <MenuItem
                icon="flag"
                label="Publish…"
                disabled={!modelRoot}
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmingPublish(true)
                }}
              />
            </div>
          </>
        )}
      </div>

      <input
        ref={fbxInputRef}
        type="file"
        accept=".fbx"
        className="hidden"
        onChange={handleFbxChosen}
      />

      <div className="h-5 w-px bg-[var(--panel-border)]" />

      <input
        className="w-52 rounded bg-transparent px-1.5 py-1 text-[var(--text)] outline-none hover:bg-white/5 focus:bg-white/5"
        value={projectName}
        onChange={(e) => setCurrentProjectName(e.target.value)}
      />
      <span className="text-[11px] text-[var(--text-faint)]">
        {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes'}
      </span>

      <div className="flex-1" />

      {fbxFileName && <span className="truncate text-[11px] text-[var(--text-dim)]">{fbxFileName}</span>}

      <Button
        variant="secondary"
        icon={<Icon name="import" size={14} />}
        onClick={() => fbxInputRef.current?.click()}
        disabled={importing}
      >
        {importing ? 'IMPORTING…' : 'IMPORT FBX'}
      </Button>
      <Button
        variant="primary"
        icon={<Icon name="export" size={14} />}
        onClick={() => void handleExport()}
        disabled={!modelRoot || exporting}
      >
        {exporting ? 'EXPORTING…' : 'EXPORT GLB'}
      </Button>
      <Button
        variant="secondary"
        icon={<Icon name="flag" size={14} />}
        onClick={() => setConfirmingPublish(true)}
        disabled={!modelRoot || publishing}
      >
        {publishing ? 'PUBLISHING…' : 'PUBLISH'}
      </Button>

      {report && <ExportReportModal report={report.report} fileName={report.fileName} onClose={() => setReport(null)} />}

      {confirmingPublish && (
        <ConfirmDialog
          title="Publish this model?"
          message="This will make the current model visible to anyone with access to the Presentation section. Continue?"
          confirmLabel="PUBLISH"
          onCancel={() => setConfirmingPublish(false)}
          onConfirm={() => {
            setConfirmingPublish(false)
            setNamingPublish(true)
          }}
        />
      )}
      {namingPublish && (
        <PromptDialog
          title="Name this published snapshot"
          label="Clients will see this name in the Presentation section."
          initialValue={fbxFileName ? fbxFileName.replace(/\.fbx$/i, '') : ''}
          confirmLabel="PUBLISH"
          onCancel={() => setNamingPublish(false)}
          onConfirm={(label) => void handlePublish(label)}
        />
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-white/5 disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={14} className="text-[var(--text-dim)]" />
      {label}
    </button>
  )
}
