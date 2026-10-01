import { _electron as electron, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = resolve('.')
const workspace = await fs.mkdtemp(join(tmpdir(), 'moye-e2e-'))
const output = resolve('test-results')
await fs.mkdir(output, { recursive: true })
for (const name of await fs.readdir(output)) {
  if (/^(export\.(pdf|docx|png|jpg|html)|pages(-\d{3})?\.png|oversize\.png|failure\.png)$/.test(name)) {
    await fs.rm(join(output, name), { force: true })
  }
}
const environment = { ...process.env, MOYE_USER_DATA: join(workspace, 'profile') }
delete environment.ELECTRON_RUN_AS_NODE
let app
const failures = []
const fixture = '# 中文导出验证\n\n这是 **可编辑文字**，包含日期 2026-09-30。\n\n## 表格与公式\n\n| 项目 | 数值 |\n| --- | --- |\n| 中文 | 42 |\n\n公式：$E = mc^2$。\n\n```typescript\nconst value = 42;\n```\n\n```mermaid\nflowchart LR\n  A[写作] --> B[分享]\n```\n\n- [x] 完成编辑\n- [ ] 分享作品\n'
const log = text => console.log(`✓ ${text}`)
const launch = () => electron.launch({
  ...(process.env.MOYE_TEST_EXECUTABLE ? { executablePath: process.env.MOYE_TEST_EXECUTABLE, args: [] } : { args: [root] }),
  env: environment, timeout: 30_000
})
const saveDialog = path => app.evaluate(({ dialog }, path) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
}, path)
const menu = label => app.evaluate(({ Menu }, label) => {
  const find = items => {
    for (const item of items) {
      if (item.label === label) { item.click(); return true }
      if (item.submenu && find(item.submenu.items)) return true
    }
    return false
  }
  if (!find(Menu.getApplicationMenu().items)) throw new Error(`Menu not found: ${label}`)
}, label)
const processExit = child => child.exitCode !== null || child.signalCode !== null
  ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))

