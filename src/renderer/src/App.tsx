import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import {
  ArrowUpRight, Bold, BookOpen, Check, ChevronDown, ChevronRight, Code2, Columns2,
  Download, Eye, FilePlus2, FileText, FolderOpen, Heading1, ImagePlus, Italic, Link2,
  List, ListOrdered, LoaderCircle, Moon, PanelLeft, PencilLine, Plus, Quote, Search,
  Settings2, Table2, X, ListTree, Save, AlertCircle
} from 'lucide-react'
import { DEFAULT_EXPORT, DEFAULT_SETTINGS, type DocumentState, type ExportOptions, type SessionState, type Settings, type AppEvent, type RecentFile } from '../../shared/types'
import { bridge } from './bridge'
import { WELCOME, CHEATSHEET } from './welcome'
import { getHeadings, makeExportHTML, renderDiagrams, renderMarkdown, wordCount } from './markdown'
import { ExportDialog, IconButton, Modal, SettingsDialog } from './components'

const newDocument = (title = '未命名.md', content = '', pristine = false): DocumentState => ({
  id: crypto.randomUUID(), title, content, savedContent: pristine ? content : '',
  path: null, mtimeMs: null
})
const dirty = (doc: DocumentState) => doc.content !== doc.savedContent
const initialDoc = newDocument('欢迎使用墨页.md', WELCOME, true)
const initialState: SessionState = { documents: [initialDoc], activeId: initialDoc.id, settings: DEFAULT_SETTINGS }
const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function App() {
  const [state, setState] = useState<SessionState>(initialState)
  const live = useRef(state)
  const [ready, setReady] = useState(false)
  const [desktop, setDesktop] = useState(!!window.moye)
  const [recents, setRecents] = useState<RecentFile[]>([])
  const [filter, setFilter] = useState('')
  const [sidebarTab, setSidebarTab] = useState<'files' | 'outline'>('files')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportResult, setExportResult] = useState<string[] | null>(null)
  const [exportError, setExportError] = useState('')
  const [notification, setNotification] = useState<{ text: string; error: boolean } | null>(null)
  const [rendered, setRendered] = useState({ html: '', id: '', content: '' })
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState('')
  const [selection, setSelection] = useState({ line: 1, column: 1 })
  const [saveBusy, setSaveBusy] = useState(false)
  const [closeRequest, setCloseRequest] = useState<{ id?: string; quit: boolean } | null>(null)
  const [conflicts, setConflicts] = useState<Record<string, { content: string; mtimeMs: number }>>({})
  const preview = useRef<HTMLDivElement>(null)
  const previewScroll = useRef<HTMLDivElement>(null)
  const editorViews = useRef(new Map<string, EditorView>())
  const saveJobs = useRef(new Map<string, Promise<DocumentState | null>>())
  const busyRef = useRef(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrolling = useRef<'editor' | 'preview' | null>(null)
  const closeBusy = useRef(false)
  const quitApp = useRef(false)
  const update = useCallback((action: (current: SessionState) => SessionState) => {
    const next = action(live.current)
    live.current = next
    setState(next)
  }, [])
  const notify = useCallback((text: string, error = false) => {
    clearTimeout(noticeTimer.current)
    setNotification({ text, error })
    noticeTimer.current = setTimeout(() => setNotification(null), error ? 7500 : 3000)
  }, [])
  const settings = state.settings
  const active = state.documents.find(doc => doc.id === state.activeId) ?? state.documents[0]
  const headings = useMemo(() => getHeadings(active?.content ?? ''), [active?.content])
  const count = useMemo(() => wordCount(active?.content ?? ''), [active?.content])
  const updateSettings = useCallback((opts: Partial<Settings>) => update(current => ({ ...current, settings: { ...current.settings, ...opts } })), [update])

  useEffect(() => {
    bridge.bootstrap().then(data => {
      if (data.documents?.length) {
        const next = { documents: data.documents, activeId: data.activeId || data.documents[0].id, settings: { ...DEFAULT_SETTINGS, ...data.settings } }
        if (!next.documents.some(doc => doc.id === next.activeId)) next.activeId = next.documents[0].id
        update(() => next)
      }
      setDesktop(data.desktop); setRecents(data.recents); setReady(true)
    }).catch(error => { notify(message(error), true); setReady(true) })
  }, [notify, update])
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => bridge.persist(state).catch(error => notify(`草稿备份失败：${message(error)}`, true)), 250)
    return () => clearTimeout(timer)
  }, [state, ready, notify])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
      setResolvedTheme(theme)
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => { document.title = `${dirty(active) ? '● ' : ''}${active.title} — 墨页` }, [active.title, active.content, active.savedContent])

  const saveDocument = useCallback(async (id: string, saveAs = false): Promise<DocumentState | null> => {
    const running = saveJobs.current.get(id)
    if (running) { const saved = await running; if (saveAs) return saveDocument(id, true); return saved }
    const doc = live.current.documents.find(d => d.id === id)
    if (!doc) return null
    const job = (async () => {
      setSaveBusy(true)
      try {
        const saved = await bridge.save(doc, saveAs)
        if (!saved) return null
        update(current => ({ ...current, documents: current.documents.map(d => d.id === id ? {
          ...saved, content: d.content === doc.content ? saved.content : d.content
        } : d) }))
        setConflicts(current => { const copy = { ...current }; delete copy[id]; return copy })
        if (saved.path) setRecents(current => [{ path: saved.path!, title: saved.title }, ...current.filter(r => r.path !== saved.path)].slice(0, 12))
        return saved
      } catch (error) { notify(message(error), true); return null }
      finally { saveJobs.current.delete(id); setSaveBusy(saveJobs.current.size > 0) }
    })()
    saveJobs.current.set(id, job)
    return job
  }, [notify, update])

  useEffect(() => {
    if (!settings.autoSave || !desktop) return
    const timer = setTimeout(() => {
      for (const doc of live.current.documents) if (doc.path && dirty(doc) && !conflicts[doc.id]) void saveDocument(doc.id)
    }, 1200)
    return () => clearTimeout(timer)
  }, [state.documents, settings.autoSave, conflicts, desktop, saveDocument])

  const mergeOpened = useCallback((documents: DocumentState[]) => {
    if (!documents.length) return
    update(current => ({
      ...current, activeId: documents[documents.length - 1].id,
      documents: [...current.documents, ...documents.filter(doc => !current.documents.some(d => d.id === doc.id || (doc.path && doc.path === d.path)))]
    }))
    setRecents(current => {
      let result = current
      for (const doc of documents) if (doc.path) result = [{ path: doc.path, title: doc.title }, ...result.filter(r => r.path !== doc.path)].slice(0, 12)
      return result
    })
  }, [update])
  const openFile = useCallback(async () => { try { mergeOpened(await bridge.open()) } catch (error) { notify(message(error), true) } }, [mergeOpened, notify])
  const addDocument = useCallback((content = '', title?: string, pristine = false) => {
    const n = live.current.documents.filter(d => d.title.startsWith('未命名')).length
    const doc = newDocument(title ?? `未命名${n ? ` ${n + 1}` : ''}.md`, content, pristine)
    update(current => ({ ...current, documents: [...current.documents, doc], activeId: doc.id }))
  }, [update])
  const removeDocument = useCallback((id: string) => {
    editorViews.current.delete(id)
    update(current => {
      const index = current.documents.findIndex(d => d.id === id)
      let docs = current.documents.filter(d => d.id !== id)
      if (!docs.length) docs = [newDocument()]
      return { ...current, documents: docs, activeId: current.activeId === id ? docs[Math.min(index, docs.length - 1)].id : current.activeId }
    })
  }, [update])
  const requestClose = useCallback((id?: string, quit = false) => {
    if (busyRef.current) { notify('请等待导出完成'); return }
    const docs = live.current.documents.filter(d => quit || d.id === id)
    if (docs.some(dirty)) setCloseRequest({ id, quit })
    else if (quit) void bridge.persist(live.current).then(() => bridge.closeWindow(quitApp.current))
    else if (id) removeDocument(id)
  }, [notify, removeDocument])
  const finishClose = async (save: boolean) => {
    if (!closeRequest || closeBusy.current) return
    closeBusy.current = true
    try {
      const docs = live.current.documents.filter(d => closeRequest.quit || d.id === closeRequest.id)
      if (save) {
        for (const doc of docs) if (dirty(doc) && !await saveDocument(doc.id)) return
        if (live.current.documents.some(d => docs.some(old => old.id === d.id) && dirty(d))) { notify('保存期间有新修改，请再次保存后关闭'); return }
      }
      if (closeRequest.quit) {
        const next = save ? live.current : { ...live.current, documents: live.current.documents.filter(d => d.path || !dirty(d)).map(d => ({ ...d, content: d.savedContent })) }
        await bridge.persist(next)
        await bridge.closeWindow(quitApp.current)
      } else if (closeRequest.id) removeDocument(closeRequest.id)
      setCloseRequest(null)
    } finally { closeBusy.current = false }
  }

  const insert = useCallback((before: string, after = '', fallback = '') => {
    const view = editorViews.current.get(live.current.activeId)
    if (!view) return
    const { from, to } = view.state.selection.main
    const chosen = view.state.sliceDoc(from, to) || fallback
    view.dispatch({
      changes: { from, to, insert: before + chosen + after },
      selection: { anchor: from + before.length, head: from + before.length + chosen.length },
      userEvent: 'input'
    })
    view.focus()
  }, [])
  const importImage = useCallback(async (file?: File) => {
    try {
      const id = live.current.activeId
      const doc = live.current.documents.find(d => d.id === id)!
      if (desktop && !doc.path && !await saveDocument(id)) return
      const data = file ? { name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) } : undefined
      const resource = await bridge.importImage(id, data)
      if (resource) {
        const view = editorViews.current.get(id)
        if (view) view.dispatch(view.state.replaceSelection(`![${file?.name.replace(/[[\]]/g, '') ?? '图片'}](${resource})`))
      }
    } catch (error) { notify(message(error), true) }
  }, [desktop, notify, saveDocument])
  const showExport = useCallback(() => { setExportResult(null); setExportError(''); setExportOpen(true) }, [])
  const actions = useRef<(action: string) => void>(() => {})
  actions.current = action => {
    const id = live.current.activeId
    switch (action) {
      case 'new': addDocument(); break
      case 'open': void openFile(); break
      case 'save': void saveDocument(id); break
      case 'save-as': void saveDocument(id, true); break
      case 'export': showExport(); break
      case 'settings': setSettingsOpen(true); break
      case 'sidebar': updateSettings({ sidebar: !live.current.settings.sidebar }); break
      case 'split': case 'editor': case 'preview': updateSettings({ view: action }); break
      case 'close-tab': requestClose(id); break
      case 'search': {
        if (live.current.settings.view === 'preview') updateSettings({ view: 'split' })
        const view = editorViews.current.get(id)
        if (view) { openSearchPanel(view); view.focus() }
      }
    }
  }
  useEffect(() => bridge.onEvent((event: AppEvent) => {
    if (event.type === 'menu') actions.current(event.action)
    if (event.type === 'opened') mergeOpened(event.documents)
    if (event.type === 'close-request') { quitApp.current = !!event.quit; requestClose(undefined, true) }
    if (event.type === 'external-change') {
      const doc = live.current.documents.find(d => d.id === event.id)
      if (!doc || doc.savedContent === event.content) return
      if (dirty(doc)) setConflicts(current => ({ ...current, [doc.id]: { content: event.content, mtimeMs: event.mtimeMs } }))
      else {
        update(current => ({ ...current, documents: current.documents.map(d => d.id === doc.id ? { ...d, content: event.content, savedContent: event.content, mtimeMs: event.mtimeMs } : d) }))
        notify(`已载入「${doc.title}」的外部修改`)
      }
    }
  }), [mergeOpened, notify, requestClose, update])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || settingsOpen || exportOpen || closeRequest) return
      const name = event.key.toLowerCase()
      if (name === 'b' || name === 'i') { event.preventDefault(); insert(name === 'b' ? '**' : '*', name === 'b' ? '**' : '*', '文字'); return }
      if (desktop) return // Native menu owns the remaining accelerators.
      const action = name === 's' ? (event.shiftKey ? 'save-as' : 'save') : name === 'n' ? 'new' : name === 'o' ? 'open' : name === 'e' && event.shiftKey ? 'export' : name === ',' ? 'settings' : name === '\\' ? 'sidebar' : ({ '1': 'split', '2': 'editor', '3': 'preview', f: 'search', w: 'close-tab' } as Record<string, string>)[name]
      if (action) { event.preventDefault(); actions.current(action) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [desktop, insert, settingsOpen, exportOpen, closeRequest])

  // Debounce expensive work, and ignore stale async renders after a tab/content change.
  useEffect(() => {
    let canceled = false
    setRendering(true)
    const timer = setTimeout(async () => {
      try {
        const html = await renderMarkdown(active.content, active.id)
        if (!canceled) { setRenderError(''); setRendered({ html, id: active.id, content: active.content }) }
      } catch (error) { if (!canceled) { setRenderError(message(error)); setRendering(false) } }
    }, 160)
    return () => { canceled = true; clearTimeout(timer) }
  }, [active.id, active.content])
  useEffect(() => {
    let canceled = false
    if (preview.current) {
      renderDiagrams(preview.current).catch(error => { if (!canceled) setRenderError(message(error)) })
        .finally(() => { if (!canceled) setRendering(false) })
    }
    return () => { canceled = true }
  }, [rendered])
  const performExport = async () => {
    if (!preview.current || rendering || rendered.id !== active.id || rendered.content !== active.content) { setExportError('预览正在更新，请稍后重试'); return }
    if (renderError) { setExportError(renderError); return }
    busyRef.current = true; setExportBusy(true); setExportError(''); setExportResult(null)
    try {
      const { html, diagrams } = await makeExportHTML(preview.current, active.title, active.id, exportOptions)
      const result = await bridge.export({ html, diagrams, markdown: active.content, documentId: active.id, title: active.title, options: exportOptions })
      if (result) setExportResult(result.paths)
    } catch (error) { setExportError(message(error)) }
    finally { busyRef.current = false; setExportBusy(false) }
  }

  const syncEditor = useCallback((view: EditorView) => {
    if (!live.current.settings.syncScroll || live.current.settings.view !== 'split' || scrolling.current === 'preview') return
    const element = previewScroll.current
    if (!element) return
    scrolling.current = 'editor'
    const scroll = view.scrollDOM
    element.scrollTop = scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight) * (element.scrollHeight - element.clientHeight)
    requestAnimationFrame(() => { scrolling.current = null })
  }, [])
  const extensions = useMemo(() => [
    markdown({ codeLanguages: languages }), EditorView.lineWrapping,
    EditorView.domEventHandlers({
      scroll: (_, view) => { syncEditor(view) },
      paste: (event) => {
        const image = [...(event.clipboardData?.files ?? [])].find(file => file.type.startsWith('image/'))
        if (image) { event.preventDefault(); void importImage(image); return true }
        return false
      }
    }),
    keymap.of([{ key: 'Mod-b', run: () => { insert('**', '**', '粗体'); return true } }, { key: 'Mod-i', run: () => { insert('*', '*', '斜体'); return true } }]),
    EditorView.theme({
      '&': { height: '100%', fontSize: `${settings.fontSize}px`, backgroundColor: 'transparent' },
      '.cm-scroller': { fontFamily: '"SFMono-Regular", Menlo, "PingFang SC", monospace', lineHeight: '1.9', overflow: 'auto' },
      '.cm-content': { padding: '27px 0 80px', caretColor: '#609781' },
      '.cm-line': { paddingLeft: '18px', paddingRight: '26px' },
      '.cm-gutters': { border: 'none', background: 'transparent', color: '#bdc4cc', padding: '0 2px 0 16px', fontSize: '11px' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: '#b6d4c94d' },
      '.cm-cursor': { borderLeftColor: '#609781' }
    })
  ], [importImage, insert, settings.fontSize, syncEditor])
  const goToHeading = (index: number, line: number) => {
    if (settings.view !== 'editor') preview.current?.querySelector(`#heading-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else {
      const view = editorViews.current.get(active.id)
      if (view) { const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from; view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) }); view.focus() }
    }
  }
  const onDrop = async (event: React.DragEvent) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    const files = [...event.dataTransfer.files]
    const image = files.find(file => file.type.startsWith('image/'))
    if (image && !files.some(file => /\.(md|markdown|txt)$/i.test(file.name))) { void importImage(image); return }
    try { mergeOpened(await bridge.openDropped(files)) } catch (error) { notify(message(error), true) }
  }
  const visibleDocs = state.documents.filter(doc => doc.title.toLowerCase().includes(filter.toLowerCase()))

  return <div className={`app-shell ${!settings.sidebar ? 'sidebar-collapsed' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={onDrop}>
    <aside className="sidebar">
      <div className={`sidebar-titlebar ${desktop ? 'native' : ''}`}>{!desktop && <div className="traffic-lights"><i /><i /><i /></div>}<span className="window-caption">一个安静的写作空间</span></div>
      <div className="brand"><div className="brand-glyph">墨</div><div><span className="brand-name">墨页<span>Moye</span></span><small>落笔有声，灵感有形。</small></div></div>
      <button className="new-document" onClick={() => addDocument()}><Plus size={17} /><span>新建文档</span><kbd>⌘ N</kbd></button>
      <div className="sidebar-nav"><button className={sidebarTab === 'files' ? 'selected' : ''} onClick={() => setSidebarTab('files')}><FileText size={15} />文档</button><button className={sidebarTab === 'outline' ? 'selected' : ''} onClick={() => setSidebarTab('outline')}><ListTree size={15} />大纲</button></div>
      {sidebarTab === 'files' ? <>
        <label className="file-search"><Search size={14} /><input placeholder="查找文档…" aria-label="查找文档" value={filter} onChange={e => setFilter(e.target.value)} /><kbd>⌕</kbd></label>
        <div className="sidebar-section-label"><span>正在书写</span><span>{state.documents.length}</span></div>
        <div className="document-list">{visibleDocs.map(doc => <button className={`document-item ${doc.id === active.id ? 'selected' : ''}`} key={doc.id} onClick={() => update(current => ({ ...current, activeId: doc.id }))}><FileText size={16} /><span>{doc.title.replace(/\.md$/, '')}</span>{dirty(doc) ? <i className="dirty-dot" /> : doc.id === active.id && <ChevronRight size={13} />}</button>)}{!visibleDocs.length && <div className="empty-search">没有匹配的文档</div>}</div>
        <button className="open-file-sidebar" onClick={() => void openFile()}><FolderOpen size={15} />打开本地文件<kbd>⌘ O</kbd></button>
        {!!recents.length && <><div className="sidebar-section-label recent-label">最近打开</div><div className="recent-list">{recents.slice(0, 5).map(file => <button title={file.path} key={file.path} onClick={() => bridge.openRecent(file.path).then(mergeOpened).catch(error => notify(message(error), true))}><FileText size={13} /><span>{file.title}</span></button>)}</div></>}
        <div className="sidebar-outline"><div className="sidebar-section-label">本文目录<ListTree size={13} /></div>{headings.filter(h => h.level === 2).slice(0, 5).map(h => <button key={h.index} onClick={() => goToHeading(h.index, h.line)}><span className="outline-line" />{h.text}</button>)}</div>
      </> : <div className="full-outline">{headings.map(h => <button key={h.index} style={{ paddingLeft: `${14 + (h.level - 1) * 12}px` }} onClick={() => goToHeading(h.index, h.line)}><span>H{h.level}</span>{h.text}</button>)}{!headings.length && <p>使用 # 标题，为文档建立目录。</p>}</div>}
      <div className="sidebar-bottom"><button className="guide-card" onClick={() => addDocument(CHEATSHEET, 'Markdown 语法速查.md', true)}><BookOpen size={19} /><span>书写，从容一点<small>Markdown 语法速查</small></span><ArrowUpRight size={15} /></button><div className="sidebar-bottom-row"><button onClick={() => setSettingsOpen(true)}><Settings2 size={15} />偏好设置</button><IconButton label="切换深浅主题" onClick={() => updateSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}><Moon size={15} /></IconButton></div></div>
    </aside>
    <main className="workspace">
      <header className={`topbar ${desktop && !settings.sidebar ? 'native-inset' : ''}`}>
        <div className="breadcrumb"><IconButton label="切换侧边栏" onClick={() => updateSettings({ sidebar: !settings.sidebar })}><PanelLeft size={17} /></IconButton><span className="breadcrumb-divider" /><span>我的文档</span><ChevronRight size={13} /><strong>{active.title.replace(/\.md$/, '')}</strong></div>
        <div className="top-actions"><span className="save-indicator">{saveBusy ? <LoaderCircle size={12} className="spin" /> : dirty(active) ? <i className="dirty-dot" /> : <Check size={12} />}{saveBusy ? '保存中' : dirty(active) ? '有未保存的修改' : active.path ? '已保存' : '本地草稿'}</span><IconButton label="保存文档 ⌘S" onClick={() => void saveDocument(active.id)}><Save size={16} /></IconButton><button className="export-button" onClick={showExport}><Download size={14} />导出<ChevronDown size={12} /></button></div>
      </header>
      <div className="tabbar"><div className="tabs" role="tablist">{state.documents.map(doc => <div className={`tab ${doc.id === active.id ? 'selected' : ''}`} key={doc.id}><button role="tab" aria-selected={doc.id === active.id} onClick={() => update(current => ({ ...current, activeId: doc.id }))}><FileText size={13} /><span>{doc.title}</span>{dirty(doc) && <i className="dirty-dot" />}</button><button className="tab-close" title={`关闭 ${doc.title}`} aria-label={`关闭 ${doc.title}`} onClick={() => requestClose(doc.id)}><X size={12} /></button></div>)}</div><IconButton label="新建标签" onClick={() => addDocument()}><Plus size={15} /></IconButton><div className="view-switch">{([{ id: 'editor', label: '仅编辑', icon: PencilLine }, { id: 'split', label: '分栏视图', icon: Columns2 }, { id: 'preview', label: '仅预览', icon: Eye }] as const).map(({ id, label, icon: Icon }) => <IconButton label={label} key={id} active={settings.view === id} onClick={() => updateSettings({ view: id })}><Icon size={14} /></IconButton>)}</div></div>
      <div className="format-toolbar"><div className="format-tools">
        <button className="heading-button" title="插入二级标题" onClick={() => insert('\n## ', '\n', '标题')}><Heading1 size={17} /><ChevronDown size={10} /></button><span className="tool-divider" />
        <IconButton label="粗体 ⌘B" onClick={() => insert('**', '**', '粗体')}><Bold size={16} /></IconButton><IconButton label="斜体 ⌘I" onClick={() => insert('*', '*', '斜体')}><Italic size={16} /></IconButton><IconButton label="插入链接" onClick={() => insert('[', '](https://example.com)', '链接文字')}><Link2 size={16} /></IconButton><IconButton label="插入代码块" onClick={() => insert('\n```\n', '\n```\n', '代码')}><Code2 size={17} /></IconButton><span className="tool-divider" /><IconButton label="无序列表" onClick={() => insert('\n- ', '\n', '列表项')}><List size={17} /></IconButton><IconButton label="有序列表" onClick={() => insert('\n1. ', '\n', '列表项')}><ListOrdered size={17} /></IconButton><IconButton label="引用" onClick={() => insert('\n> ', '\n', '引用文字')}><Quote size={16} /></IconButton><span className="tool-divider" /><IconButton label="插入表格" onClick={() => insert('\n| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n')}><Table2 size={16} /></IconButton><IconButton label="插入图片" onClick={() => void importImage()}><ImagePlus size={16} /></IconButton>
      </div><button className={`sync-toggle ${settings.syncScroll ? 'enabled' : ''}`} onClick={() => updateSettings({ syncScroll: !settings.syncScroll })}><span />同步滚动</button></div>
      {conflicts[active.id] && <div className="conflict-banner"><AlertCircle size={15} /><span>磁盘上的文件已更改，你的修改仍保留在编辑器中。</span><button onClick={() => {
        const external = conflicts[active.id]
        const backup = newDocument(`${active.title.replace(/\.md$/, '')}（冲突备份）.md`, active.content)
        update(current => ({ ...current, documents: [...current.documents.map(d => d.id === active.id ? { ...d, ...external, savedContent: external.content } : d), backup] }))
        setConflicts(current => { const next = { ...current }; delete next[active.id]; return next })
        notify('已载入外部版本，你的修改保存在「冲突备份」标签中')
      }}>载入外部版本</button><button onClick={() => void saveDocument(active.id)}>保留我的版本</button></div>}
      <div className={`editor-layout view-${settings.view}`}>
        <section className="editor-pane"><div className="pane-label"><span><Code2 size={12} />MARKDOWN</span><span>UTF-8 <i /> MD</span></div><div className="editors">{state.documents.map(doc => <div className="editor-instance" hidden={doc.id !== active.id} key={doc.id}>
          <CodeMirror value={doc.content} height="100%" extensions={extensions} theme={resolvedTheme} basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
            onCreateEditor={view => editorViews.current.set(doc.id, view)}
            onChange={content => update(current => ({ ...current, documents: current.documents.map(d => d.id === doc.id ? { ...d, content } : d) }))}
            onUpdate={event => { if (doc.id === live.current.activeId && event.selectionSet) { const pos = event.state.selection.main.head; const line = event.state.doc.lineAt(pos); setSelection({ line: line.number, column: pos - line.from + 1 }) } }}
          />
        </div>)}</div></section>
        <section className="preview-pane"><div className="pane-label"><span><Eye size={12} />实时预览</span><span className="preview-state"><i />{rendering ? '更新中' : '与你的文字同步'}</span></div><div className="preview-scroll" ref={previewScroll}
          onScroll={e => {
            if (!settings.syncScroll || settings.view !== 'split' || scrolling.current === 'editor') return
            const view = editorViews.current.get(active.id)
            if (!view) return
            scrolling.current = 'preview'
            const el = e.currentTarget
            view.scrollDOM.scrollTop = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) * (view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
            requestAnimationFrame(() => { scrolling.current = null })
          }}
          onClick={e => {
            const anchor = (e.target as HTMLElement).closest('a')
            if (!anchor) return
            e.preventDefault()
            const href = anchor.getAttribute('href') ?? ''
            if (/^https?:\/\//.test(href)) void bridge.openExternal(href)
            else if (href.startsWith('#')) {
              const target = decodeURIComponent(href.slice(1))
              const h = [...(preview.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(node => node.id === target || node.textContent?.toLowerCase().replace(/\s+/g, '-') === target)
              h?.scrollIntoView({ behavior: 'smooth' })
            } else notify('暂不支持在应用内跳转到相对路径链接')
          }}>
          {renderError && <div className="inline-error">{renderError}</div>}
          <article className="markdown-body" ref={preview} dangerouslySetInnerHTML={{ __html: rendered.html }} />
          {!active.content && <div className="preview-empty"><PencilLine size={28} strokeWidth={1} /><p>每个好想法，都从第一行开始。</p><small>在左侧写下你的文字</small></div>}
          <div className="document-end"><span /> END OF DOCUMENT <span /></div>
        </div></section>
      </div>
      <footer className="statusbar"><div><span className="status-dot" />{desktop ? '本地工作区' : '浏览器预览'}<span className="status-divider" /><span>Markdown</span></div><div><span>{count.toLocaleString()} 字</span><span>约 {Math.max(1, Math.ceil(count / 400))} 分钟阅读</span><span className="status-divider" /><span>行 {selection.line}，列 {selection.column}</span><button onClick={() => setSettingsOpen(true)}>{settings.fontSize} px</button></div></footer>
    </main>
    {notification && <div className={`toast ${notification.error ? 'error' : ''}`} role={notification.error ? 'alert' : 'status'}>{notification.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{notification.text}</span><button onClick={() => setNotification(null)} aria-label="关闭提示"><X size={14} /></button></div>}
    {settingsOpen && <SettingsDialog settings={settings} update={updateSettings} onClose={() => setSettingsOpen(false)} />}
    {exportOpen && <ExportDialog options={exportOptions} setOptions={opts => { setExportOptions(opts); setExportResult(null); setExportError('') }} onClose={() => setExportOpen(false)} onExport={() => void performExport()} busy={exportBusy} result={exportResult} error={exportError} onReveal={() => { if (exportResult?.[0]) void bridge.reveal(exportResult[0]) }} />}
    {closeRequest && <Modal title="保存这一次的灵感？" eyebrow="BEFORE YOU LEAVE" onClose={() => setCloseRequest(null)} busy={saveBusy}>
      <p className="modal-description">{closeRequest.quit ? '部分文档还有未保存的更改。' : `「${state.documents.find(d => d.id === closeRequest.id)?.title}」还有未保存的更改。`}</p>
      <div className="close-actions"><button className="text-button danger" disabled={saveBusy} onClick={() => void finishClose(false)}>不保存</button><button className="secondary-button" onClick={() => setCloseRequest(null)} disabled={saveBusy}>取消</button><button className="primary-button" disabled={saveBusy} onClick={() => void finishClose(true)}>{saveBusy ? '正在保存…' : '保存并关闭'}</button></div>
    </Modal>}
  </div>
}
