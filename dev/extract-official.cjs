// Extract a real client-half plugin's package.json from the official asar so we
// can copy its exact dsh.client declaration shape instead of guessing.
const fs = require('fs')

const ASAR = 'C:/Users/19980/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
const HEADER_SIZE = 16
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(HEADER_SIZE)
fs.readSync(fd, head, 0, HEADER_SIZE, 0)
const jsonSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonSize)
fs.readSync(fd, jsonBuf, 0, jsonSize, HEADER_SIZE)
const header = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''))
const dataOffset = HEADER_SIZE + jsonSize

function findNode(parts) {
  let node = header
  for (const p of parts) {
    if (!node.files || !node.files[p]) return null
    node = node.files[p]
  }
  return node
}

function readFile(node) {
  const buf = Buffer.alloc(node.size)
  fs.readSync(fd, buf, 0, node.size, dataOffset + Number(node.offset))
  return buf.toString('utf8')
}

// locate node_modules/@deepseek-ai/<pkg>/package.json for a given pkg
function pkgJsonPath(pkg) {
  // walk to any node_modules/@deepseek-ai dir in the tree
  const results = []
  function walk(node, path) {
    if (!node || !node.files) return
    for (const [name, child] of Object.entries(node.files)) {
      const p = path + '/' + name
      if (name === '@deepseek-ai' && child.files && child.files[pkg]) {
        const pj = child.files[pkg].files && child.files[pkg].files['package.json']
        if (pj) results.push({ path: p + '/' + pkg + '/package.json', node: pj })
      }
      if (child.files) walk(child, p)
    }
  }
  walk(header, '')
  return results
}

for (const pkg of ['dsh-client-ui-conversation', 'dsh-client-locale', 'dsh-client-modules']) {
  const hits = pkgJsonPath(pkg)
  console.log('=== ' + pkg + ' (' + hits.length + ' hits) ===')
  if (hits.length) {
    try {
      const j = JSON.parse(readFile(hits[0].node))
      console.log('name        :', j.name)
      console.log('version     :', j.version)
      console.log('dsh         :', JSON.stringify(j.dsh, null, 2))
      console.log('exports     :', JSON.stringify(j.exports, null, 2))
    } catch (e) {
      console.log('parse error:', e.message)
    }
  }
  console.log('')
}
