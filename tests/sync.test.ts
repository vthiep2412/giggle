import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { initRepository } from "../src/core/repository"
import { executeSync } from "../src/modules/sync/syncEngine"
import { resolveHead } from "../src/core/counter"

describe("Sync Engine", () => {
  it("auto-commits uncommitted preset files and advances the counter without a push step", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-sync-"))
    const config = initRepository(tempDir, "main")

    // Setup tracked rule file
    const agentsDir = path.join(tempDir, ".agents")
    fs.mkdirSync(agentsDir, { recursive: true })
    fs.writeFileSync(path.join(agentsDir, "test-rule.md"), "Initial rule content", "utf8")
    fs.writeFileSync(config.manifestFile, ".agents/**\n", "utf8")

    // First sync: uncommitted changes exist
    const res1 = executeSync(tempDir, config.giggleDir)
    expect(res1.autoCommitted).toBe(true)
    expect(res1.commitMessage).toBe("Git commit 1")
    expect(res1.commitOid).toBeDefined()

    const head1 = resolveHead(config.giggleDir)
    expect(head1.commitOid).toBe(res1.commitOid || null)

    // Second sync immediately after: clean state, no auto-commit
    const res2 = executeSync(tempDir, config.giggleDir)
    expect(res2.autoCommitted).toBe(false)
    expect(res2.commitMessage).toBeUndefined()

    // Modify the rule file
    fs.writeFileSync(path.join(agentsDir, "test-rule.md"), "Modified rule content", "utf8")

    // Third sync: should trigger Git commit 2
    const res3 = executeSync(tempDir, config.giggleDir)
    expect(res3.autoCommitted).toBe(true)
    expect(res3.commitMessage).toBe("Git commit 2")

    const head3 = resolveHead(config.giggleDir)
    expect(head3.commitOid).toBe(res3.commitOid || null)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
