import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  formatRuleSummary,
  parseRulesFromText,
  checkMirroredRules,
  addMirroredRule,
  editMirroredRule,
  RulesModule,
} from "../src/modules/rules/rulesModule"
import { createDefaultRegistry } from "../src/modules/registry"

describe("Rules Module and Mirrored Rules Management", () => {
  it("formats rule preview with first 3 words and last 3 words with ellipsis", () => {
    const shortText = "Keep code clean"
    expect(formatRuleSummary(shortText)).toBe('"Keep code clean"')

    const longText = "The user must explicitly request test steps first. Only provide a guided manual verification test when asked."
    const summary = formatRuleSummary(longText)
    expect(summary).toBe('"The user must ... test when asked."')
  })

  it("parses numbered rules and detects boundaries", () => {
    const sample = `---
trigger: always_on
---

1. First rule content here.

2. Second rule with multiple
   lines and explanations.
`
    const { rules, preamble } = parseRulesFromText(sample)
    expect(preamble.includes("trigger: always_on")).toBe(true)
    expect(rules.length).toBe(2)
    expect(rules[0]!.number).toBe(1)
    expect(rules[0]!.content).toBe("First rule content here.")
    expect(rules[1]!.number).toBe(2)
    expect(rules[1]!.content.includes("lines and explanations")).toBe(true)
  })

  it("adds and edits rules across mirrored files successfully", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-rules-test-"))
    const agentRulesDir = path.join(tempDir, ".agents", "rules")
    fs.mkdirSync(agentRulesDir, { recursive: true })

    const sampleContent = `---
trigger: always_on
---

1. Initial test rule content.
`
    const files = [
      path.join(tempDir, "AGENTS.md"),
      path.join(tempDir, "CLAUDE.md"),
      path.join(tempDir, "CODEX.md"),
      path.join(tempDir, "GEMINI.md"),
      path.join(agentRulesDir, "rule.md"),
    ]

    for (const f of files) {
      fs.writeFileSync(f, sampleContent, "utf8")
    }

    // Add rule 2
    const addRes = addMirroredRule("New added rule content for testing", tempDir, false)
    expect(addRes.newRuleNumber).toBe(2)

    for (const f of files) {
      const content = fs.readFileSync(f, "utf8")
      expect(content).toContain("2. New added rule content for testing")
    }

    // Edit rule 2
    const editRes = editMirroredRule(2, "Updated second rule replacement content", tempDir, false)
    expect(editRes.ruleNumber).toBe(2)

    for (const f of files) {
      const content = fs.readFileSync(f, "utf8")
      expect(content).toContain("2. Updated second rule replacement content")
      expect(content).not.toContain("New added rule content for testing")
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("registers modules and exposes check, add, and edit tools dynamically", () => {
    const registry = createDefaultRegistry({ rootDir: process.cwd(), giggleDir: ".giggle" })
    const commands = registry.getAllCliCommands()
    const tools = registry.getAllMcpTools()

    expect(commands.some((c) => c.name === "rules:check")).toBe(true)
    expect(commands.some((c) => c.name === "rules:add")).toBe(true)
    expect(commands.some((c) => c.name === "rules:edit")).toBe(true)

    expect(tools.some((t) => t.name === "giggle_rules_check")).toBe(true)
    expect(tools.some((t) => t.name === "giggle_rules_add")).toBe(true)
    expect(tools.some((t) => t.name === "giggle_rules_edit")).toBe(true)
  })
})
