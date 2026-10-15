import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import type { GiggleModule, GiggleModuleContext, CliCommand, McpToolDefinition } from "../base"

export interface ParsedRule {
  number: number
  raw: string
  content: string
  startIndex: number
  endIndex: number
}

export interface RuleFileAudit {
  file: string
  exists: boolean
  writable: boolean
  totalRules: number
  rules: { number: number; summary: string }[]
}

export interface RulesCheckResult {
  synchronized: boolean
  totalRules: number
  files: RuleFileAudit[]
  ruleSummaries: { number: number; summary: string }[]
  driftDetails?: string[]
}

export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir)
  while (true) {
    if (
      fs.existsSync(path.join(current, "AGENTS.md")) ||
      fs.existsSync(path.join(current, ".gigglemanifest")) ||
      fs.existsSync(path.join(current, ".giggle"))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return path.resolve(startDir)
}

export function getMirroredRulePaths(
  workspaceRoot?: string,
  includeGlobalGemini: boolean = true
): string[] {
  const root = workspaceRoot && fs.existsSync(path.join(workspaceRoot, "AGENTS.md"))
    ? path.resolve(workspaceRoot)
    : findWorkspaceRoot(workspaceRoot || process.cwd())

  const paths = [
    path.join(root, "AGENTS.md"),
    path.join(root, "CLAUDE.md"),
    path.join(root, "CODEX.md"),
    path.join(root, "GEMINI.md"),
    path.join(root, ".agents", "rules", "rule.md"),
  ]
  if (includeGlobalGemini) {
    paths.push(path.join(os.homedir(), ".gemini", "GEMINI.md"))
  }
  return paths
}

export function parseRulesFromText(text: string): { preamble: string; rules: ParsedRule[] } {
  const ruleRegex = /(?:^|\n)(\d+)\.\s+/g
  const matches: { number: number; index: number; matchLength: number }[] = []

  let m: RegExpExecArray | null
  while ((m = ruleRegex.exec(text)) !== null) {
    const isNewlineMatch = m[0].startsWith("\n")
    const index = isNewlineMatch ? m.index + 1 : m.index
    const matchLength = isNewlineMatch ? m[0].length - 1 : m[0].length
    const numStr = m[1] || "0"
    matches.push({
      number: parseInt(numStr, 10),
      index,
      matchLength,
    })
  }

  const rules: ParsedRule[] = []
  const firstMatch = matches[0]
  const preamble = firstMatch ? text.slice(0, firstMatch.index) : text

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]
    if (!current) continue
    const nextMatch = matches[i + 1]
    const nextIndex = nextMatch ? nextMatch.index : text.length
    const raw = text.slice(current.index, nextIndex)
    const content = raw.slice(current.matchLength).trim()
    rules.push({
      number: current.number,
      raw,
      content,
      startIndex: current.index,
      endIndex: nextIndex,
    })
  }

  return { preamble, rules }
}

export function formatRuleSummary(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim()
  const words = clean.split(" ").filter((w) => w.length > 0)
  if (words.length <= 6) {
    return `"${words.join(" ")}"`
  }
  const firstThree = words.slice(0, 3).join(" ")
  const lastThree = words.slice(-3).join(" ")
  return `"${firstThree} ... ${lastThree}"`
}

export function checkMirroredRules(
  workspaceRoot: string = process.cwd(),
  includeGlobalGemini: boolean = true
): RulesCheckResult {
  const targetFiles = getMirroredRulePaths(workspaceRoot, includeGlobalGemini)
  const fileAudits: RuleFileAudit[] = []
  let canonicalRules: { number: number; summary: string }[] = []
  const driftDetails: string[] = []

  for (const file of targetFiles) {
    const exists = fs.existsSync(file)
    let writable = false
    let totalRules = 0
    const ruleSummaries: { number: number; summary: string }[] = []

    if (exists) {
      try {
        fs.accessSync(file, fs.constants.W_OK)
        writable = true
      } catch {
        writable = false
      }

      const content = fs.readFileSync(file, "utf8")
      const parsed = parseRulesFromText(content)
      totalRules = parsed.rules.length

      for (const r of parsed.rules) {
        ruleSummaries.push({
          number: r.number,
          summary: formatRuleSummary(r.content),
        })
      }

      if (canonicalRules.length === 0 && ruleSummaries.length > 0) {
        canonicalRules = ruleSummaries
      }
    } else {
      driftDetails.push(`File missing: ${file}`)
    }

    fileAudits.push({
      file,
      exists,
      writable,
      totalRules,
      rules: ruleSummaries,
    })
  }

  // Verify synchronization across all files
  let synchronized = fileAudits.every((f) => f.exists && f.totalRules === canonicalRules.length)
  if (synchronized) {
    for (const audit of fileAudits) {
      for (let i = 0; i < canonicalRules.length; i++) {
        const canonical = canonicalRules[i]
        const actual = audit.rules[i]
        if (!canonical || !actual || canonical.summary !== actual.summary) {
          synchronized = false
          driftDetails.push(`Rule content drift in ${audit.file} at rule ${canonical?.number}`)
          break
        }
      }
    }
  }

  return {
    synchronized,
    totalRules: canonicalRules.length,
    files: fileAudits,
    ruleSummaries: canonicalRules,
    driftDetails: driftDetails.length > 0 ? driftDetails : undefined,
  }
}

