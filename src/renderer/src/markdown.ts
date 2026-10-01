import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import DOMPurify from 'dompurify'
import type { ExportOptions } from '../../shared/types'
import { bridge } from './bridge'
import markdownCSS from './markdown.css?inline'
import katexCSS from 'katex/dist/katex.min.css?inline'
import highlightCSS from 'highlight.js/styles/github.css?inline'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkRehype).use(rehypeKatex, { strict: 'ignore' })
  .use(rehypeHighlight, { ignoreMissing: true, plainText: ['mermaid'] }).use(rehypeStringify)

export interface Heading { text: string; level: number; index: number; line: number }
export function getHeadings(markdown: string): Heading[] {
  const tree = unified().use(remarkParse).parse(markdown)
  const extract = (node: any): string => node.value ?? node.children?.map(extract).join('') ?? ''
  return tree.children.filter(node => node.type === 'heading').map((node: any, index) => ({
    text: extract(node), level: node.depth, index, line: node.position.start.line
  }))
}
export function wordCount(text: string) {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const latin = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return cjk + latin
}
export async function renderMarkdown(text: string, id: string) {
  const html = String(await processor.process(text))
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html, {
    ADD_TAGS: ['annotation', 'semantics'], ADD_ATTR: ['encoding']
  }), 'text/html')
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') ?? ''
    if (src && !/^(?:https?:|data:|blob:)/i.test(src)) {
      img.setAttribute('src', `moye-asset://local/${id}/${encodeURIComponent(src)}`)
    }
  })
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => { h.id = `heading-${i}` })
  doc.querySelectorAll('a').forEach(link => { link.setAttribute('rel', 'noopener noreferrer') })
  return doc.body.innerHTML
}

export async function renderDiagrams(container: HTMLElement) {
  const blocks = [...container.querySelectorAll('pre > code.language-mermaid')]
  if (!blocks.length) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'system-ui', suppressErrorRendering: true, htmlLabels: false })
  for (const [index, block] of blocks.entries()) {
    try {
      const { svg } = await mermaid.render(`moye-${crypto.randomUUID().replaceAll('-', '')}-${index}`, block.textContent ?? '')
      if (!container.contains(block)) continue
      const wrapper = document.createElement('div')
      wrapper.className = 'mermaid-diagram'
      wrapper.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject', 'div', 'span', 'p'], ADD_ATTR: ['xmlns'] })
      block.parentElement!.replaceWith(wrapper)
    } catch (error) {
      if (!container.contains(block)) continue
      block.parentElement!.classList.add('diagram-error')
      const message = document.createElement('small')
      message.textContent = `图表语法错误：${String(error).split('\n')[0]}`
      block.parentElement!.append(message)
    }
  }
}

async function svgToPng(svg: SVGSVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const box = svg.viewBox.baseVal
  const width = Math.ceil(box.width || svg.getBoundingClientRect().width || 800)
  const height = Math.ceil(box.height || svg.getBoundingClientRect().height || 400)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const source = new XMLSerializer().serializeToString(clone)
  const image = new Image()
  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
  await image.decode()
  const canvas = document.createElement('canvas')
  const scale = Math.min(2, Math.sqrt(16_000_000 / (width * height)))
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale)
  const context = canvas.getContext('2d')!
  context.scale(scale, scale)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

export async function makeExportHTML(
  element: HTMLElement, title: string, documentId: string, options: ExportOptions
) {
  if (element.querySelector('.diagram-error, pre > code.language-mermaid')) throw new Error('图表未完成渲染或语法有误，请检查后重试')
  const clone = element.cloneNode(true) as HTMLElement
  // Discard UI status messages but keep document content.
  clone.querySelectorAll('.preview-feedback').forEach(node => node.remove())
  const diagrams: string[] = []
  for (const svg of element.querySelectorAll<SVGSVGElement>('.mermaid-diagram svg')) diagrams.push(await svgToPng(svg))
  clone.querySelectorAll('.mermaid-diagram').forEach((node, i) => {
    const img = document.createElement('img'); img.src = diagrams[i]; img.alt = '图表'
    node.replaceChildren(img)
  })
  for (const img of clone.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (src) img.src = await bridge.embedImage(src, documentId)
  }
  // Resolve bundled font files into data URLs so exported HTML is standalone.
  let fonts = katexCSS
  const matches = [...fonts.matchAll(/url\(([^)]+)\)/g)]
  for (const match of matches) {
    const src = match[1].replace(/["']/g, '')
    if (src.startsWith('data:')) continue
    const response = await fetch(new URL(src, location.href))
    if (!response.ok) throw new Error('公式字体未能加载')
    const blob = await response.blob()
    const encoded = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob)
    })
    fonts = fonts.replace(match[0], `url("${encoded}")`)
  }
  const escapedTitle = title.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  const transparent = options.format === 'png' && options.transparent
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title>
<style>${fonts}\n${highlightCSS}\n${markdownCSS}
html,body{margin:0;background:${transparent ? 'transparent' : '#fff'};color:#272d35}
body{padding:${options.margin}mm;box-sizing:border-box}
.markdown-body{max-width:900px;margin:0 auto;font-size:15px;--md-text:#272d35;--md-muted:#6b7280;--md-border:#e6e9ed;--md-code:#f5f7f9;--md-accent:#548579}
@media print{body{padding:0}.markdown-body{max-width:none}a{color:inherit}pre,blockquote,tr,img,svg{break-inside:avoid}h1,h2,h3{break-after:avoid}thead{display:table-header-group}}
</style></head><body><article class="markdown-body style-${options.style}">${clone.innerHTML}</article></body></html>`
  return { html, diagrams }
}
