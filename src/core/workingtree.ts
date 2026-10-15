import * as fs from "node:fs"
import * as path from "node:path"
import { readLooseObject, parseTreeBuffer, parseCommitBuffer, hashObject } from "./objects"
import { resolveHead } from "./counter"
import type { TreeEntry, FileStatus } from "./types"

export interface TreeFileMap {
  [relPath: string]: { oid: string; mode: string }
}

export function flattenTree(giggleDir: string, treeOid: string, prefix: string = ""): TreeFileMap {
  const map: TreeFileMap = {}
  let obj: { type: string; content: Buffer }
  try {
    obj = readLooseObject(giggleDir, treeOid)
  } catch {
    return map
  }

  if (obj.type !== "tree") {
    return map
  }

  const entries = parseTreeBuffer(obj.content)
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.type === "tree") {
      const subMap = flattenTree(giggleDir, entry.oid, relPath)
      Object.assign(map, subMap)
    } else {
      map[relPath] = { oid: entry.oid, mode: entry.mode }
    }
  }

  return map
}

export function getLatestCommitTreeOid(giggleDir: string): string | null {
  const { commitOid } = resolveHead(giggleDir)
  if (!commitOid) {
    return null
  }

  try {
    const obj = readLooseObject(giggleDir, commitOid)
    if (obj.type !== "commit") {
      return null
    }
    const commit = parseCommitBuffer(obj.content)
    return commit.tree
  } catch {
    return null
  }
}

export function diffWorkingTree(rootDir: string, giggleDir: string, trackedRelPaths: string[]): FileStatus[] {
  const treeOid = getLatestCommitTreeOid(giggleDir)
  const statuses: FileStatus[] = []

  // Fast path for new repositories: if there is no commit tree yet, all files are added
  if (!treeOid) {
    for (const relPath of trackedRelPaths) {
      const fullPath = path.join(rootDir, relPath)
      if (fs.existsSync(fullPath)) {
        statuses.push({ path: relPath, status: "added", staged: false })
      }
    }
    return statuses
  }

  const commitFiles = flattenTree(giggleDir, treeOid)
  const diskPathSet = new Set(trackedRelPaths)

  for (const relPath of trackedRelPaths) {
    const fullPath = path.join(rootDir, relPath)
    if (!fs.existsSync(fullPath)) {
      continue
    }

    const committed = commitFiles[relPath]
    if (!committed) {
      statuses.push({ path: relPath, status: "added", staged: false })
      continue
    }

    // Only compute file hash when comparing against committed file
    let data: Buffer
    try {
      data = fs.readFileSync(fullPath)
    } catch {
      continue
    }

    const { oid } = hashObject("blob", data)
    if (committed.oid !== oid) {
      statuses.push({ path: relPath, status: "modified", staged: false })
    } else {
      statuses.push({ path: relPath, status: "unmodified", staged: false })
    }
  }

  // Check for files that were committed in the tree but are now deleted from disk
  for (const committedPath of Object.keys(commitFiles)) {
    if (!diskPathSet.has(committedPath)) {
      const fullPath = path.join(rootDir, committedPath)
      if (!fs.existsSync(fullPath)) {
        statuses.push({ path: committedPath, status: "deleted", staged: false })
      }
    }
  }

  return statuses
}
