import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { promises as fs, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DocumentStore, atomicWrite, restoreSession, MAX_DOCUMENT_BYTES } from './files'
import { embedImage, exportDocument } from './export'
import type { AppEvent, DocumentState, ExportPayload, RecentFile, SessionState } from '../shared/types'

if (process.env.MOYE_USER_DATA) app.setPath('userData', process.env.MOYE_USER_DATA)
app.setName('墨页')
protocol.registerSchemesAsPrivileged([{ scheme: 'moye-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let main: BrowserWindow | null = null
let canClose = false
let session: SessionState | null = null
let recents: RecentFile[] = []
let persistTimer: NodeJS.Timeout | undefined
let exporting = false
const pendingOpen: string[] = []
const send = (event: AppEvent) => { if (main && !main.isDestroyed()) main.webContents.send('moye:event', event) }
const store = new DocumentStore(doc => send({ type: 'external-change', id: doc.id, content: doc.content, mtimeMs: doc.mtimeMs! }))
const sessionFile = () => join(app.getPath('userData'), 'session.json')
const recentFile = () => join(app.getPath('userData'), 'recents.json')
const windowFile = () => join(app.getPath('userData'), 'window.json')
const saving = new Set<string>()

async function remember(documents: DocumentState[]) {
  for (const doc of documents) {
    if (!doc.path) continue
    recents = [{ path: doc.path, title: doc.title }, ...recents.filter(r => r.path !== doc.path)].slice(0, 12)
    app.addRecentDocument(doc.path)
  }
  await atomicWrite(recentFile(), JSON.stringify(recents))
}

async function openPaths(paths: string[]) {
  const opened: DocumentState[] = []
  const errors: string[] = []
  for (const path of paths.slice(0, 30)) {
    try { opened.push(await store.open(path)) } catch (error) { errors.push(`${basename(path)}：${(error as Error).message}`) }
  }
  if (errors.length && main) await dialog.showMessageBox(main, { type: 'warning', message: '部分文件未能打开', detail: errors.join('\n') })
  await remember(opened)
  return opened
}

function setupIPC() {
  const handle = (name: string, action: (...args: any[]) => any) => {
    ipcMain.handle(`moye:${name}`, (event, ...args) => {
      if (event.sender !== main?.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无效的请求来源')
      return action(...args)
    })
  }
  handle('bootstrap', async () => {
    const initial = { ...session, recents, version: app.getVersion(), desktop: true }
    // Delivery after hydration prevents early events from being lost.
    setTimeout(async () => {
      if (pendingOpen.length) send({ type: 'opened', documents: await openPaths(pendingOpen.splice(0)) })
    }, 300)
    return initial
  })
  handle('open', async () => {
    const result = await dialog.showOpenDialog(main!, {
      title: '打开 Markdown', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown', 'txt'] }]
    })
    return result.canceled ? [] : openPaths(result.filePaths)
  })
  handle('open-recent', async (path: string) => {
    if (!recents.some(r => r.path === path)) throw new Error('文件不在最近打开列表中')
    return openPaths([path])
  })
  handle('open-dropped', (paths: string[]) => openPaths(paths))
  handle('save', async (doc: DocumentState, saveAs = false) => {
    if (typeof doc.content !== 'string' || Buffer.byteLength(doc.content) > MAX_DOCUMENT_BYTES) throw new Error('文档超过 10 MB')
    if (saving.has(doc.id)) throw new Error('此文档正在保存，请稍后重试')
    saving.add(doc.id)
    try {
      const registered = store.documents.get(doc.id)
      let path = registered?.path ?? null
      if (saveAs || !path) {
        const result = await dialog.showSaveDialog(main!, { defaultPath: path ?? doc.title, filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (result.canceled || !result.filePath) return null
        path = await fs.realpath(result.filePath).catch(async () => join(await fs.realpath(dirname(result.filePath!)), basename(result.filePath!)))
        const duplicate = [...store.documents.values()].find(d => d.id !== doc.id && d.path === path)
        if (duplicate) throw new Error('目标文件已在另一个标签中打开，请切换到该标签编辑')
        // Keep relative image references valid when changing directories.
        if (registered?.path && dirname(registered.path) !== dirname(path)) {
          const { unified } = await import('unified')
          const { default: remarkParse } = await import('remark-parse')
          const tree = unified().use(remarkParse).parse(doc.content)
          const changes: { start: number; end: number; value: string }[] = []
          const images = new Set<string>()
          const nodes: any[] = []
          const walk = (node: any) => { nodes.push(node); if (node.type === 'imageReference') images.add(node.identifier); node.children?.forEach(walk) }
          walk(tree)
          for (const node of nodes) {
            if ((node.type === 'image' || (node.type === 'definition' && images.has(node.identifier))) && !/^[a-z][\w+.-]*:/i.test(node.url)) {
              const data = await embedImage(node.url, doc.id, store)
              const text = node.type === 'image' ? `![${(node.alt ?? '').replace(/[[\]]/g, '')}](${data})` : `[${node.label}]: ${data}`
              changes.push({ start: node.position.start.offset, end: node.position.end.offset, value: text })
            }
          }
          for (const c of changes.sort((a, b) => b.start - a.start)) doc.content = doc.content.slice(0, c.start) + c.value + doc.content.slice(c.end)
        }
      } else {
        const disk = await fs.readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
        if (disk !== null && disk !== doc.savedContent && disk !== doc.content) {
          const result = await dialog.showMessageBox(main!, {
            type: 'warning', message: '文件已被其他程序修改', detail: '覆盖会替换磁盘上的内容。取消后可在编辑器中选择载入外部版本。',
            buttons: ['取消', '覆盖磁盘版本'], defaultId: 0, cancelId: 0
          })
          if (result.response === 0) return null
        }
      }
      await atomicWrite(path!, doc.content)
      const stat = await fs.stat(path!)
      const saved = { ...doc, path, title: basename(path!), savedContent: doc.content, mtimeMs: stat.mtimeMs }
      store.rewatch(saved)
      await remember([saved])
      return saved
    } finally { saving.delete(doc.id) }
  })
  handle('persist', (state: SessionState) => {
    for (const old of session?.documents ?? []) {
      if (!state.documents.some(doc => doc.id === old.id)) store.remove(old.id)
    }
    session = state
    for (const doc of state.documents) {
      const registered = store.documents.get(doc.id)
      store.register({ ...doc, path: registered?.path ?? null })
    }
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => atomicWrite(sessionFile(), JSON.stringify(session)).catch(error => console.error('Session save failed:', error.message)), 200)
  })
  handle('confirm-close', async (title: string) => {
    const { response } = await dialog.showMessageBox(main!, {
      type: 'question', message: `要保存「${title}」的更改吗？`,
      buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2
    })
    return ['save', 'discard', 'cancel'][response]
  })
  handle('close-window', (quit = false) => { canClose = true; if (quit) app.quit(); else main?.close() })
  handle('import-image', async (id: string, data?: { bytes: number[]; name: string }) => {
    if (data) return store.importImage(id, Buffer.from(data.bytes), data.name)
    const result = await dialog.showOpenDialog(main!, {
      properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    })
    if (result.canceled) return null
    const path = result.filePaths[0]
    return store.importImage(id, await fs.readFile(path), basename(path))
  })
  handle('embed-image', (src: string, id: string) => embedImage(src, id, store))
  handle('export', async (payload: ExportPayload) => {
    if (exporting) throw new Error('已有导出任务正在运行')
    exporting = true
    try {
      const pandoc = app.isPackaged
        ? join(process.resourcesPath, 'pandoc', 'pandoc')
        : join(app.getAppPath(), 'resources', 'pandoc', process.arch, 'pandoc')
      return await exportDocument(main!, payload, store, pandoc)
    } finally { exporting = false }
  })
  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('open-external', (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持打开 HTTP(S) 链接')
    return shell.openExternal(url)
  })
}

function setupMenu() {
  const command = (action: string) => () => send({ type: 'menu', action })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '墨页', submenu: [
      { role: 'about', label: '关于墨页' }, { type: 'separator' },
      { label: '设置…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit', label: '退出墨页' }
    ] },
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: command('new') },
      { label: '打开…', accelerator: 'CmdOrCtrl+O', click: command('open') },
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: command('save') },
      { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: command('save-as') },
      { label: '导出…', accelerator: 'CmdOrCtrl+Shift+E', click: command('export') },
      { type: 'separator' },
      { label: '关闭标签', accelerator: 'CmdOrCtrl+W', click: command('close-tab') }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, { label: '查找与替换', accelerator: 'CmdOrCtrl+F', click: command('search') }
    ] },
    { label: '视图', submenu: [
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+\\', click: command('sidebar') },
      { label: '编辑与预览', accelerator: 'CmdOrCtrl+1', click: command('split') },
      { label: '仅编辑', accelerator: 'CmdOrCtrl+2', click: command('editor') },
      { label: '仅预览', accelerator: 'CmdOrCtrl+3', click: command('preview') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])
    ] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ]))
}

