import { readLooseObject, parseCommitBuffer } from "./objects"
import * as fs from "node:fs"
import * as path from "node:path"

export function resolveHead(giggleDir: string): { branch: string | null; commitOid: string | null } {
  const headFile = path.join(giggleDir, "HEAD")
  if (!fs.existsSync(headFile)) {
    return { branch: null, commitOid: null }
  }

  const headContent = fs.readFileSync(headFile, "utf8").trim()
  if (headContent.startsWith("ref: ")) {
    const refPath = headContent.slice(5).trim()
    const branchName = refPath.replace(/^refs\/heads\//, "")
    const refFile = path.join(giggleDir, refPath)
    if (!fs.existsSync(refFile)) {
      return { branch: branchName, commitOid: null }
    }
    const commitOid = fs.readFileSync(refFile, "utf8").trim()
    return { branch: branchName, commitOid }
  }

  return { branch: null, commitOid: headContent }
}

export function countBranchCommits(giggleDir: string, startOid: string | null): number {
  if (!startOid) {
    return 0
  }

  let count = 0
  let currentOid: string | null = startOid
  const visited = new Set<string>()

  while (currentOid && !visited.has(currentOid)) {
    visited.add(currentOid)
    try {
      const obj = readLooseObject(giggleDir, currentOid)
      if (obj.type !== "commit") {
        break
      }
      count += 1
      const commit = parseCommitBuffer(obj.content)
      const firstParent = commit.parents[0]
      currentOid = firstParent || null
    } catch {
      break
    }
  }

  return count
}

export function generateAutoCommitMessage(giggleDir: string): string {
  const { commitOid } = resolveHead(giggleDir)
  const currentCount = countBranchCommits(giggleDir, commitOid)
  const nextCount = currentCount + 1
  return `Git commit ${nextCount}`
}
