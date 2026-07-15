import { gzipSync } from 'node:zlib'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const files = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push(path)
  }
}

await walk(root)

const assets = await Promise.all(files
  .filter((file) => /\.(js|css)$/.test(file))
  .map(async (file) => {
    const body = await readFile(file)
    return { file: relative(root, file), type: file.endsWith('.css') ? 'css' : 'js', raw: body.byteLength, gzip: gzipSync(body).byteLength }
  }))

const limits = {
  maxJavaScriptChunkGzip: 200_000,
  totalJavaScriptGzip: 475_000,
  totalCssGzip: 30_000,
}
const js = assets.filter((asset) => asset.type === 'js')
const css = assets.filter((asset) => asset.type === 'css')
const failures = [
  ...js.filter((asset) => asset.gzip > limits.maxJavaScriptChunkGzip).map((asset) => `${asset.file} is ${asset.gzip} B gzip (limit ${limits.maxJavaScriptChunkGzip} B)`),
  ...(js.reduce((sum, asset) => sum + asset.gzip, 0) > limits.totalJavaScriptGzip ? ['Total JavaScript gzip budget exceeded'] : []),
  ...(css.reduce((sum, asset) => sum + asset.gzip, 0) > limits.totalCssGzip ? ['Total CSS gzip budget exceeded'] : []),
]

console.table(assets.sort((a, b) => b.gzip - a.gzip))
if (failures.length) {
  console.error('\nPerformance budget failed:\n- ' + failures.join('\n- '))
  process.exitCode = 1
} else {
  console.log('\nPerformance budget passed.')
}
