import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { DocumentState, SessionState } from '../shared/types'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export async function atomicWrite(path: string, data: string | Buffer) {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    // Preserve an existing file's permissions when replacing it.
    const mode = await fs.stat(path).then(s => s.mode).catch(() => 0o600)
    await fs.writeFile(temp, data, { mode })
    await fs.rename(temp, path)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}

export function withinDirectory(root: string, path: string) {
  const part = relative(root, path)
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
}

export class DocumentStore {
  documents = new Map<string, DocumentState>()
  private watchers = new Map<string, FSWatcher>()
  private timers = new Map<string, NodeJS.Timeout>()
  constructor(private onChange: (doc: DocumentState) => void) {}

  async open(path: string): Promise<DocumentState> {
    const real = await fs.realpath(path)
    if (!['.md', '.markdown', '.txt'].includes(extname(real).toLowerCase())) throw new Error('请选择 Markdown 或文本文件')
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw new Error('文件超过 10 MB，请拆分后打开')
    const existing = [...this.documents.values()].find(d => d.path === real)
    const content = await fs.readFile(real, 'utf8')
    const doc: DocumentState = {
      id: existing?.id ?? randomUUID(), path: real, title: basename(real),
      content, savedContent: content, mtimeMs: stat.mtimeMs
    }
    this.register(doc)
    return doc
  }

  register(doc: DocumentState) {
    this.documents.set(doc.id, { ...doc })
    if (doc.path && !this.watchers.has(doc.id)) this.watchDocument(doc)
  }

  private watchDocument(doc: DocumentState) {
    if (!doc.path) return
    try {
      const watcher = watch(dirname(doc.path), (_, filename) => {
        if (filename && filename.toString() !== basename(doc.path!)) return
        clearTimeout(this.timers.get(doc.id))
        this.timers.set(doc.id, setTimeout(async () => {
          try {
            const current = this.documents.get(doc.id)
            if (!current?.path) return
            const stat = await fs.stat(current.path)
            if (stat.size > MAX_DOCUMENT_BYTES || stat.mtimeMs === current.mtimeMs) return
            const content = await fs.readFile(current.path, 'utf8')
            if (content === current.savedContent) {
              current.mtimeMs = stat.mtimeMs
              return
            }
            // Do not advance the disk baseline until the renderer resolves the conflict.
            this.onChange({ ...current, content, savedContent: content, mtimeMs: stat.mtimeMs })
          } catch { /* A temporarily removed/replaced file can be saved again. */ }
        }, 250))
      })
      this.watchers.set(doc.id, watcher)
    } catch { /* Read-only or virtual directories may not support watching. */ }
  }

  rewatch(doc: DocumentState) {
    this.watchers.get(doc.id)?.close()
    this.watchers.delete(doc.id)
    this.register(doc)
  }

  remove(id: string) {
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.documents.delete(id)
  }

  async localImage(src: string, documentId: string) {
    const doc = this.documents.get(documentId)
    if (!doc?.path) throw new Error('请先保存文档，再使用本地图片')
    const root = await fs.realpath(dirname(doc.path))
    let resource = src
    if (src.startsWith('moye-asset:')) {
      const url = new URL(src)
      const [id, ...parts] = url.pathname.slice(1).split('/')
      if (id !== documentId) throw new Error('图片不属于当前文档')
      resource = decodeURIComponent(parts.join('/'))
    }
    // Markdown renderers URL-encode spaces/Unicode. Prefer a literal filename
    // first so a file containing "%" still resolves without ambiguity.
    const real = await fs.realpath(resolve(root, resource)).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return fs.realpath(resolve(root, decodeURIComponent(resource)))
    })
    if (!withinDirectory(root, real)) throw new Error('本地图片必须位于文档所在文件夹内')
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extname(real).toLowerCase())) throw new Error('不支持的图片类型')
    const stat = await fs.stat(real)
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 25 MB')
    return real
  }

  async importImage(id: string, bytes: Buffer, name: string) {
    const doc = this.documents.get(id)
    if (!doc?.path) throw new Error('请先保存文档')
    const ext = extname(name).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) throw new Error('不支持的图片类型')
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 25 MB')
    const folder = join(dirname(doc.path), '.assets')
    await fs.mkdir(folder, { recursive: true })
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const file = `${hash}${ext}`
    await atomicWrite(join(folder, file), bytes)
    return `.assets/${file}`
  }

  dispose() {
    this.watchers.forEach(w => w.close())
    this.timers.forEach(t => clearTimeout(t))
  }
}

export async function restoreSession(path: string, store: DocumentStore): Promise<SessionState | null> {
  try {
    const state = JSON.parse(await fs.readFile(path, 'utf8')) as SessionState
    if (!Array.isArray(state.documents) || !state.settings) return null
    state.documents = await Promise.all(state.documents.filter(d =>
      typeof d.id === 'string' && typeof d.content === 'string' && typeof d.savedContent === 'string'
    ).map(async d => {
      if (d.path) {
        try {
          const stat = await fs.stat(d.path)
          if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('File too large')
          const disk = await fs.readFile(d.path, 'utf8')
          if (d.content === d.savedContent) d = { ...d, content: disk, savedContent: disk, mtimeMs: stat.mtimeMs }
          // Dirty documents retain their original baseline; save checks for disk conflicts.
        } catch { d = { ...d, path: null, mtimeMs: null, savedContent: '' } }
      }
      store.register(d)
      return d
    }))
    return state
  } catch { return null }
}
