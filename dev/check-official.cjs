// Parse the asar header properly as JSON and list @deepseek-ai client packages,
// then check which of the ones our plugin needs are actually present.
const fs = require('fs')

const ASAR = 'C:/Users/19980/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonSize)
fs.readSync(fd, jsonBuf, 0, jsonSize, 16)
const header = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''))

// Walk the asar tree collecting package dir names under any node_modules/@deepseek-ai
const found = new Set()
function walk(node, path) {
  if (!node || !node.files) return
  for (const [name, child] of Object.entries(node.files)) {
    const p = path + '/' + name
    if (path.endsWith('node_modules/@deepseek-ai') || path.endsWith('@deepseek-ai')) {
      found.add(name)
    }
    if (child.files) walk(child, p)
  }
}
walk(header, '')

const deepseek = [...found].filter((n) => n.startsWith('dsh')).sort()
console.log('=== dsh-* packages under @deepseek-ai (' + deepseek.length + ') ===')
console.log(deepseek.join('\n'))

const needed = [
  'dsh-client-runtime',
  'dsh-client-locale',
  'dsh-client-ui-settings',
  'dsh-client-ui-theme',
  'dsh-client-ui-conversation',
  'dsh-client-ui-primitives',
]
console.log('\n=== plugin needs ===')
let missing = 0
for (const n of needed) {
  const hit = found.has(n)
  if (!hit) missing++
  console.log((hit ? 'HAVE ' : 'MISS ') + n)
}
console.log('\nmissing: ' + missing)
