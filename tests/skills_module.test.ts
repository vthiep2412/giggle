import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  parseSkillFrontmatter,
  listSkills,
  searchSkills,
  syncSkills,
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

  it("lists and searches skills in workspace directory", () => {
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

    const listed = listSkills(tempDir)
    expect(listed.length).toBe(2)
    expect(listed[0]!.name).toBe("caveman")
    expect(listed[0]!.autoRead).toBe(false)
    expect(listed[1]!.name).toBe("git-helper")
    expect(listed[1]!.autoRead).toBe(true)

    const searchBranch = searchSkills("branch", tempDir)
    expect(searchBranch.length).toBe(1)
    expect(searchBranch[0]!.name).toBe("git-helper")

    const searchCaveman = searchSkills("caveman", tempDir)
    expect(searchCaveman.length).toBe(1)
    expect(searchCaveman[0]!.name).toBe("caveman")
  })

  it("synchronizes skills as path-only pointer files without copying raw contents", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-src-"))
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-skills-target-"))

    const skillsDir = path.join(tempDir, ".agents", "skills")
    const skillDir = path.join(skillsDir, "deployer")
    const scriptsDir = path.join(skillDir, "scripts")
    fs.mkdirSync(scriptsDir, { recursive: true })

    const realSkillFile = path.join(skillDir, "SKILL.md")
    fs.writeFileSync(
      realSkillFile,
      `---\nname: deployer\ndescription: Cloud deployment pipeline.\n---\n\n# Real Large Documentation\n1000 lines of guides...`,
      "utf8"
    )

    const realScriptFile = path.join(scriptsDir, "deploy.sh")
    fs.writeFileSync(realScriptFile, `echo "running heavy deploy..."`, "utf8")

    const res = syncSkills(tempDir, targetDir)
    expect(res.syncedCount).toBe(1)
    expect(res.syncedFiles.length).toBe(2)

    const syncedSkillPath = path.join(targetDir, "deployer", "SKILL.md")
    const syncedScriptPath = path.join(targetDir, "deployer", "scripts", "deploy.sh")

    expect(fs.existsSync(syncedSkillPath)).toBe(true)
    expect(fs.existsSync(syncedScriptPath)).toBe(true)

    const skillContent = fs.readFileSync(syncedSkillPath, "utf8")
    expect(skillContent.includes("name: deployer")).toBe(true)
    expect(skillContent.includes("description: Cloud deployment pipeline.")).toBe(true)
    expect(skillContent.includes("1000 lines of guides")).toBe(false)
    expect(skillContent.includes(`file:///${realSkillFile.replace(/\\/g, "/")}`)).toBe(true)

    const scriptContent = fs.readFileSync(syncedScriptPath, "utf8")
    expect(scriptContent.includes("running heavy deploy")).toBe(false)
    expect(scriptContent.trim()).toBe(`file:///${realScriptFile.replace(/\\/g, "/")}`)
  })

  it("exposes MCP tools in registry dynamically", () => {
    const registry = createDefaultRegistry()
    const tools = registry.getAllMcpTools()

    const listTool = tools.find((t) => t.name === "giggle_skill_list")
    const searchTool = tools.find((t) => t.name === "giggle_skill_search")
    const syncTool = tools.find((t) => t.name === "giggle_skill_sync")

    expect(listTool).toBeDefined()
    expect(searchTool).toBeDefined()
    expect(syncTool).toBeDefined()
  })
})