try {
  app = await launch()
  let page = await app.firstWindow()
  page.on('pageerror', error => failures.push(error.message))
  await expect(page.locator('.markdown-body h1')).toHaveText('让想法，自然成文。', { timeout: 20_000 })
  await page.screenshot({ path: join(output, 'editor-light.png') })
  log('Desktop launch and welcome preview')
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  const editor = page.locator('.editor-instance:not([hidden]) .cm-content')
  await editor.fill(fixture)
  await expect(page.locator('.markdown-body h1')).toHaveText('中文导出验证')
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.mermaid-diagram svg')).toContainText('写作')
  await expect(page.locator('.mermaid-diagram svg')).toContainText('分享')
  await expect(page.locator('.katex')).toHaveCount(1)
  log('Chinese content, editable table, formula and Mermaid render')
  const markdownPath = join(workspace, '验证文档.md')
  await saveDialog(markdownPath)
  await page.getByRole('button', { name: '保存文档 ⌘S', exact: true }).click()
  await expect.poll(() => fs.readFile(markdownPath, 'utf8').catch(() => '')).toBe(fixture)
  log('Native save writes exact UTF-8 content')
  // External clean-file refresh followed by a genuine dirty conflict.
  await fs.writeFile(markdownPath, fixture + '\n外部追加。\n')
  await expect(editor).toContainText('外部追加。')
  await editor.fill(fixture + '\n本地未保存。\n')
  await fs.writeFile(markdownPath, fixture + '\n磁盘新版本。\n')
  await expect(page.locator('.conflict-banner')).toBeVisible()
  await page.getByRole('button', { name: '载入外部版本', exact: true }).click()
  await expect(editor).toContainText('磁盘新版本。')
  await expect(page.getByRole('tab', { name: /冲突备份/ })).toHaveCount(1)
  log('External changes refresh clean files and preserve conflict copies')
  await editor.fill(fixture)
  await page.getByRole('button', { name: '保存文档 ⌘S', exact: true }).click()
  await expect.poll(() => fs.readFile(markdownPath, 'utf8')).toBe(fixture)
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(1)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  for (const [format, name] of [['pdf', 'PDF 文档'], ['docx', 'Word 文档'], ['png', 'PNG 图片'], ['jpeg', 'JPEG 图片'], ['html', '网页文件']]) {
    const path = join(output, `export.${format === 'jpeg' ? 'jpg' : format}`)
    await saveDialog(path)
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await page.getByRole('button', { name: '导出文件', exact: false }).click()
    await expect(page.locator('.export-success, .modal .inline-error')).toBeVisible({ timeout: 60_000 })
    assert(await page.locator('.export-success').isVisible(), `${format}: ${await page.locator('.modal .inline-error').allTextContents()}`)
    const data = await fs.readFile(path)
    assert(data.length > 100, `${format}: empty output`)
    if (format === 'pdf') assert.equal(data.subarray(0, 4).toString(), '%PDF')
    if (format === 'png') assert.equal(data.subarray(1, 4).toString(), 'PNG')
    if (format === 'jpeg') assert.equal(data.subarray(0, 2).toString('hex'), 'ffd8')
    if (format === 'docx') {
      const xml = execFileSync('/usr/bin/unzip', ['-p', path, 'word/document.xml'], { encoding: 'utf8' })
      assert(xml.includes('中文导出验证') && xml.includes('2026-09-30'), 'DOCX text missing')
      assert(xml.includes('<w:tbl>'), 'DOCX has no editable table')
      assert(xml.includes('m:oMath'), 'DOCX has no editable equation')
      assert(xml.includes('w:drawing'), 'DOCX has no diagram image')
    }
    if (format === 'html') assert(data.toString().includes('data:image/png;base64,'), 'HTML diagram not embedded')
    log(`${format.toUpperCase()} real file export (${data.length} bytes)`)
  }
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  // Read relative images with Unicode/spaces; Save As must keep them usable.
  const imagePath = join(workspace, '本地图 例.png')
  await page.locator('.brand-glyph').first().screenshot({ path: imagePath })
  await editor.fill(fixture + '\n![本地图](<本地图 例.png>)\n')
  await expect.poll(() => page.locator('.markdown-body img[alt="本地图"]').evaluateAll(images => images[0]?.naturalWidth ?? 0)).toBeGreaterThan(0)
  const movedDir = join(workspace, '另一个文件夹')
  await fs.mkdir(movedDir)
  const movedPath = join(movedDir, '跨目录.md')
  await saveDialog(movedPath)
  await menu('另存为…')
  await expect.poll(() => fs.readFile(movedPath, 'utf8').catch(() => '')).toContain('data:image/png;base64,')
  await expect(page.locator('.markdown-body img[alt="本地图"]')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect.poll(() => page.locator('.markdown-body img[alt="本地图"]').evaluateAll(images => images[0]?.naturalWidth ?? 0)).toBeGreaterThan(0)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, imagePath)
  await editor.fill('# 图片导入\n\n')
  await page.getByRole('button', { name: '插入图片', exact: true }).click()
  await expect(editor).toContainText('.assets/')
  assert((await fs.readdir(join(movedDir, '.assets'))).some(name => name.endsWith('.png')))
  log('Relative Unicode image paths, image import and cross-directory Save As')
  // Keyboard formatting, undo and native search.
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await editor.fill('键盘验证')
  await editor.press('Meta+a')
  await editor.press('Meta+b')
  await expect(editor).toHaveText('**键盘验证**')
  await editor.press('Meta+z')
  await expect(editor).toHaveText('键盘验证')
  await menu('查找与替换')
  await expect(page.locator('.cm-search')).toBeVisible()
  await editor.press('Escape')
  // Paged transparent images and the oversized long-image guard.
  await editor.fill('# 分页验证\n\n' + Array.from({ length: 65 }, (_, i) => `第 ${i + 1} 段：这些文字用于检查分页图片。\n\n`).join(''))
  await expect(page.locator('.markdown-body h1')).toHaveText('分页验证')
  await expect(page.locator('.preview-state')).toContainText('与你的文字同步')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('button', { name: /PNG 图片/ }).click()
  await page.getByLabel('图片方式').selectOption('pages')
  await page.getByLabel('透明背景').check()
  await saveDialog(join(output, 'pages.png'))
  await page.getByRole('button', { name: '导出文件', exact: false }).click()
  await expect(page.locator('.export-success')).toBeVisible({ timeout: 30_000 })
  assert((await fs.stat(join(output, 'pages-002.png'))).size > 100)
  const transparent = await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).toBitmap()[3], join(output, 'pages.png'))
  assert.equal(transparent, 0, 'PNG background should be transparent')
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await editor.fill('# 超长图验证\n\n' + '长文段落。\n\n'.repeat(900))
  await expect(page.locator('.markdown-body h1')).toHaveText('超长图验证')
  await expect(page.locator('.preview-state')).toContainText('与你的文字同步')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByLabel('图片方式').selectOption('long')
  const oversize = join(output, 'oversize.png')
  await saveDialog(oversize)
  await page.getByRole('button', { name: '导出文件', exact: false }).click()
  await expect(page.locator('.modal .inline-error')).toContainText('长图超过安全尺寸', { timeout: 30_000 })
  assert.equal(await fs.access(oversize).then(() => true, () => false), false)
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await menu('关闭标签')
  await expect(page.getByRole('dialog', { name: '保存这一次的灵感？' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('超长图验证')
  await menu('关闭标签')
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await page.getByRole('tab', { name: '跨目录.md', exact: true }).click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('跨目录.md')
  log('Formatting/undo/search, paged transparent PNG, long-image limits, cancel/discard close')
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await editor.fill('保存并关闭验证')
  const closePath = join(workspace, 'close.md')
  await saveDialog(closePath)
  await menu('关闭标签')
  await page.getByRole('button', { name: '保存并关闭', exact: true }).click()
  await expect.poll(() => fs.readFile(closePath, 'utf8').catch(() => '')).toBe('保存并关闭验证')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('tab', { name: '跨目录.md', exact: true }).click()
  await editor.fill(fixture)
  await expect(page.locator('.mermaid-diagram svg')).toContainText('写作')
  await page.getByRole('button', { name: '切换深浅主题', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.editor-instance:not([hidden]) .cm-theme-dark')).toBeVisible()
  await page.screenshot({ path: join(output, 'editor-dark.png') })
  await editor.fill(fixture + '\n恢复这段尚未保存的文字。\n')
  await expect.poll(async () => JSON.parse(await fs.readFile(join(workspace, 'profile/session.json'), 'utf8')).documents.some(d => d.content.includes('恢复这段'))).toBe(true)
  // Simulate a crash: no close confirmation, disk content must stay untouched.
  const crashed = processExit(app.process())
  app.process().kill('SIGKILL')
  await crashed
  app = await launch()
  page = await app.firstWindow()
  await expect(page.locator('.editor-instance:not([hidden]) .cm-content')).toContainText('恢复这段尚未保存的文字。', { timeout: 20_000 })
  assert.equal(await fs.readFile(markdownPath, 'utf8'), fixture)
  log('Crash recovery restores unsaved text without overwriting disk')
  await app.evaluate(({ app }) => app.quit())
  await expect(page.getByRole('dialog', { name: '保存这一次的灵感？' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(app.process().exitCode, null)
  await app.evaluate(({ app }) => app.quit())
  const exited = processExit(app.process())
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await exited
  log('Native app quit prompts for unsaved work, cancellation works, confirmed quit exits')
  assert.equal(failures.length, 0, `Renderer errors: ${failures.join('\n')}`)
  console.log(`\nAll desktop smoke tests passed. Artifacts: ${output}`)
} catch (error) {
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(output, 'failure.png') })
      console.error('UI error:', await page.locator('.inline-error, .toast.error').allTextContents())
    } catch { /* app failed */ }
  }
  console.error(error.stack ?? error.message)
  process.exitCode = 1
} finally {
  if (app) {
    const exited = processExit(app.process())
    try { await app.evaluate(({ app }) => app.exit(0)) } catch { /* already stopped */ }
    await exited
  }
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
