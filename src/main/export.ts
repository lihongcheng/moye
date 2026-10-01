import { BrowserWindow, dialog, type SaveDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { ExportPayload, ExportResult } from '../shared/types'
import { atomicWrite, MAX_IMAGE_BYTES, type DocumentStore } from './files'

const exec = promisify(execFile)
const mime: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
}

export async function embedImage(src: string, id: string, store: DocumentStore) {
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(src)) {
    if (src.length > MAX_IMAGE_BYTES * 1.4) throw new Error('图片超过 25 MB')
    return src
  }
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`图片下载失败 (${response.status})：${src}`)
    const type = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!Object.values(mime).includes(type)) throw new Error(`远程资源不是支持的图片：${src}`)
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_IMAGE_BYTES) throw new Error('远程图片超过 25 MB')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`
  }
  if (/^[a-z][\w+.-]*:/i.test(src) && !src.startsWith('moye-asset:')) throw new Error(`不支持的图片地址：${src}`)
  const path = await store.localImage(src, id)
  return `data:${mime[extname(path).toLowerCase()]};base64,${(await fs.readFile(path)).toString('base64')}`
}

async function prepareWordMarkdown(payload: ExportPayload, dir: string, store: DocumentStore) {
  const { unified } = await import('unified')
  const { default: remarkParse } = await import('remark-parse')
  const tree = unified().use(remarkParse).parse(payload.markdown)
  const changes: { start: number; end: number; value: string }[] = []
  const imageReferences = new Set<string>()
  const nodes: any[] = []
  const walk = (node: any) => {
    nodes.push(node)
    if (node.type === 'imageReference') imageReferences.add(node.identifier)
    node.children?.forEach(walk)
  }
  walk(tree)
  let index = 0
  let diagram = 0
  for (const node of nodes) {
    if (node.type === 'code' && node.lang === 'mermaid') {
      const data = payload.diagrams[diagram++]
      if (!data) throw new Error('图表尚未渲染完成或存在语法错误，请修正后导出 Word')
      const file = join(dir, `diagram-${diagram}.png`)
      await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'))
      changes.push({ start: node.position.start.offset, end: node.position.end.offset, value: `![图表](${file})` })
    } else if (node.type === 'image' || (node.type === 'definition' && imageReferences.has(node.identifier))) {
      const data = await embedImage(node.url, payload.documentId, store)
      const type = data.slice(5, data.indexOf(';'))
      const extension = Object.keys(mime).find(key => mime[key] === type) ?? '.png'
      const file = join(dir, `image-${++index}${extension}`)
      await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'))
      const text = node.type === 'image' ? `![${(node.alt ?? '').replace(/[[\]]/g, '')}](${file})` : `[${node.label}]: ${file}`
      changes.push({ start: node.position.start.offset, end: node.position.end.offset, value: text })
    }
  }
  let result = payload.markdown
  for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.value + result.slice(change.end)
  return result
}

export async function exportDocument(
  parent: BrowserWindow, payload: ExportPayload, store: DocumentStore, pandocPath: string
): Promise<ExportResult | null> {
  const { options: opts } = payload
  if (!['pdf', 'docx', 'png', 'jpeg', 'html'].includes(opts.format)) throw new Error('不支持的导出格式')
  if (![1, 2].includes(opts.scale) || !Number.isFinite(opts.margin) || opts.margin < 5 || opts.margin > 40) throw new Error('导出参数不正确')
  if (!['A4', 'Letter'].includes(opts.pageSize)) throw new Error('页面尺寸不正确')
  const extension = opts.format === 'jpeg' ? 'jpg' : opts.format
  const suggested = payload.title.replace(/\.(md|markdown|txt)$/i, '').replace(/[/\\:]/g, '-') || '未命名'
  const saveOptions: SaveDialogOptions = {
    title: `导出 ${opts.format.toUpperCase()}`, defaultPath: `${suggested}.${extension}`,
    filters: [{ name: opts.format.toUpperCase(), extensions: [extension] }]
  }
  const result = await dialog.showSaveDialog(parent, saveOptions)
  if (result.canceled || !result.filePath) return null
  const target = result.filePath
  const temp = await fs.mkdtemp(join(tmpdir(), 'moye-export-'))
  let renderer: BrowserWindow | undefined
  try {
    if (opts.format === 'docx') {
      await fs.access(pandocPath).catch(() => { throw new Error('缺少 Pandoc，请在项目目录运行 npm run setup:pandoc 后重试') })
      const source = join(temp, 'document.md')
      await fs.writeFile(source, await prepareWordMarkdown(payload, temp, store))
      const output = join(temp, 'document.docx')
      const args = [
        source, '--from=markdown+tex_math_dollars+pipe_tables+task_lists-raw_html-raw_tex',
        '--to=docx', '--standalone', '--output', output,
        '--metadata', `title=${suggested}`
      ]
      await exec(pandocPath, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
      await atomicWrite(target, await fs.readFile(output))
      return { paths: [target] }
    }
    if (opts.format === 'html') {
      await atomicWrite(target, payload.html)
      return { paths: [target] }
    }
    const pageWidth = opts.pageSize === 'A4' ? 794 : 816
    const pageHeight = opts.pageSize === 'A4' ? 1123 : 1056
    const width = opts.landscape ? pageHeight : pageWidth
    const height = opts.landscape ? pageWidth : pageHeight
    const htmlFile = join(temp, 'export.html')
    await fs.writeFile(htmlFile, payload.html)
    renderer = new BrowserWindow({
      show: false, width, height, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await renderer.loadURL(pathToFileURL(htmlFile).href)
    await renderer.webContents.executeJavaScript(`
      (async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.decode().catch(() => { throw new Error('图片未能加载'); })));
        return true;
      })()
    `)
    if (opts.format === 'pdf') {
      const footer = '<div style="font-size:9px;color:#999;text-align:center;width:100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      const data = await renderer.webContents.printToPDF({
        pageSize: opts.pageSize, landscape: opts.landscape,
        printBackground: true, preferCSSPageSize: false,
        displayHeaderFooter: opts.pageNumbers, headerTemplate: '<span></span>', footerTemplate: footer,
        margins: { top: opts.margin / 25.4, bottom: opts.margin / 25.4, left: opts.margin / 25.4, right: opts.margin / 25.4 }
      })
      await atomicWrite(target, data)
      return { paths: [target] }
    }
    const contentHeight = await renderer.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)') as number
    const pageCount = opts.imageMode === 'pages' ? Math.ceil(contentHeight / height) : 1
    if (pageCount > 100) throw new Error('文档超过 100 张分页图片，请拆分文档或导出 PDF')
    if (opts.imageMode === 'long' && (width * contentHeight * opts.scale ** 2 > 60_000_000 || contentHeight * opts.scale > 30_000)) {
      throw new Error('长图超过安全尺寸，请选择「分页图片」或降低倍率')
    }
    const targets = Array.from({ length: pageCount }, (_, i) => i === 0 ? target :
      join(result.filePath!.slice(0, result.filePath!.length - basename(result.filePath!).length),
        `${basename(target, extname(target))}-${String(i + 1).padStart(3, '0')}${extname(target)}`))
    const existing = []
    for (const path of targets.slice(1)) { try { await fs.access(path); existing.push(path) } catch { /* new file */ } }
    if (existing.length) {
      const approval = await dialog.showMessageBox(parent, {
        type: 'warning', message: `另有 ${existing.length} 张分页图片已存在，是否覆盖？`,
        detail: existing.map(p => basename(p)).slice(0, 10).join('\n'),
        buttons: ['取消', '覆盖'], cancelId: 0, defaultId: 0
      })
      if (approval.response === 0) return null
    }
    renderer.webContents.debugger.attach('1.3')
    if (opts.transparent && opts.format === 'png') await renderer.webContents.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    const staged: string[] = []
    for (let page = 0; page < pageCount; page++) {
      const y = opts.imageMode === 'pages' ? page * height : 0
      const clipHeight = opts.imageMode === 'pages' ? Math.min(height, contentHeight - y) : contentHeight
      const shot = await renderer.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: opts.format, ...(opts.format === 'jpeg' ? { quality: 94 } : {}),
        captureBeyondViewport: true, fromSurface: true,
        clip: { x: 0, y, width, height: clipHeight, scale: opts.scale }
      })
      const stage = join(temp, `page-${page}.${extension}`)
      await fs.writeFile(stage, Buffer.from(shot.data, 'base64'))
      staged.push(stage)
    }
    for (let i = 0; i < targets.length; i++) await atomicWrite(targets[i], await fs.readFile(staged[i]))
    return { paths: targets }
  } finally {
    if (renderer && !renderer.isDestroyed()) renderer.destroy()
    await fs.rm(temp, { recursive: true, force: true })
  }
}
