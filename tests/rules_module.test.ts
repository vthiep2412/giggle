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
  deleteMirroredRule,
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
    expect(commands.some((c) => c.name === "rules:delete")).toBe(true)

    expect(tools.some((t) => t.name === "giggle_rules_check")).toBe(true)
    expect(tools.some((t) => t.name === "giggle_rules_add")).toBe(true)
    expect(tools.some((t) => t.name === "giggle_rules_edit")).toBe(true)
    expect(tools.some((t) => t.name === "giggle_rules_delete")).toBe(true)
  })

  it("returns plain text audit and targeted rule sync verification in MCP tools", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-rules-mcp-"))
    const agentRulesDir = path.join(tempDir, ".agents", "rules")
    fs.mkdirSync(agentRulesDir, { recursive: true })

    const rule1Text = "1. First rule statement for testing."
    const rule2Text = "2. Second rule statement with details."
    const initialContent = `${rule1Text}\n\n${rule2Text}\n`

    const files = [
      path.join(tempDir, "AGENTS.md"),
      path.join(tempDir, "CLAUDE.md"),
      path.join(tempDir, "CODEX.md"),
      path.join(tempDir, "GEMINI.md"),
      path.join(agentRulesDir, "rule.md"),
    ]
    for (const f of files) {
      fs.writeFileSync(f, initialContent, "utf8")
    }

    const module = new RulesModule()
    module.initialize({ rootDir: tempDir } as any)
    const mcpTools = module.getMcpTools()
    const checkTool = mcpTools.find((t) => t.name === "giggle_rules_check")!
    const addTool = mcpTools.find((t) => t.name === "giggle_rules_add")!
    const editTool = mcpTools.find((t) => t.name === "giggle_rules_edit")!

    // Default audit: returns plain text summary
    const defaultRes = await checkTool.execute({ workspaceRoot: tempDir, includeGlobal: false })
    expect(typeof defaultRes).toBe("string")
    expect(defaultRes.includes("mirrored rule files")).toBe(true)
    expect(defaultRes.includes("Rule 1:")).toBe(true)
    expect(defaultRes.includes("Rule 2:")).toBe(true)

    // Targeted rule check: returns sync state across all files and full content
    const targetedRes = await checkTool.execute({ workspaceRoot: tempDir, ruleNumber: 1, includeGlobal: false })
    expect(typeof targetedRes).toBe("string")
    expect(targetedRes.includes("Rule 1 (Synchronized across all")).toBe(true)
    expect(targetedRes.includes("First rule statement for testing.")).toBe(true)

    // Add rule
    const addRes = await addTool.execute({
      workspaceRoot: tempDir,
      ruleText: "Third rule added through MCP.",
      includeGlobal: false,
    })
    expect(typeof addRes).toBe("string")
    expect(addRes.includes("Added Rule 3:")).toBe(true)
    expect(addRes.includes("Updated")).toBe(true)

    // Edit rule
    const editRes = await editTool.execute({
      workspaceRoot: tempDir,
      ruleNumber: 2,
      newRuleText: "Updated second rule through MCP.",
      includeGlobal: false,
    })
    expect(typeof editRes).toBe("string")
    expect(editRes.includes("Updated Rule 2:")).toBe(true)
    expect(editRes.includes("Updated")).toBe(true)

    // Delete rule with guardrail: unconfirmed call returns dry run preview
    const deleteTool = mcpTools.find((t) => t.name === "giggle_rules_delete")!
    const dryRunRes = await deleteTool.execute({
      workspaceRoot: tempDir,
      ruleNumber: 2,
      includeGlobal: false,
    })
    expect(typeof dryRunRes).toBe("string")
    expect(dryRunRes.includes("[PREVIEW - Dry Run]")).toBe(true)
    expect(dryRunRes.includes("confirm: true")).toBe(true)

    // Verify files still have rule 2
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).toContain("2. Updated second rule through MCP.")
    }

    // Delete rule with confirmation
    const confirmedRes = await deleteTool.execute({
      workspaceRoot: tempDir,
      ruleNumber: 2,
      confirm: true,
      includeGlobal: false,
    })
    expect(typeof confirmedRes).toBe("string")
    expect(confirmedRes.includes("Deleted Rule 2:")).toBe(true)
    expect(confirmedRes.includes("Renumbered 1 subsequent rules")).toBe(true)

    // Verify rule 3 was renumbered to rule 2 and rule 2 content is gone
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8")
      expect(content).not.toContain("Updated second rule through MCP.")
      expect(content).toContain("2. Third rule added through MCP.")
      expect(content).not.toContain("3. Third rule added through MCP.")
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("deletes a rule and automatically renumbers subsequent rules across mirrored files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-rules-delete-"))
    const agentRulesDir = path.join(tempDir, ".agents", "rules")
    fs.mkdirSync(agentRulesDir, { recursive: true })

    const initialContent = [
      "1. First rule statement.",
      "",
      "2. Second rule to be deleted.",
      "",
      "3. Third rule statement.",
      "",
      "4. Fourth rule statement.",
      "",
    ].join("\n")

    const files = [
      path.join(tempDir, "AGENTS.md"),
      path.join(tempDir, "CLAUDE.md"),
      path.join(tempDir, "CODEX.md"),
      path.join(tempDir, "GEMINI.md"),
      path.join(agentRulesDir, "rule.md"),
    ]

    for (const f of files) {
      fs.writeFileSync(f, initialContent, "utf8")
    }

    // Delete rule 2
    const delRes = deleteMirroredRule(2, tempDir, false)
    expect(delRes.ruleNumber).toBe(2)
    expect(delRes.shiftedCount).toBe(2)
    expect(delRes.deletedSummary).toBe('"Second rule to be deleted."')

    // Verify all files have rules 1, 2, 3 where 3 and 4 were renumbered
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8")
      const parsed = parseRulesFromText(content)
      expect(parsed.rules.length).toBe(3)
      expect(parsed.rules[0]?.number).toBe(1)
      expect(parsed.rules[0]?.content).toBe("First rule statement.")
      expect(parsed.rules[1]?.number).toBe(2)
      expect(parsed.rules[1]?.content).toBe("Third rule statement.")
      expect(parsed.rules[2]?.number).toBe(3)
      expect(parsed.rules[2]?.content).toBe("Fourth rule statement.")
    }

    // Error on non-existent rule
    expect(() => deleteMirroredRule(99, tempDir, false)).toThrow("Rule 99 not found")

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
