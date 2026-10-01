import type { DocumentState, MoyeBridge, SessionState } from '../../shared/types'

// Browser preview uses the same editor. Desktop-only actions report their limits.
const key = 'moye-preview-session'
const desktopRequired = () => { throw new Error('此功能需要桌面版。请在项目目录运行 npm run dev') }
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function readFiles(files: File[]): Promise<DocumentState[]> {
  return Promise.all(files.filter(f => /\.(md|markdown|txt)$/i.test(f.name)).map(async f => {
    if (f.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB')
    const content = await f.text()
    return { id: crypto.randomUUID(), path: null, title: f.name, content, savedContent: content, mtimeMs: null }
  }))
}
const preview: MoyeBridge = {
  async bootstrap() {
    let state: Partial<SessionState> = {}
    try { state = JSON.parse(localStorage.getItem(key) ?? '{}') } catch { /* new session */ }
    return { ...state, recents: [], version: '0.1.0', desktop: false }
  },
  async open() {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.md,.markdown,.txt'; input.multiple = true
      input.onchange = async () => resolve(await readFiles([...input.files!]))
      input.oncancel = () => resolve([])
      input.click()
    })
  },
  openRecent: async () => desktopRequired(),
  openDropped: readFiles,
  async save(doc) {
    download(doc.title, doc.content, 'text/markdown;charset=utf-8')
    return { ...doc, savedContent: doc.content }
  },
  async persist(state) { localStorage.setItem(key, JSON.stringify(state)) },
  async confirmClose() { return 'cancel' },
  async closeWindow() {},
  async importImage(_, data) {
    if (!data) return desktopRequired()
    const bytes = new Uint8Array(data.bytes)
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(new Blob([bytes], { type: `image/${data.name.endsWith('.jpg') ? 'jpeg' : 'png'}` }))
    })
  },
  async embedImage(src) {
    if (src.startsWith('data:')) return src
    const response = await fetch(src)
    if (!response.ok) throw new Error('无法载入图片')
    return new Promise(resolve => {
      response.blob().then(blob => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
    })
  },
  async export(payload) {
    if (payload.options.format !== 'html') return desktopRequired()
    download(`${payload.title.replace(/\.md$/, '')}.html`, payload.html, 'text/html')
    return { paths: [] }
  },
  async reveal() { desktopRequired() },
  async openExternal(url) { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener') },
  onEvent: () => () => {}
}

export const bridge = window.moye ?? preview
