import { useEffect, useRef, type ReactNode } from 'react'
import { X, Check, FileText, FileImage, FileType2, Code2, ArrowUpRight, Download, LoaderCircle, Sun, Moon, Monitor } from 'lucide-react'
import type { ExportOptions, ExportFormat, Settings } from '../../shared/types'

export function IconButton({ label, children, active, onClick, disabled }: {
  label: string; children: ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean
}) {
  return <button className={`icon-button${active ? ' active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}

export function Modal({ title, eyebrow, children, onClose, busy }: {
  title: string; eyebrow: string; children: ReactNode; onClose: () => void; busy?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    const first = ref.current?.querySelector<HTMLElement>('button, input, select')
    first?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
      const start = nodes[0], end = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end?.focus() }
      if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [busy, onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><IconButton label="关闭弹窗" disabled={busy} onClick={onClose}><X size={19} /></IconButton></div>
      {children}
    </div>
  </div>
}

const formats: { value: ExportFormat; label: string; extension: string; icon: typeof FileText }[] = [
  { value: 'pdf', label: 'PDF 文档', extension: '.pdf', icon: FileText },
  { value: 'docx', label: 'Word 文档', extension: '.docx', icon: FileType2 },
  { value: 'png', label: 'PNG 图片', extension: '.png', icon: FileImage },
  { value: 'jpeg', label: 'JPEG 图片', extension: '.jpg', icon: FileImage },
  { value: 'html', label: '网页文件', extension: '.html', icon: Code2 }
]

export function ExportDialog({ options, setOptions, onClose, onExport, busy, result, onReveal, error }: {
  options: ExportOptions; setOptions: (opts: ExportOptions) => void; onClose: () => void
  onExport: () => void; busy: boolean; result: string[] | null; onReveal: () => void; error: string
}) {
  const update = (partial: Partial<ExportOptions>) => setOptions({ ...options, ...partial })
  const image = options.format === 'png' || options.format === 'jpeg'
  return <Modal title="让好内容，走得更远。" eyebrow="EXPORT YOUR WORDS" onClose={onClose} busy={busy}>
    <p className="modal-description">选择适合的格式，把你的文字分享出去。</p>
    <div className="format-grid">{formats.map(({ value, label, extension, icon: Icon }) =>
      <button key={value} className={`format-card ${options.format === value ? 'selected' : ''}`} onClick={() => update({ format: value })} disabled={busy}>
        <Icon size={25} strokeWidth={1.5} /><span>{label}</span><small>{extension}</small>{options.format === value && <Check className="format-check" size={13} />}
      </button>
    )}</div>
    <fieldset disabled={busy} className="export-fields">
      {options.format !== 'docx' && <label className="field-label">排版风格<select value={options.style} onChange={e => update({ style: e.target.value as ExportOptions['style'] })}><option value="classic">墨页经典 · 清晰舒适</option><option value="editorial">书页 · 宋体阅读</option><option value="minimal">极简 · 留白优先</option></select></label>}
      {(options.format === 'pdf' || image) && <div className="field-row">
        <label className="field-label">页面尺寸<select value={options.pageSize} onChange={e => update({ pageSize: e.target.value as 'A4' | 'Letter' })}><option>A4</option><option>Letter</option></select></label>
        <label className="field-label">方向<select value={String(options.landscape)} onChange={e => update({ landscape: e.target.value === 'true' })}><option value="false">纵向</option><option value="true">横向</option></select></label>
        <label className="field-label">边距 · mm<input type="number" min={5} max={40} value={options.margin} onChange={e => update({ margin: Number(e.target.value) })} /></label>
      </div>}
      {image && <div className="field-row">
        <label className="field-label">图片方式<select value={options.imageMode} onChange={e => update({ imageMode: e.target.value as 'long' | 'pages' })}><option value="long">整篇长图</option><option value="pages">分页图片</option></select></label>
        <label className="field-label">清晰度<select value={options.scale} onChange={e => update({ scale: Number(e.target.value) as 1 | 2 })}><option value={1}>1× 标准</option><option value={2}>2× 高清</option></select></label>
      </div>}
      {options.format === 'pdf' && <label className="check-label"><input type="checkbox" checked={options.pageNumbers} onChange={e => update({ pageNumbers: e.target.checked })} />显示页码</label>}
      {options.format === 'png' && <label className="check-label"><input type="checkbox" checked={options.transparent} onChange={e => update({ transparent: e.target.checked })} />透明背景</label>}
    </fieldset>
    {options.format === 'docx' && <div className="export-note">正文、标题、表格与公式可继续编辑，Mermaid 图表转为图片。Word 使用内置文档样式。</div>}
    {image && options.imageMode === 'pages' && <div className="export-note">按页面高度切分；跨页内容可能被切开。需要保留完整段落时，建议导出 PDF。</div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {result && <div className="export-success"><Check size={17} /><span>导出完成{result.length > 1 ? `，共 ${result.length} 个文件` : ''}</span>{!!result.length && <button onClick={onReveal}>在 Finder 中查看 <ArrowUpRight size={13} /></button>}</div>}
    <div className="modal-footer"><span>文档在本机处理</span><button className="primary-button" onClick={onExport} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{busy ? '正在准备导出…' : '导出文件'}{!busy && <span className="button-arrow">↗</span>}</button></div>
  </Modal>
}

export function SettingsDialog({ settings, update, onClose }: { settings: Settings; update: (opts: Partial<Settings>) => void; onClose: () => void }) {
  return <Modal title="你的写作偏好" eyebrow="MAKE IT YOURS" onClose={onClose}>
    <p className="modal-description">让墨页更贴近你的习惯。</p>
    <label className="field-label">外观</label>
    <div className="theme-grid">{([{ id: 'light', icon: Sun, name: '浅色' }, { id: 'dark', icon: Moon, name: '深色' }, { id: 'system', icon: Monitor, name: '跟随系统' }] as const).map(({ id, icon: Icon, name }) =>
      <button className={settings.theme === id ? 'selected' : ''} onClick={() => update({ theme: id })} key={id}><Icon size={19} />{name}</button>
    )}</div>
    <label className="setting-row"><span><strong>编辑字号</strong><small>只调整编辑区，不影响导出</small></span><select aria-label="编辑字号" value={settings.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })}>{[12, 13, 14, 15, 16, 18, 20].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
    <label className="setting-row"><span><strong>自动保存</strong><small>停止输入约 1 秒后保存已命名文件</small></span><input className="switch" type="checkbox" checked={settings.autoSave} onChange={e => update({ autoSave: e.target.checked })} /></label>
    <label className="setting-row"><span><strong>同步滚动</strong><small>编辑与预览按文档位置同步</small></span><input className="switch" type="checkbox" checked={settings.syncScroll} onChange={e => update({ syncScroll: e.target.checked })} /></label>
    <div className="settings-about"><span className="brand-glyph small">墨</span><div><strong>墨页 Moye</strong><small>0.1.0 · 给文字一个安静的地方</small></div></div>
  </Modal>
}
