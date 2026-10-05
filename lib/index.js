/**
 * dsh-style-gallery host entry: serves the style catalog + preview images to
 * the browser half over the profile's webServer, so the gallery UI can render
 * real thumbnails instead of inlining megabytes of base64 into a JS bundle.
 *
 * Zero network access, zero writes: paths are resolved inside this package's
 * own `data/` and `assets/` directories, and every request path is validated
 * against a strict allowlist pattern before touching the filesystem.
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-style-gallery'

const here = fileURLToPath(new URL('.', import.meta.url))
const pkgRoot = join(here, '..')
const dataDir = join(pkgRoot, 'data')
const assetsDir = join(pkgRoot, 'assets')

/** Route prefix owned by this plugin. */
const PREFIX = '/dsh-style-gallery'

/** `FA-014` style numbers only — the shape every style asset uses. */
const STYLE_ID_RE = /^[A-Z]{2}-\d{3}$/
/** Only these extensions are ever served from assets/. */
const ALLOWED_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg'])

/** Content types for the handful of extensions we serve. */
const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * Resolve a request path to an existing file, refusing anything that escapes
 * the package. Returns null when the path is malformed, outside the root, or
 * points at a missing file.
 */
function resolveInside(file, root) {
  const resolved = normalize(join(root, file))
  if (resolved !== root && !resolved.startsWith(root + sep)) return null
  if (!existsSync(resolved)) return null
  try {
    if (!statSync(resolved).isFile()) return null
  } catch {
    return null
  }
  return resolved
}

/** Cheap extname — avoids pulling node:path into the hot path twice. */
function extname(p) {
  const i = p.lastIndexOf('.')
  return i === -1 ? '' : p.slice(i).toLowerCase()
}

/**
 * Strip the route prefix; returns the path portion or null when the request
 * does not belong to this plugin.
 */
function routeOf(request) {
  const url = request.url ?? ''
  const path = url.split('?')[0].split('#')[0]
  if (!path.startsWith(PREFIX + '/')) return null
  return decodeURIComponent(path.slice(PREFIX.length + 1))
}

/**
 * Register the gallery routes against the host context.
 * @param ctx - Host context that may acquire the webServer service.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    if (webServer === undefined) return

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: PREFIX,
          handler: async (request, response) => {
            const rel = routeOf(request)
            if (rel === null || rel === '') {
              response.writeHead(404)
              response.end()
              return
            }

            if (request.method !== 'GET' && request.method !== 'HEAD') {
              response.writeHead(405, { allow: 'GET, HEAD' })
              response.end()
              return
            }

            // /catalog.json — the whole style + color + group index.
            if (rel === 'catalog.json') {
              const file = resolveInside('catalog.json', dataDir)
              if (file === null) {
                response.writeHead(404)
                response.end()
                return
              }
              const body = await readFile(file)
              response.writeHead(200, {
                'content-type': MIME['.json'],
                'cache-control': 'no-cache',
                'content-length': String(body.byteLength),
              })
              response.end(request.method === 'HEAD' ? undefined : body)
              return
            }

            // /preview/<FA-014>.<ext> — one style's preview image.
            if (rel.startsWith('preview/')) {
              const rest = rel.slice('preview/'.length)
              const dot = rest.lastIndexOf('.')
              if (dot === -1) {
                response.writeHead(404)
                response.end()
                return
              }
              const id = rest.slice(0, dot)
              const ext = rest.slice(dot).toLowerCase()
              if (!STYLE_ID_RE.test(id) || !ALLOWED_EXT.has(ext)) {
                response.writeHead(400)
                response.end()
                return
              }
              const file = resolveInside(id + ext, assetsDir)
              if (file === null) {
                response.writeHead(404)
                response.end()
                return
              }
              let size
              try {
                size = statSync(file).size
              } catch {
                response.writeHead(404)
                response.end()
                return
              }
              response.writeHead(200, {
                'content-type': MIME[ext] ?? 'application/octet-stream',
                // Style art never changes for a given id — cache hard.
                'cache-control': 'public, max-age=604800, immutable',
                'content-length': String(size),
              })
              if (request.method === 'HEAD') {
                response.end()
                return
              }
              const stream = createReadStream(file)
              stream.on('error', () => {
                response.destroy()
              })
              stream.pipe(response)
              return
            }

            response.writeHead(404)
            response.end()
          },
        }),
      'dsh-style-gallery: http routes',
    )
  })
}