async function createWindow() {
  let bounds = { width: 1380, height: 900 }
  try { bounds = { ...bounds, ...JSON.parse(await fs.readFile(windowFile(), 'utf8')) } } catch { /* defaults */ }
  canClose = false
  main = new BrowserWindow({
    ...bounds, minWidth: 960, minHeight: 620, show: false,
    title: '墨页', backgroundColor: '#f7f8fa', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 22 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  main.webContents.on('will-navigate', event => event.preventDefault())
  main.on('close', event => {
    if (!canClose) { event.preventDefault(); send({ type: 'close-request' }); return }
    clearTimeout(persistTimer)
    if (session) writeFileSync(sessionFile(), JSON.stringify(session), { mode: 0o600 })
    writeFileSync(windowFile(), JSON.stringify(main!.getNormalBounds()), { mode: 0o600 })
  })
  main.on('closed', () => { main = null })
  main.once('ready-to-show', () => main?.show())
  if (process.env.ELECTRON_RENDERER_URL) await main.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await main.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (main && !main.webContents.isLoading()) void openPaths([path]).then(documents => send({ type: 'opened', documents }))
  else pendingOpen.push(path)
})
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', (_, argv) => {
    main?.show(); main?.focus()
    const paths = argv.filter(arg => /\.(md|markdown)$/i.test(arg))
    if (paths.length) void openPaths(paths).then(documents => send({ type: 'opened', documents }))
  })
  app.whenReady().then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    session = await restoreSession(sessionFile(), store)
    try { recents = JSON.parse(await fs.readFile(recentFile(), 'utf8')) } catch { /* first launch */ }
    protocol.handle('moye-asset', async request => {
      try {
        const url = new URL(request.url)
        const id = url.pathname.slice(1).split('/')[0]
        const path = await store.localImage(request.url, id)
        return net.fetch(pathToFileURL(path).href)
      } catch { return new Response('Image unavailable', { status: 404 }) }
    })
    setupIPC()
    setupMenu()
    await createWindow()
    app.on('activate', () => { if (!main) void createWindow(); else main.show() })
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => {
  if (main && !canClose) {
    event.preventDefault()
    send({ type: 'close-request', quit: true })
  }
})
app.on('will-quit', () => store.dispose())
