import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { initRepository, updateRef } from "../src/core/repository"
import { writeBlob, writeTree, writeCommit } from "../src/core/objects"
import { resolveHead, countBranchCommits, generateAutoCommitMessage } from "../src/core/counter"

describe("Repository and Commit Counter", () => {
  it("initializes an isolated repository structure without .git conflicts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-test-"))
    const config = initRepository(tempDir, "main")

    expect(fs.existsSync(config.giggleDir)).toBe(true)
    expect(fs.existsSync(path.join(config.giggleDir, "HEAD"))).toBe(true)
    expect(fs.existsSync(config.manifestFile)).toBe(true)

    const exclude = fs.readFileSync(path.join(config.giggleDir, "info", "exclude"), "utf8")
    expect(exclude.includes("**/.git")).toBe(true)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("calculates dynamic commit counts correctly", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-counter-"))
    const config = initRepository(tempDir, "main")

    // Empty repo: 0 commits -> Git commit 1
    const initialHead = resolveHead(config.giggleDir)
    expect(initialHead.commitOid).toBeNull()
    expect(generateAutoCommitMessage(config.giggleDir)).toBe("Git commit 1")

    // Create commit 1
    const blob1 = writeBlob(config.giggleDir, Buffer.from("hello rules"))
    const tree1 = writeTree(config.giggleDir, [{ mode: "100644", name: "rule.md", oid: blob1, type: "blob" }])
    const commit1 = writeCommit(config.giggleDir, {
      tree: tree1,
      parents: [],
      author: { name: "test", email: "test@local", timestamp: 1000, timezone: "+0000" },
      committer: { name: "test", email: "test@local", timestamp: 1000, timezone: "+0000" },
      message: "Git commit 1",
    })
    updateRef(config.giggleDir, "refs/heads/main", commit1)

    // Now 1 commit -> next message Git commit 2
    expect(countBranchCommits(config.giggleDir, commit1)).toBe(1)
    expect(generateAutoCommitMessage(config.giggleDir)).toBe("Git commit 2")

    // Create commit 2
    const blob2 = writeBlob(config.giggleDir, Buffer.from("hello skills"))
    const tree2 = writeTree(config.giggleDir, [
      { mode: "100644", name: "rule.md", oid: blob1, type: "blob" },
      { mode: "100644", name: "skill.md", oid: blob2, type: "blob" },
    ])
    const commit2 = writeCommit(config.giggleDir, {
      tree: tree2,
      parents: [commit1],
      author: { name: "test", email: "test@local", timestamp: 2000, timezone: "+0000" },
      committer: { name: "test", email: "test@local", timestamp: 2000, timezone: "+0000" },
      message: "Git commit 2",
    })
    updateRef(config.giggleDir, "refs/heads/main", commit2)

    // Now 2 commits -> next message Git commit 3
    expect(countBranchCommits(config.giggleDir, commit2)).toBe(2)
    expect(generateAutoCommitMessage(config.giggleDir)).toBe("Git commit 3")

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
