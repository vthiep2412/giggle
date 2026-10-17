import * as fs from "node:fs"
import * as path from "node:path"

export interface IndexEntry {
  oid: string
  mtimeMs: number
  size: number
  mode: string
}

export interface GiggleIndex {
  version: number
  entries: Record<string, IndexEntry>
}

export function getIndexPath(giggleDir: string): string {
  return path.join(giggleDir, "index.json")
}

export function loadIndex(giggleDir: string): GiggleIndex {
  const file = getIndexPath(giggleDir)
  if (!fs.existsSync(file)) {
    return { version: 1, entries: {} }
  }
  try {
    const raw = fs.readFileSync(file, "utf8")
    const parsed = JSON.parse(raw)
    return {
      version: parsed.version || 1,
      entries: parsed.entries || {},
    }
  } catch {
    return { version: 1, entries: {} }
  }
}

export function saveIndex(giggleDir: string, index: GiggleIndex): void {
  const file = getIndexPath(giggleDir)
  try {
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(file, JSON.stringify(index, null, 2), "utf8")
  } catch {
    // Ignore index persistence error
  }
}