export function addMirroredRule(
  newRuleText: string,
  workspaceRoot: string = process.cwd(),
  includeGlobalGemini: boolean = true
): { newRuleNumber: number; summary: string; updatedFiles: string[] } {
  const targetFiles = getMirroredRulePaths(workspaceRoot, includeGlobalGemini)
  const cleanInput = newRuleText.replace(/^\s*\d+\.\s+/, "").trim()
  if (!cleanInput) {
    throw new Error("Rule text cannot be empty")
  }

  const check = checkMirroredRules(workspaceRoot, includeGlobalGemini)
  const nextNumber = check.totalRules + 1
  const ruleToAppend = `${nextNumber}. ${cleanInput}`
  const summary = formatRuleSummary(cleanInput)

  const updatedFiles: string[] = []

  for (const file of targetFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Cannot add rule, target file missing: ${file}`)
    }

    const content = fs.readFileSync(file, "utf8")
    const separator = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n"
    const newContent = `${content}${separator}${ruleToAppend}\n`

    fs.writeFileSync(file, newContent, "utf8")
    updatedFiles.push(file)
  }

  return {
    newRuleNumber: nextNumber,
    summary,
    updatedFiles,
  }
}

export function editMirroredRule(
  ruleNumber: number,
  newRuleText: string,
  workspaceRoot: string = process.cwd(),
  includeGlobalGemini: boolean = true
): { ruleNumber: number; oldSummary: string; newSummary: string; updatedFiles: string[] } {
  const targetFiles = getMirroredRulePaths(workspaceRoot, includeGlobalGemini)
  const cleanInput = newRuleText.replace(/^\s*\d+\.\s+/, "").trim()
  if (!cleanInput) {
    throw new Error("Rule text cannot be empty")
  }

  const updatedFiles: string[] = []
  let oldSummary = ""
  const newSummary = formatRuleSummary(cleanInput)

  // Verify all files have this rule first
  for (const file of targetFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Target rule file missing: ${file}`)
    }

    const content = fs.readFileSync(file, "utf8")
    const parsed = parseRulesFromText(content)
    const targetRule = parsed.rules.find((r) => r.number === ruleNumber)

    if (!targetRule) {
      throw new Error(`Rule ${ruleNumber} not found in ${file}`)
    }

    if (!oldSummary) {
      oldSummary = formatRuleSummary(targetRule.content)
    }
  }

  // Update all files atomically
  for (const file of targetFiles) {
    const content = fs.readFileSync(file, "utf8")
    const parsed = parseRulesFromText(content)
    const targetRule = parsed.rules.find((r) => r.number === ruleNumber)!

    const rawSuffix = targetRule.raw.endsWith("\n\n") ? "\n\n" : targetRule.raw.endsWith("\n") ? "\n" : "\n\n"
    const formattedReplacement = `${ruleNumber}. ${cleanInput}${rawSuffix}`

    const newContent = content.slice(0, targetRule.startIndex) + formattedReplacement + content.slice(targetRule.endIndex)
    fs.writeFileSync(file, newContent, "utf8")
    updatedFiles.push(file)
  }

  return {
    ruleNumber,
    oldSummary,
    newSummary,
    updatedFiles,
  }
}

export class RulesModule implements GiggleModule {
  name = "rules"
  description = "Antigravity mirrored workspace rules manager (check, add, edit across all 6 files)"
  private context?: GiggleModuleContext

