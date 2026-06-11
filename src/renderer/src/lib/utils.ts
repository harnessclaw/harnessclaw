import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 把磁盘上的绝对路径转成自定义协议 `local-file://` 的 URL，<img> /
 * <audio> / <video> 之类标签直接当 src 使用。
 *
 * 为什么不用 file://：在 Electron 默认 webSecurity=true + contextIsolation
 * 下，渲染端从 http://localhost（dev）或 app://（prod）页面引用 file:// 资源
 * 会触发跨源拦截，图片加载不出来。`local-file` scheme 在主进程
 * (`protocol.handle`) 里桥接到磁盘读取，规避了浏览器层的限制。
 *
 * 为什么用占位 host `local`：`local-file` 是以 `standard: true` 注册的，
 * Chromium URL 解析按 "special URL" 规则走，empty host 不被允许，会把
 * pathname 的第一段提升为 host 并做小写化（例如
 * `local-file:///Users/...` 被规范化为 `local-file://users/...`，主进程
 * 拿到的 pathname 就少了 `Users` 一段，文件读不到，最终回到渲染端是
 * `ERR_UNEXPECTED`）。固定加一个占位 host 让 Chromium 不再 shift 路径。
 *
 * 路径需要做 URL 编码以保留空格、中文等特殊字符；Windows 盘符（C:\...）
 * 转换为 `/C:/...` 形式，与主进程解析逻辑保持对称。
 */
export function localFileUrl(absolutePath: string): string {
  if (!absolutePath) return ''
  let p = absolutePath.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = `/${p}`
  return `local-file://local${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

const POSIX_LOCAL_PATH_RE = /^\/(?:Users|home|var|tmp|usr|opt|etc|private|Library|Applications|System|mnt|media|dev|srv|root)\//
const WINDOWS_LOCAL_PATH_RE = /^[A-Za-z]:[\\/]/
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i

function protocolOfUrlLike(value: string): string | undefined {
  const colon = value.indexOf(':')
  if (colon === -1) return undefined

  const slash = value.indexOf('/')
  const questionMark = value.indexOf('?')
  const numberSign = value.indexOf('#')
  if (
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  ) {
    return undefined
  }
  return value.slice(0, colon).toLowerCase()
}

function fileUrlToPath(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'file:') return undefined
    const decodedPath = decodeURIComponent(parsed.pathname)
    return /^\/[A-Za-z]:/.test(decodedPath) ? decodedPath.slice(1) : decodedPath
  } catch {
    return undefined
  }
}

/**
 * Markdown image URLs can come back from image-generation tools as local paths
 * or file:// URLs. Renderer pages cannot load those directly under Electron's
 * default webSecurity settings, so route them through the app's local-file
 * protocol. Non-image data URLs are rejected here before React renders <img>.
 */
export function normalizeMarkdownImageSrc(src: string | null | undefined): string | undefined {
  const value = (src || '').trim()
  if (!value) return undefined

  if (/^local-file:\/\//i.test(value)) return value
  if (DATA_IMAGE_RE.test(value)) return value
  if (/^data:/i.test(value)) return undefined

  if (/^file:/i.test(value)) {
    const filePath = fileUrlToPath(value)
    return filePath ? localFileUrl(filePath) : undefined
  }

  if (POSIX_LOCAL_PATH_RE.test(value) || WINDOWS_LOCAL_PATH_RE.test(value)) {
    return localFileUrl(value)
  }

  const protocol = protocolOfUrlLike(value)
  if (protocol && protocol !== 'http' && protocol !== 'https') return undefined
  return value
}
