import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { initRepository } from "../src/core/repository"
import { parseManifest, isTrackedByManifest, collectManifestFiles } from "../src/core/manifest"
import { diffWorkingTree } from "../src/core/workingtree"
import { commitWorkspace } from "../src/core/staging"
import { resolveHead } from "../src/core/counter"

describe("Manifest and Staging", () => {
  it("parses manifest patterns and filters tracked files", () => {
    const raw = `
# Global preset rules
.agents/**
!*.tmp
AGENTS.md
`
    const rules = parseManifest(raw)
    expect(rules.length).toBe(3)
    expect(isTrackedByManifest(".agents/rules/rule1.md", rules)).toBe(true)
    expect(isTrackedByManifest(".agents/temp.tmp", rules)).toBe(false)
    expect(isTrackedByManifest("AGENTS.md", rules)).toBe(true)
    expect(isTrackedByManifest("random.js", rules)).toBe(false)
  })

  it("stages workspace files and tracks diffs across commits", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-staging-"))
    const config = initRepository(tempDir, "main")

    // Create some nested preset files
    const ruleDir = path.join(tempDir, ".agents", "rules")
    fs.mkdirSync(ruleDir, { recursive: true })
    fs.writeFileSync(path.join(ruleDir, "general.md"), "Keep responses concise", "utf8")
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "Workspace instructions", "utf8")

    // Write manifest tracking these files
    fs.writeFileSync(config.manifestFile, ".agents/**\nAGENTS.md\n", "utf8")

    const rules = parseManifest(fs.readFileSync(config.manifestFile, "utf8"))
    const files = collectManifestFiles(tempDir, rules)
    expect(files).toContain(".agents/rules/general.md")
    expect(files).toContain("AGENTS.md")
    expect(files).toContain(".gigglemanifest")

    // Check initial diff
    const initialDiff = diffWorkingTree(tempDir, config.giggleDir, files)
    expect(initialDiff.filter((d) => d.status === "added").length).toBe(3)

    // Execute first commit
    const result1 = commitWorkspace(tempDir, config.giggleDir, files)
    expect(result1.message).toBe("Git commit 1")
    expect(result1.commitOid.length).toBe(40)

    // Diff after commit should show all unmodified
    const postCommitDiff = diffWorkingTree(tempDir, config.giggleDir, files)
    expect(postCommitDiff.every((d) => d.status === "unmodified")).toBe(true)

    // Modify a file
    fs.writeFileSync(path.join(ruleDir, "general.md"), "Updated rules content", "utf8")
    const modifiedDiff = diffWorkingTree(tempDir, config.giggleDir, files)
    const generalStatus = modifiedDiff.find((d) => d.path === ".agents/rules/general.md")
    expect(generalStatus?.status).toBe("modified")

    // Execute second commit
    const result2 = commitWorkspace(tempDir, config.giggleDir, files)
    expect(result2.message).toBe("Git commit 2")

    const head = resolveHead(config.giggleDir)
    expect(head.commitOid).toBe(result2.commitOid)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
