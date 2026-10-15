import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { spawnSync } from "node:child_process"
import { initRepository } from "../src/core/repository"
import { commitWorkspace } from "../src/core/staging"
import { loadManifestRules, collectManifestFiles } from "../src/core/manifest"
import { executeSync } from "../src/modules/sync/syncEngine"
import { setRemoteUrl } from "../src/core/remote"
import { countBranchCommits, resolveHead } from "../src/core/counter"

describe("End-to-End Giggle Integration and Git Wire Verification", () => {
  it("passes strict git fsck validation with standard Git engine", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-e2e-"))
    const config = initRepository(tempDir, "main")

    // Create complex directory hierarchy with various file types
    const subDir = path.join(tempDir, ".agents", "skills", "code-skill")
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Master Instructions\nFollow zero assumption\n", "utf8")
    fs.writeFileSync(path.join(subDir, "SKILL.md"), "# Code Skill\nExecutable guidelines\n", "utf8")
    fs.writeFileSync(path.join(tempDir, ".gigglemanifest"), ".agents/**\nAGENTS.md\n", "utf8")

    const rules = loadManifestRules(config.manifestFile)
    const files = collectManifestFiles(tempDir, rules)

    // First commit -> Git commit 1
    const res1 = commitWorkspace(tempDir, config.giggleDir, files)
    expect(res1.message).toBe("Git commit 1")

    // Run strict git fsck on the generated .giggle repository
    const fsckRes1 = spawnSync("git", ["--git-dir", config.giggleDir, "fsck", "--strict"], {
      encoding: "utf8",
    })

    // Strict fsck should succeed with code 0 and no zeroPaddedFilemode errors
    expect(fsckRes1.status).toBe(0)
    expect(fsckRes1.stderr).not.toContain("zeroPaddedFilemode")
    expect(fsckRes1.stderr).not.toContain("treeNotSorted")

    // Modify a file and commit -> Git commit 2
    fs.writeFileSync(path.join(subDir, "SKILL.md"), "# Code Skill Updated\nNew instructions\n", "utf8")
    const res2 = commitWorkspace(tempDir, config.giggleDir, files)
    expect(res2.message).toBe("Git commit 2")

    const fsckRes2 = spawnSync("git", ["--git-dir", config.giggleDir, "fsck", "--strict"], {
      encoding: "utf8",
    })
    expect(fsckRes2.status).toBe(0)

    // Verify commit count matches branch depth
    const head = resolveHead(config.giggleDir)
    expect(countBranchCommits(config.giggleDir, head.commitOid)).toBe(2)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("completes full Flow 1 sync against a local bare Git remote", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-remote-work-"))
    const remoteBareDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-remote-bare-"))

    // Initialize a bare git repository with main as default branch simulating GitHub
    spawnSync("git", ["init", "--bare", "-b", "main", remoteBareDir])

    // Initialize local giggle repo
    const config = initRepository(tempDir, "main")
    setRemoteUrl(config.giggleDir, "origin", remoteBareDir, tempDir)

    // Add files and manifest
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Initial Remote Test\n", "utf8")
    fs.writeFileSync(config.manifestFile, "AGENTS.md\n", "utf8")

    // First sync should auto-commit and push to remote
    const syncRes1 = executeSync(tempDir, config.giggleDir)
    expect(syncRes1.autoCommitted).toBe(true)
    expect(syncRes1.commitMessage).toBe("Git commit 1")
    expect(syncRes1.pushed).toBe(true)

    // Verify bare remote received the commit on branch main
    const remoteLog = spawnSync("git", ["--git-dir", remoteBareDir, "log", "-1", "--format=%s", "main"], {
      encoding: "utf8",
    })
    expect(remoteLog.stdout.trim()).toBe("Git commit 1")

    // Modify file and sync again -> Git commit 2 pushed
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Second Remote Test Edit\n", "utf8")
    const syncRes2 = executeSync(tempDir, config.giggleDir)
    expect(syncRes2.autoCommitted).toBe(true)
    expect(syncRes2.commitMessage).toBe("Git commit 2")
    expect(syncRes2.pushed).toBe(true)

    const remoteLog2 = spawnSync("git", ["--git-dir", remoteBareDir, "log", "-1", "--format=%s", "main"], {
      encoding: "utf8",
    })
    expect(remoteLog2.stdout.trim()).toBe("Git commit 2")

    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(remoteBareDir, { recursive: true, force: true })
  })
})
