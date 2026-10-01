import { access, chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Pinned, verified against the official release checksums. No system-wide install.
const version = '3.12'
const hashes = {
  arm64: 'f148ca09c9f36594db527a9fc988ad736290ce428f79594c50208cd1ec58b3c0',
  x64: '18577f9460c3dc5d2651ad3bab37d513bc2034a5a777fbe18fa0a5acf2e936ea'
}
const arch = process.argv.includes('--x64') ? 'x64' : process.arch
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`)
const dest = resolve(`resources/pandoc/${arch}`)
await mkdir(dest, { recursive: true })
await copyFile(resolve('resources/legal/PANDOC-COPYING.md'), join(dest, 'COPYING.md'))
await copyFile(resolve('THIRD_PARTY_NOTICES.md'), join(dest, 'THIRD_PARTY_NOTICES.md'))
try {
  await access(join(dest, 'pandoc'))
  const installed = execFileSync(join(dest, 'pandoc'), ['--version'], { encoding: 'utf8' })
  if (installed.startsWith(`pandoc ${version}\n`)) {
    console.log(`Pandoc ${version} (${arch}) ready`)
    process.exit(0)
  }
} catch { /* Download below. */ }
const asset = `pandoc-${version}-${arch === 'x64' ? 'x86_64' : 'arm64'}-macOS.zip`
const base = `https://github.com/jgm/pandoc/releases/download/${version}`
const temp = await mkdtemp(join(tmpdir(), 'moye-pandoc-'))
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Download ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}
async function find(dir, name) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.name === name) return path
    if (item.isDirectory()) { const hit = await find(path, name); if (hit) return hit }
  }
}
try {
  console.log(`Downloading ${asset} …`)
  const data = await download(`${base}/${asset}`)
  const expected = hashes[arch]
  const actual = createHash('sha256').update(data).digest('hex')
  if (!expected || expected !== actual) throw new Error('Pandoc checksum mismatch')
  const archive = join(temp, asset)
  await writeFile(archive, data)
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, join(temp, 'unpacked')])
  const binary = await find(join(temp, 'unpacked'), 'pandoc')
  if (!binary) throw new Error('Pandoc executable missing from archive')
  await mkdir(dest, { recursive: true })
  await copyFile(binary, join(dest, 'pandoc'))
  await chmod(join(dest, 'pandoc'), 0o755)
  await writeFile(join(dest, 'VERSION'), `${version}\n${actual}\n`)
  console.log(`Pandoc ${version} installed to ${dest}`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
