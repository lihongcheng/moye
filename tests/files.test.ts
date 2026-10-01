import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWrite, DocumentStore, restoreSession, withinDirectory } from '../src/main/files'
import { DEFAULT_SETTINGS } from '../src/shared/types'

let dir: string
let store: DocumentStore
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'moye-test-')); store = new DocumentStore(() => {}) })
afterEach(async () => { store.dispose(); await fs.rm(dir, { recursive: true, force: true }) })

describe('document persistence and recovery', () => {
  it('atomically replaces UTF-8 content and preserves permissions', async () => {
    const path = join(dir, '中文 文档.md')
    await fs.writeFile(path, 'old', { mode: 0o640 })
    await atomicWrite(path, '# 新内容\n正文与空格 ✓')
    expect(await fs.readFile(path, 'utf8')).toBe('# 新内容\n正文与空格 ✓')
    expect((await fs.stat(path)).mode & 0o777).toBe(0o640)
    expect(await fs.readdir(dir)).toEqual(['中文 文档.md'])
  })
  it('does not change original data if replacement cannot be written', async () => {
    const path = join(dir, 'document.md')
    await fs.writeFile(path, 'keep me')
    await expect(atomicWrite(join(dir, 'absent', 'document.md'), 'new')).rejects.toThrow()
    expect(await fs.readFile(path, 'utf8')).toBe('keep me')
  })
  it('keeps dirty recovery content and original baseline when disk has changed', async () => {
    const path = join(dir, 'document.md')
    await fs.writeFile(path, 'original')
    const doc = await store.open(path)
    const state = { documents: [{ ...doc, content: 'unsaved idea' }], activeId: doc.id, settings: DEFAULT_SETTINGS }
    await fs.writeFile(join(dir, 'session.json'), JSON.stringify(state))
    await fs.writeFile(path, 'external edit')
    const restored = await restoreSession(join(dir, 'session.json'), store)
    expect(restored!.documents[0].content).toBe('unsaved idea')
    expect(restored!.documents[0].savedContent).toBe('original')
    expect(await fs.readFile(path, 'utf8')).toBe('external edit')
  })
  it('refreshes clean documents from disk and retains missing documents as drafts', async () => {
    const path = join(dir, 'document.md')
    await fs.writeFile(path, 'original')
    const doc = await store.open(path)
    await fs.writeFile(join(dir, 'session.json'), JSON.stringify({ documents: [doc], activeId: doc.id, settings: DEFAULT_SETTINGS }))
    await fs.writeFile(path, 'new on disk')
    expect((await restoreSession(join(dir, 'session.json'), store))!.documents[0].content).toBe('new on disk')
    await fs.rm(path)
    const restored = await restoreSession(join(dir, 'session.json'), store)
    expect(restored!.documents[0]).toMatchObject({ path: null, content: 'original', savedContent: '' })
  })
  it('deduplicates reopened files and rejects traversal through a symlink', async () => {
    const path = join(dir, 'document.md')
    await fs.writeFile(path, '# Example')
    const doc = await store.open(path)
    expect((await store.open(path)).id).toBe(doc.id)
    await fs.symlink('/etc', join(dir, 'escape'))
    await expect(store.localImage('escape/hosts', doc.id)).rejects.toThrow('文件夹内')
    expect(withinDirectory(dir, `${dir}-other/image.png`)).toBe(false)
    expect(withinDirectory(dir, join(dir, '.assets', 'image.png'))).toBe(true)
  })
  it('copies assets into the document folder without user supplied traversal', async () => {
    const path = join(dir, 'document.md')
    await fs.writeFile(path, '')
    const doc = await store.open(path)
    const result = await store.importImage(doc.id, Buffer.from('image-data'), '../../escape.png')
    expect(result).toMatch(/^\.assets\/[0-9a-f]{16}\.png$/)
    expect(await fs.readFile(join(dir, result), 'utf8')).toBe('image-data')
    expect(await store.localImage(`moye-asset://local/${doc.id}/${encodeURIComponent(result)}`, doc.id)).toBe(await fs.realpath(join(dir, result)))
  })
})
