import { createHash } from "node:crypto"
import { deflateSync, inflateSync } from "node:zlib"
import * as fs from "node:fs"
import * as path from "node:path"
import type { GitObjectType, TreeEntry, CommitObject } from "./types"

export function hashObject(type: GitObjectType, content: Buffer): { oid: string; store: Buffer } {
  const header = Buffer.from(`${type} ${content.length}\0`)
  const store = Buffer.concat([header, content])
  const oid = createHash("sha1").update(store).digest("hex")
  return { oid, store }
}

export function writeLooseObject(giggleDir: string, type: GitObjectType, content: Buffer): string {
  const { oid, store } = hashObject(type, content)
  const dir = path.join(giggleDir, "objects", oid.slice(0, 2))
  const file = path.join(dir, oid.slice(2))

  if (fs.existsSync(file)) {
    return oid
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const compressed = deflateSync(store)
  fs.writeFileSync(file, compressed)
  return oid
}

export function readLooseObject(giggleDir: string, oid: string): { type: GitObjectType; content: Buffer } {
  const file = path.join(giggleDir, "objects", oid.slice(0, 2), oid.slice(2))
  if (!fs.existsSync(file)) {
    throw new Error(`Object not found: ${oid}`)
  }

  const compressed = fs.readFileSync(file)
  const store = inflateSync(compressed)
  const nullIndex = store.indexOf(0)
  if (nullIndex === -1) {
    throw new Error(`Malformed object header: ${oid}`)
  }

  const headerStr = store.subarray(0, nullIndex).toString("utf8")
  const spaceIndex = headerStr.indexOf(" ")
  const type = headerStr.slice(0, spaceIndex) as GitObjectType
  const content = store.subarray(nullIndex + 1)

  return { type, content }
}

export function writeBlob(giggleDir: string, data: Buffer): string {
  return writeLooseObject(giggleDir, "blob", data)
}

export function buildTreeBuffer(entries: TreeEntry[]): Buffer {
  // Sort entries strictly according to git byte order: memcmp with directories having a virtual trailing slash
  const sorted = [...entries].sort((a, b) => {
    const aStr = a.type === "tree" ? `${a.name}/` : a.name
    const bStr = b.type === "tree" ? `${b.name}/` : b.name
    return Buffer.compare(Buffer.from(aStr), Buffer.from(bStr))
  })

  const buffers: Buffer[] = []
  for (const entry of sorted) {
    const mode = entry.type === "tree" ? "40000" : entry.mode
    const modeName = Buffer.from(`${mode} ${entry.name}\0`)
    const oidBuf = Buffer.from(entry.oid, "hex")
    buffers.push(modeName, oidBuf)
  }

  return Buffer.concat(buffers)
}

export function parseTreeBuffer(buf: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < buf.length) {
    const spaceIndex = buf.indexOf(0x20, offset)
    if (spaceIndex === -1) break
    const mode = buf.subarray(offset, spaceIndex).toString("utf8")

    const nullIndex = buf.indexOf(0, spaceIndex + 1)
    if (nullIndex === -1) break
    const name = buf.subarray(spaceIndex + 1, nullIndex).toString("utf8")

    const oid = buf.subarray(nullIndex + 1, nullIndex + 21).toString("hex")
    offset = nullIndex + 21

    const isTree = mode === "40000" || mode === "040000" || mode.startsWith("40")
    entries.push({
      mode: isTree ? "40000" : mode,
      name,
      oid,
      type: isTree ? "tree" : "blob",
    })
  }

  return entries
}

export function writeTree(giggleDir: string, entries: TreeEntry[]): string {
  const buf = buildTreeBuffer(entries)
  return writeLooseObject(giggleDir, "tree", buf)
}

export function buildCommitBuffer(commit: CommitObject): Buffer {
  const lines: string[] = []
  lines.push(`tree ${commit.tree}`)
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`)
  }

  lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
  lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)
  lines.push("")
  lines.push(commit.message.trimEnd())
  lines.push("")

  return Buffer.from(lines.join("\n"), "utf8")
}

export function parseCommitBuffer(buf: Buffer): CommitObject {
  const text = buf.toString("utf8")
  const headerEnd = text.indexOf("\n\n")
  const headerPart = headerEnd !== -1 ? text.slice(0, headerEnd) : text
  const messagePart = headerEnd !== -1 ? text.slice(headerEnd + 2) : ""

  const lines = headerPart.split("\n")
  let tree = ""
  const parents: string[] = []
  let author = { name: "giggle", email: "giggle@local", timestamp: Math.floor(Date.now() / 1000), timezone: "+0000" }
  let committer = { ...author }

  for (const line of lines) {
    if (line.startsWith("tree ")) {
      tree = line.slice(5).trim()
    } else if (line.startsWith("parent ")) {
      parents.push(line.slice(7).trim())
    } else if (line.startsWith("author ")) {
      author = parseIdentity(line.slice(7))
    } else if (line.startsWith("committer ")) {
      committer = parseIdentity(line.slice(10))
    }
  }

  return {
    tree,
    parents,
    author,
    committer,
    message: messagePart.trim(),
  }
}

function parseIdentity(line: string): { name: string; email: string; timestamp: number; timezone: string } {
  const match = line.match(/^(.*?) <(.*?)> (\d+) ([+-]\d{4})$/)
  if (!match || match.length < 5) {
    return { name: "giggle", email: "giggle@local", timestamp: Math.floor(Date.now() / 1000), timezone: "+0000" }
  }
  const name = match[1] || "giggle"
  const email = match[2] || "giggle@local"
  const timestamp = parseInt(match[3] || "0", 10) || Math.floor(Date.now() / 1000)
  const timezone = match[4] || "+0000"
  return {
    name,
    email,
    timestamp,
    timezone,
  }
}

export function writeCommit(giggleDir: string, commit: CommitObject): string {
  const buf = buildCommitBuffer(commit)
  return writeLooseObject(giggleDir, "commit", buf)
}
