import * as fs from "node:fs"
import * as path from "node:path"
import { writeBlob, writeTree, writeCommit } from "./objects"
import { resolveHead, generateAutoCommitMessage } from "./counter"
import { updateRef } from "./repository"
import { loadIndex, saveIndex, type GiggleIndex } from "./indexCache"
import type { TreeEntry, CommitObject } from "./types"

interface TreeNode {
  type: "tree" | "blob"
  name: string
  oid?: string
  mode: string
  children: Map<string, TreeNode>
}

export function buildHierarchicalTree(rootDir: string, giggleDir: string, relFilePaths: string[]): string {
  const rootNode: TreeNode = {
    type: "tree",
    name: "",
    mode: "40000",
    children: new Map(),
  }

  const index = loadIndex(giggleDir)
  const updatedIndex: GiggleIndex = {
    version: 1,
    entries: {},
  }

  for (const relPath of relFilePaths) {
    const fullPath = path.join(rootDir, relPath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(fullPath)
    } catch {
      continue
    }

    if (!stat.isFile()) {
      continue
    }

    const isExecutable = (stat.mode & 0o111) !== 0
    const defaultMode = isExecutable ? "100755" : "100644"

    let blobOid: string
    let mode: string = defaultMode

    const cached = index.entries[relPath]
    const objectPath = cached
      ? path.join(giggleDir, "objects", cached.oid.slice(0, 2), cached.oid.slice(2))
      : ""

    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      fs.existsSync(objectPath)
    ) {
      // Re-use cached blob OID if file stat has not changed and object exists
      blobOid = cached.oid
      mode = cached.mode || defaultMode
    } else {
      // File modified or new: read and compress into loose object
      let data: Buffer
      try {
        data = fs.readFileSync(fullPath)
      } catch {
        continue
      }
      blobOid = writeBlob(giggleDir, data)
    }

    updatedIndex.entries[relPath] = {
      oid: blobOid,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      mode,
    }

    const parts = relPath.replace(/\\/g, "/").split("/").filter((p) => p.length > 0)
    let current = rootNode

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue
      const isLeaf = i === parts.length - 1

      if (isLeaf) {
        current.children.set(part, {
          type: "blob",
          name: part,
          oid: blobOid,
          mode,
          children: new Map(),
        })
      } else {
        let child = current.children.get(part)
        if (!child) {
          child = {
            type: "tree",
            name: part,
            mode: "40000",
            children: new Map(),
          }
          current.children.set(part, child)
        }
        current = child
      }
    }
  }

  const treeOid = writeTreeNode(giggleDir, rootNode)
  saveIndex(giggleDir, updatedIndex)
  return treeOid
}

function writeTreeNode(giggleDir: string, node: TreeNode): string {
  const entries: TreeEntry[] = []

  for (const [name, child] of node.children.entries()) {
    if (child.type === "blob") {
      entries.push({
        name,
        oid: child.oid!,
        mode: child.mode,
        type: "blob",
      })
    } else {
      const treeOid = writeTreeNode(giggleDir, child)
      entries.push({
        name,
        oid: treeOid,
        mode: "40000",
        type: "tree",
      })
    }
  }

  return writeTree(giggleDir, entries)
}

export function commitWorkspace(
  rootDir: string,
  giggleDir: string,
  trackedRelPaths: string[],
  customMessage?: string,
  authorInfo?: { name: string; email: string }
): { commitOid: string; treeOid: string; message: string } {
  const treeOid = buildHierarchicalTree(rootDir, giggleDir, trackedRelPaths)
  const { branch, commitOid: parentOid } = resolveHead(giggleDir)

  const message = customMessage && customMessage.trim().length > 0
    ? customMessage.trim()
    : generateAutoCommitMessage(giggleDir)

  const author = {
    name: authorInfo?.name || "Giggle User",
    email: authorInfo?.email || "user@giggle.local",
    timestamp: Math.floor(Date.now() / 1000),
    timezone: "+0000",
  }

  const commitData: CommitObject = {
    tree: treeOid,
    parents: parentOid ? [parentOid] : [],
    author,
    committer: author,
    message,
  }

  const newCommitOid = writeCommit(giggleDir, commitData)

  const targetRef = branch ? `refs/heads/${branch}` : "refs/heads/main"
  updateRef(giggleDir, targetRef, newCommitOid)

  return {
    commitOid: newCommitOid,
    treeOid,
    message,
  }
}
