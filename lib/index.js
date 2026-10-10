/**
 * dsh-style-gallery host entry: serves the style catalog + preview images to
 * the browser half over the profile's webServer, so the gallery UI can render
 * real thumbnails instead of inlining tens of megabytes of base64 into a JS
 * bundle.
 *
 * Zero network access, zero writes: paths are resolved inside this package's
 * own `data/` and `assets/` directories, and every request path is validated
 * against a strict allowlist pattern before touching the filesystem.
 *
 * Asset layout (produced by `dev/build_assets.py`):
 *   assets/styles/     <FA-001>.webp         327 style previews
 *                      <FA-036>_grid.webp     36 reference sheets
 *   assets/layouts/    <SC-001>.webp         166 layout previews
 *   assets/colors/     <C-01>.webp           36 swatches
 *                      <sheet_01>.webp        6 contact sheets
 *   assets/groups/     <A_001-016>.webp      23 per-group contact sheets
 *   assets/characters/ <CH-001>.webp          1
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

/**
 * One entry per asset folder. The pattern is the whole validation: it pins the
 * filename to an exact id shape and a known extension, so no request can reach
 * a path separator, a `..`, or a file we did not ship. `resolveInside` is the
 * second line of defence, not the only one.
 */
const ASSET_KINDS = {
  // style previews and their `_grid` reference sheets
  styles: /^[A-Z]{2}-\d{3}(?:_grid)?\.(?:webp|png|jpe?g)$/,
  // layout previews (SC- / IG- / SB- / IP- / EC-)
  layouts: /^[A-Z]{2}-\d{3}\.(?:webp|png|jpe?g)$/,
  // colour swatches and the contact sheets they come from
  colors: /^(?:C-\d{2}|sheet_\d{2})\.(?:webp|png|jpe?g)$/,
  // the per-group contact sheets, keyed by the legacy 001-327 numbering
  groups: /^[A-H]_\d{3}-\d{3}\.(?:webp|png|jpe?g)$/,
  // the custom-library character sheet
  characters: /^CH-\d{3}\.(?:webp|png|jpe?g)$/,
}

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

    /**
     * The catalog on disk is machine-independent, but a prompt that needs a
     * reference image has to name a real file the user can attach — the skill
     * contract says to write the local asset path into the prompt. So the host
     * injects its own `assets/` directory at serve time. Parsed and serialised
     * once, then reused: the file is ~370 KB and never changes at runtime.
     */
    let catalogCache = null
    const readCatalog = async () => {
      if (catalogCache !== null) return catalogCache
      const raw = await readFile(join(dataDir, 'catalog.json'), 'utf8')
      const parsed = JSON.parse(raw)
      parsed.assetsPath = assetsDir
      catalogCache = Buffer.from(JSON.stringify(parsed), 'utf8')
      return catalogCache
    }

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

            // /catalog.json — the whole style + layout + color + group index.
            if (rel === 'catalog.json') {
              let body
              try {
                body = await readCatalog()
              } catch {
                response.writeHead(500)
                response.end()
                return
              }
              response.writeHead(200, {
                'content-type': MIME['.json'],
                'cache-control': 'no-cache',
                'content-length': String(body.byteLength),
              })
              response.end(request.method === 'HEAD' ? undefined : body)
              return
            }

            // /preview/<kind>/<file> — one style, layout or colour image.
            if (rel.startsWith('preview/')) {
              const rest = rel.slice('preview/'.length)
              const slash = rest.indexOf('/')
              if (slash === -1) {
                response.writeHead(404)
                response.end()
                return
              }
              const kind = rest.slice(0, slash)
              const file = rest.slice(slash + 1)
              const pattern = Object.prototype.hasOwnProperty.call(ASSET_KINDS, kind)
                ? ASSET_KINDS[kind]
                : null
              if (pattern === null || !pattern.test(file)) {
                response.writeHead(400)
                response.end()
                return
              }
              const path = resolveInside(join(kind, file), assetsDir)
              if (path === null) {
                response.writeHead(404)
                response.end()
                return
              }
              let size
              try {
                size = statSync(path).size
              } catch {
                response.writeHead(404)
                response.end()
                return
              }
              response.writeHead(200, {
                'content-type': MIME[extname(path)] ?? 'application/octet-stream',
                // Gallery art never changes for a given id — cache hard.
                'cache-control': 'public, max-age=604800, immutable',
                'content-length': String(size),
              })
              if (request.method === 'HEAD') {
                response.end()
                return
              }
              const stream = createReadStream(path)
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
