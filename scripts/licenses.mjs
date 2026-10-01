import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const sections = []
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
  const names = (await readdir(path)).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))
  const licenses = []
  for (const name of names) {
    try { licenses.push(`${name}\n${await readFile(join(path, name), 'utf8')}`) } catch { /* directories */ }
  }
  sections.push(`${pkg.name}@${pkg.version}\nLicense: ${JSON.stringify(pkg.license ?? pkg.licenses ?? 'See upstream')}\n${licenses.join('\n\n')}`)
}
await mkdir('resources/legal', { recursive: true })
await writeFile('resources/legal/npm-licenses.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n'))
console.log(`Recorded notices for ${sections.length} production dependencies`)
