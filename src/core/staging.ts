import * as fs from "node:fs"
import * as path from "node:path"
import { writeBlob, writeTree, writeCommit } from "./objects"
import { resolveHead, generateAutoCommitMessage } from "./counter"
import { updateRef } from "./repository"
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

  for (const relPath of relFilePaths) {
    const fullPath = path.join(rootDir, relPath)
    if (!fs.existsSync(fullPath)) {
      continue
    }

    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) {
      continue
    }

    const data = fs.readFileSync(fullPath)
    const blobOid = writeBlob(giggleDir, data)
    // 100755 for executable, 100644 for regular file
    const isExecutable = (stat.mode & 0o111) !== 0
    const mode = isExecutable ? "100755" : "100644"

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

  return writeTreeNode(giggleDir, rootNode)
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
