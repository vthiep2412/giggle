import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  parseSkillFrontmatter,
  listSkills,
  searchSkills,
  syncSkills,
  computeFuzzyScore,
  SkillsModule,
} from "../src/modules/skills/skillsModule"
import { createDefaultRegistry } from "../src/modules/registry"

describe("Skills Module and Pointer Sync", () => {
  it("parses skill frontmatter with name and description", () => {
    const raw = `---
name: sample-skill
description: Useful utility for testing procedures.
---

# Details
Content here.
`
    const info = parseSkillFrontmatter(raw, "C:/mock/sample-skill/SKILL.md")
    expect(info.name).toBe("sample-skill")
    expect(info.description).toBe("Useful utility for testing procedures.")
    expect(info.autoRead).toBe(true)
  })

  it("handles multiline description with yaml block scalar", () => {
    const raw = `---
name: multi-line-skill
description: >-
  First line of description
  second line of description
---
`
    const info = parseSkillFrontmatter(raw, "C:/mock/multi-line-skill/SKILL.md")
    expect(info.name).toBe("multi-line-skill")
    expect(info.description).toBe("First line of description second line of description")
    expect(info.autoRead).toBe(true)
  })

  it("respects auto_read and no_auto_read flags", () => {
    const falseAutoRead = `---
name: manual-skill
description: Run manually.
auto_read: false
---
`
    const info1 = parseSkillFrontmatter(falseAutoRead, "C:/mock/manual-skill/SKILL.md")
    expect(info1.autoRead).toBe(false)

    const trueNoAutoRead = `---
name: manual-caveman
description: Caveman mode.
no_auto_read: true
---
`
    const info2 = parseSkillFrontmatter(trueNoAutoRead, "C:/mock/manual-caveman/SKILL.md")
    expect(info2.autoRead).toBe(false)

    const falseNoAutoRead = `---
name: active-skill
description: Active rule.
no_auto_read: false
---
`
    const info3 = parseSkillFrontmatter(falseNoAutoRead, "C:/mock/active-skill/SKILL.md")
    expect(info3.autoRead).toBe(true)
  })

  it("computes fuzzy match scores correctly", () => {
    const scoreExact = computeFuzzyScore("commit", "commit")
    expect(scoreExact).toBe(1000)

    const scoreSub = computeFuzzyScore("cmmt", "commit")
    expect(scoreSub).toBeGreaterThan(0)

    const scoreNone = computeFuzzyScore("zzzz", "commit")
    expect(scoreNone).toBe(0)
  })

  it("lists skills filtering non-auto-read by default and revealing with force", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-test-"))
    const skillsDir = path.join(tempDir, ".agents", "skills")
    fs.mkdirSync(skillsDir, { recursive: true })

    const skill1Dir = path.join(skillsDir, "git-helper")
    fs.mkdirSync(skill1Dir, { recursive: true })
    fs.writeFileSync(
      path.join(skill1Dir, "SKILL.md"),
      `---\nname: git-helper\ndescription: Helper for git commits and branch rebases.\n---\n`,
      "utf8"
    )

    const skill2Dir = path.join(skillsDir, "caveman")
    fs.mkdirSync(skill2Dir, { recursive: true })
    fs.writeFileSync(
      path.join(skill2Dir, "SKILL.md"),
      `---\nname: caveman\ndescription: Ultra-compressed terseness.\nauto_read: false\n---\n`,
      "utf8"
    )

    // Default: only auto-read skills (hides caveman)
    const defaultList = listSkills(tempDir, false)
    expect(defaultList.length).toBe(1)
    expect(defaultList[0]!.name).toBe("git-helper")

    // Force: includes non-auto-read skills
    const forcedList = listSkills(tempDir, true)
    expect(forcedList.length).toBe(2)
    expect(forcedList.map((s) => s.name)).toEqual(["caveman", "git-helper"])

    // Fuzzy search
    const searchFuzzy = searchSkills("gthelpr", tempDir, false)
    expect(searchFuzzy.length).toBe(1)
    expect(searchFuzzy[0]!.name).toBe("git-helper")
  })

  it("synchronizes skills as path-only pointer files with warnings for manual skills", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-src-"))
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-target-"))

    const skillsDir = path.join(tempDir, ".agents", "skills")
    const skill1Dir = path.join(skillsDir, "deployer")
    const scriptsDir = path.join(skill1Dir, "scripts")
    fs.mkdirSync(scriptsDir, { recursive: true })

    const realSkillFile1 = path.join(skill1Dir, "SKILL.md")
    fs.writeFileSync(
      realSkillFile1,
      `---\nname: deployer\ndescription: Cloud deployment pipeline.\n---\n\n# Real Large Documentation\n1000 lines of guides...`,
      "utf8"
    )

    const realScriptFile = path.join(scriptsDir, "deploy.sh")
    fs.writeFileSync(realScriptFile, `echo "running heavy deploy..."`, "utf8")

    // Add repo root junk files that should never be synced
    fs.writeFileSync(path.join(skill1Dir, "package.json"), "{}", "utf8")
    fs.writeFileSync(path.join(skill1Dir, "bun.lock"), "lock", "utf8")

    const skill2Dir = path.join(skillsDir, "manual-review")
    fs.mkdirSync(skill2Dir, { recursive: true })
    const realSkillFile2 = path.join(skill2Dir, "SKILL.md")
    fs.writeFileSync(
      realSkillFile2,
      `---\nname: manual-review\ndescription: Manual review gate.\nauto_read: false\n---\n`,
      "utf8"
    )

    const res = syncSkills(tempDir, targetDir)
    expect(res.syncedCount).toBe(2)

    const syncedSkill1Path = path.join(targetDir, "deployer", "SKILL.md")
    const syncedScriptPath = path.join(targetDir, "deployer", "scripts", "deploy.sh")
    const syncedSkill2Path = path.join(targetDir, "manual-review", "SKILL.md")

    expect(fs.existsSync(syncedSkill1Path)).toBe(true)
    expect(fs.existsSync(syncedScriptPath)).toBe(true)
    expect(fs.existsSync(syncedSkill2Path)).toBe(true)

    // Verify repo-level root junk files were excluded
    expect(fs.existsSync(path.join(targetDir, "deployer", "package.json"))).toBe(false)
    expect(fs.existsSync(path.join(targetDir, "deployer", "bun.lock"))).toBe(false)

    // Standard skill: no warning
    const skill1Content = fs.readFileSync(syncedSkill1Path, "utf8")
    expect(skill1Content.includes("name: deployer")).toBe(true)
    expect(skill1Content.includes("1000 lines of guides")).toBe(false)
    expect(skill1Content.includes("> Warning: Ignore this skill")).toBe(false)
    expect(skill1Content.includes(`file:///${realSkillFile1.replace(/\\/g, "/")}`)).toBe(true)

    // Manual skill: contains warning blockquote without auto_read tag in frontmatter
    const skill2Content = fs.readFileSync(syncedSkill2Path, "utf8")
    expect(skill2Content.includes("name: manual-review")).toBe(true)
    expect(skill2Content.includes("auto_read: false")).toBe(false)
    expect(skill2Content.includes("> Warning: Ignore this skill unless explicitly requested by the user.")).toBe(true)
    expect(skill2Content.includes(`file:///${realSkillFile2.replace(/\\/g, "/")}`)).toBe(true)
  })

  it("exposes MCP tools with force parameter dynamically", () => {
    const registry = createDefaultRegistry()
    const tools = registry.getAllMcpTools()

    const listTool = tools.find((t) => t.name === "giggle_skill_list")
    const searchTool = tools.find((t) => t.name === "giggle_skill_search")
    const syncTool = tools.find((t) => t.name === "giggle_skill_sync")

    expect(listTool).toBeDefined()
    expect(listTool?.parameters.properties.force).toBeDefined()
    expect(searchTool).toBeDefined()
    expect(syncTool).toBeDefined()
  })

  it("returns compact plain text skill list without json overhead or rawContent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-mcp-"))
    const skillsDir = path.join(tempDir, ".agents", "skills", "test-compact")
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      `---\nname: test-compact\ndescription: Compact description.\n---\n# Raw documentation body\nShould not appear in MCP list.`,
      "utf8"
    )

    const module = new SkillsModule()
    module.initialize({ rootDir: tempDir } as any)
    const mcpTools = module.getMcpTools()
    const listTool = mcpTools.find((t) => t.name === "giggle_skill_list")!

    const result = await listTool.execute({ workspaceRoot: tempDir })
    expect(typeof result).toBe("string")
    expect(result.includes("Total: 1 skills")).toBe(true)
    expect(result.includes("- test-compact")).toBe(true)
    expect(result.includes("Description: Compact description.")).toBe(true)
    expect(result.includes("Path:")).toBe(true)
    expect(result.includes("Raw documentation body")).toBe(false)
  })

  it("syncs skills as full workflow markdown files when workflow mode is enabled and overwrites existing files", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-wf-src-"))
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-wf-target-"))

    const skillsDir = path.join(tempDir, ".agents", "skills")
    const skillDir = path.join(skillsDir, "coderabbit")
    fs.mkdirSync(skillDir, { recursive: true })

    const skillContent = `---\nname: coderabbit\ndescription: Anti Slop: Rules for AI Coding Agents.\n---\n\n# CodeRabbit Guide\nPerform strict review triage.`
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent, "utf8")

    // Pre-create existing file to test overwrite
    const targetFile = path.join(targetDir, "coderabbit.md")
    fs.writeFileSync(targetFile, "old outdated content", "utf8")

    const res = syncSkills(tempDir, targetDir, true)
    expect(res.syncedCount).toBe(1)
    expect(res.syncedFiles.length).toBe(1)
    expect(res.syncedFiles[0]).toBe(targetFile)

    const updatedContent = fs.readFileSync(targetFile, "utf8")
    expect(updatedContent.includes("name: coderabbit")).toBe(true)
    // Verify colon-containing description is safely double-quoted
    expect(updatedContent.includes('description: "Anti Slop: Rules for AI Coding Agents."')).toBe(true)
    expect(updatedContent.includes("file:///")).toBe(true)
    expect(updatedContent.includes("Perform strict review triage.")).toBe(false)

    // Test MCP tool execution with workflow flag
    const module = new SkillsModule()
    module.initialize({ rootDir: tempDir } as any)
    const mcpTools = module.getMcpTools()
    const syncTool = mcpTools.find((t) => t.name === "giggle_skill_sync")!

    expect(syncTool.parameters.properties.workflow).toBeDefined()
    const mcpRes = await syncTool.execute({
      workspaceRoot: tempDir,
      targetDir,
      workflow: true,
    })
    expect(typeof mcpRes).toBe("string")
    expect(mcpRes.includes("workflow markdown files")).toBe(true)
  })

  it("discovers nested subskills and prefixes subskill names with parent folder", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-nested-src-"))
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-nested-target-"))
    const skillsDir = path.join(tempDir, ".agents", "skills")

    // Top-level skill
    const topSkillDir = path.join(skillsDir, "coderabbit")
    fs.mkdirSync(topSkillDir, { recursive: true })
    fs.writeFileSync(
      path.join(topSkillDir, "SKILL.md"),
      `---\nname: coderabbit\ndescription: CodeRabbit reviewer.\n---\n`,
      "utf8"
    )

    // Parent suite router skill
    const parentDir = path.join(skillsDir, "gstack")
    fs.mkdirSync(parentDir, { recursive: true })
    fs.writeFileSync(
      path.join(parentDir, "SKILL.md"),
      `---\nname: gstack\ndescription: Gstack router.\n---\n`,
      "utf8"
    )

    // Nested subskill without prefix
    const subSkill1Dir = path.join(parentDir, "autoplan")
    fs.mkdirSync(subSkill1Dir, { recursive: true })
    fs.writeFileSync(
      path.join(subSkill1Dir, "SKILL.md"),
      `---\nname: autoplan\ndescription: Automated plan review.\n---\n`,
      "utf8"
    )

    // Nested subskill already having prefix
    const subSkill2Dir = path.join(parentDir, "gstack-upgrade")
    fs.mkdirSync(subSkill2Dir, { recursive: true })
    fs.writeFileSync(
      path.join(subSkill2Dir, "SKILL.md"),
      `---\nname: gstack-upgrade\ndescription: Upgrade gstack dependencies.\n---\n`,
      "utf8"
    )

    // Edge case: parent folder is caveman and subskill is caveman/caveman/SKILL.md
    const cavemanParentDir = path.join(skillsDir, "caveman")
    const cavemanSubDir = path.join(cavemanParentDir, "caveman")
    fs.mkdirSync(cavemanSubDir, { recursive: true })
    fs.writeFileSync(
      path.join(cavemanSubDir, "SKILL.md"),
      `---\nname: caveman\ndescription: Caveman mode.\n---\n`,
      "utf8"
    )

    const discovered = listSkills(tempDir, false)
    expect(discovered.length).toBe(5)
    expect(discovered.map((s) => s.name)).toEqual([
      "caveman",
      "coderabbit",
      "gstack",
      "gstack-autoplan",
      "gstack-upgrade",
    ])

    // Test pointer sync
    const pointerRes = syncSkills(tempDir, targetDir, false)
    expect(pointerRes.syncedCount).toBe(5)
    expect(fs.existsSync(path.join(targetDir, "caveman", "SKILL.md"))).toBe(true)
    expect(fs.existsSync(path.join(targetDir, "caveman-caveman", "SKILL.md"))).toBe(false)
    expect(fs.existsSync(path.join(targetDir, "gstack-autoplan", "SKILL.md"))).toBe(true)
    expect(fs.existsSync(path.join(targetDir, "gstack-upgrade", "SKILL.md"))).toBe(true)
    expect(fs.existsSync(path.join(targetDir, "coderabbit", "SKILL.md"))).toBe(true)

    // Test workflow sync
    const wfTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-nested-wf-"))
    const wfRes = syncSkills(tempDir, wfTargetDir, true)
    expect(wfRes.syncedCount).toBe(5)
    expect(fs.existsSync(path.join(wfTargetDir, "caveman.md"))).toBe(true)
    expect(fs.existsSync(path.join(wfTargetDir, "caveman-caveman.md"))).toBe(false)
    expect(fs.existsSync(path.join(wfTargetDir, "gstack-autoplan.md"))).toBe(true)
    expect(fs.existsSync(path.join(wfTargetDir, "gstack-upgrade.md"))).toBe(true)
    expect(fs.existsSync(path.join(wfTargetDir, "coderabbit.md"))).toBe(true)
  })
})