  initialize(context: GiggleModuleContext) {
    this.context = context
  }

  getCliCommands(): CliCommand[] {
    return [
      {
        name: "rules:check",
        description: "Check and audit mirrored rules across all 6 files",
        action: async () => {
          const rootDir = this.context?.rootDir || process.cwd()
          const check = checkMirroredRules(rootDir)

          console.log(`Audited ${check.files.length} mirrored rule files:`)
          for (const f of check.files) {
            const statusMark = f.exists && f.writable ? "[OK]" : "[FAIL]"
            console.log(`  ${statusMark} ${f.file} (${f.totalRules} rules, writable: ${f.writable})`)
          }

          if (check.driftDetails) {
            console.log("\nWarnings:")
            for (const d of check.driftDetails) {
              console.log(`  ! ${d}`)
            }
          }

          console.log(`\nRules List (${check.totalRules} rules total):`)
          for (const r of check.ruleSummaries) {
            console.log(`  Rule ${r.number}: ${r.summary}`)
          }
        },
      },
      {
        name: "rules:add",
        description: "Add a new numbered rule across all 6 mirrored rule files",
        action: async (args: string[]) => {
          const text = args.join(" ").trim()
          if (!text) {
            console.error("Usage: giggle rules add <rule text>")
            process.exit(1)
          }

          const rootDir = this.context?.rootDir || process.cwd()
          const res = addMirroredRule(text, rootDir)
          console.log(`Successfully added Rule ${res.newRuleNumber}: ${res.summary}`)
          console.log(`Updated all ${res.updatedFiles.length} mirrored files cleanly.`)
        },
      },
      {
        name: "rules:edit",
        description: "Edit an existing numbered rule across all 6 mirrored rule files",
        action: async (args: string[]) => {
          const ruleNumStr = args[0]
          const ruleNum = parseInt(ruleNumStr || "", 10)
          const text = args.slice(1).join(" ").trim()

          if (isNaN(ruleNum) || !text) {
            console.error("Usage: giggle rules edit <rule_number> <new rule text>")
            process.exit(1)
          }

          const rootDir = this.context?.rootDir || process.cwd()
          const res = editMirroredRule(ruleNum, text, rootDir)
          console.log(`Successfully updated Rule ${res.ruleNumber}:`)
          console.log(`  Previous: ${res.oldSummary}`)
          console.log(`  Updated:  ${res.newSummary}`)
          console.log(`Updated all ${res.updatedFiles.length} mirrored files cleanly.`)
        },
      },
    ]
  }

  getMcpTools(): McpToolDefinition[] {
    return [
      {
        name: "giggle_rules_check",
        description: "Audit and verify all 6 mirrored Antigravity rule files, returning rule summaries and synchronization state",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Optional root directory of the workspace, defaults to current repository root",
            },
          },
        },
        execute: async (args: Record<string, any>) => {
          const targetRoot = args.workspaceRoot || this.context?.rootDir || process.cwd()
          return checkMirroredRules(targetRoot)
        },
      },
      {
        name: "giggle_rules_add",
        description: "Add a new numbered rule atomically across all 6 mirrored rule files without manual editing",
        parameters: {
          type: "object",
          properties: {
            ruleText: {
              type: "string",
              description: "The complete text of the new rule to append",
            },
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root, defaults to current repository root",
            },
          },
          required: ["ruleText"],
        },
        execute: async (args: Record<string, any>) => {
          const targetRoot = args.workspaceRoot || this.context?.rootDir || process.cwd()
          return addMirroredRule(args.ruleText, targetRoot)
        },
      },
      {
        name: "giggle_rules_edit",
        description: "Edit an existing numbered rule across all 6 mirrored rule files cleanly and atomically",
        parameters: {
          type: "object",
          properties: {
            ruleNumber: {
              type: "number",
              description: "The rule number to edit (e.g. 5, 23)",
            },
            newRuleText: {
              type: "string",
              description: "The replacement rule text",
            },
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root, defaults to current repository root",
            },
          },
          required: ["ruleNumber", "newRuleText"],
        },
        execute: async (args: Record<string, any>) => {
          const targetRoot = args.workspaceRoot || this.context?.rootDir || process.cwd()
          return editMirroredRule(args.ruleNumber, args.newRuleText, targetRoot)
        },
      },
    ]
  }
}
