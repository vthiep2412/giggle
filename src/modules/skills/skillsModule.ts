import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import type { GiggleModule, GiggleModuleContext, CliCommand, McpToolDefinition } from "../base"
import { findWorkspaceRoot } from "../rules/rulesModule"

export interface SkillInfo {
  name: string
  description: string
  filePath: string
  skillDir: string
  autoRead: boolean
}

export interface SkillSyncResult {
  syncedCount: number
  targetDir: string
  syncedFiles: string[]
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".cache",
  ".github",
  ".idea",
  ".vscode",
  ".bun-build",
])

export function parseSkillFrontmatter(content: string, filePath: string): SkillInfo {
  const cleanContent = content.replace(/^\uFEFF/, "")
  const skillDir = path.dirname(filePath)
  const fallbackName = path.basename(skillDir)

  const frontmatterMatch = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch || !frontmatterMatch[1]) {
    return {
      name: fallbackName,
      description: "",
      filePath,
      skillDir,
      autoRead: true,
    }
  }

  const rawYaml = frontmatterMatch[1]
  const lines = rawYaml.split(/\r?\n/)

  let name = fallbackName
  let descriptionLines: string[] = []
  let isCollectingDescription = false
  let autoRead = true

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, "")
      isCollectingDescription = false
      continue
    }

    const autoReadMatch = line.match(/^(?:auto_read|auto-read|autoRead):\s*(.+)$/i)
    if (autoReadMatch && autoReadMatch[1]) {
      const val = autoReadMatch[1].trim().toLowerCase()
      if (val === "false" || val === "no" || val === "0") {
        autoRead = false
      }
      isCollectingDescription = false
      continue
    }

    const noAutoReadMatch = line.match(/^(?:no_auto_read|no-auto-read|noAutoRead):\s*(.+)$/i)
    if (noAutoReadMatch && noAutoReadMatch[1]) {
      const val = noAutoReadMatch[1].trim().toLowerCase()
      if (val === "true" || val === "yes" || val === "1") {
        autoRead = false
      }
      isCollectingDescription = false
      continue
    }

    const descMatch = line.match(/^description:\s*(.*)$/)
    if (descMatch) {
      isCollectingDescription = true
      const initialDesc = (descMatch[1] || "").trim()
      if (initialDesc && initialDesc !== ">-" && initialDesc !== "|" && initialDesc !== ">") {
        descriptionLines.push(initialDesc.replace(/^['"]|['"]$/g, ""))
      }
      continue
    }

    if (isCollectingDescription) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        descriptionLines.push(trimmed)
      } else {
        isCollectingDescription = false
      }
    }
  }

  const description = descriptionLines.join(" ").trim()

  return {
    name,
    description,
    filePath,
    skillDir,
    autoRead,
  }
}

export function getSkillsDirectory(workspaceRoot?: string): string | null {
  const root = findWorkspaceRoot(workspaceRoot || process.cwd())
  const candidates = [
    path.join(root, ".agents", "skills"),
    path.join(root, ".agent", "skills"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }

  return null
}

export function resolveSkillName(parsedName: string, relativeDir: string): string {
  const parts = relativeDir.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 1) {
    return parsedName
  }

  const parent = parts[0] || ""
  const parentLower = parent.toLowerCase()
  const nameLower = parsedName.toLowerCase()

  // If subskill name is identical to parent folder name (e.g. caveman/caveman or ponytail/ponytail)
  if (nameLower === parentLower) {
    return parsedName
  }

  const prefix = `${parentLower}-`
  if (nameLower.startsWith(prefix)) {
    return parsedName
  }

  return `${parent}-${parsedName}`
}

function findSkillFiles(skillsDir: string, maxDepth: number = 3): { skillFile: string; relativeDir: string }[] {
  const results: { skillFile: string; relativeDir: string }[] = []
  const possibleFiles = ["SKILL.md", "skill.md"]

  function scan(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    if (currentDir !== skillsDir) {
      for (const f of possibleFiles) {
        const p = path.join(currentDir, f)
        if (fs.existsSync(p)) {
          results.push({
            skillFile: p,
            relativeDir: path.relative(skillsDir, currentDir),
          })
          break
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue
      if (ALLOWED_SKILL_SUBDIRECTORIES.has(entry.name.toLowerCase())) continue

      scan(path.join(currentDir, entry.name), currentDepth + 1)
    }
  }

  scan(skillsDir, 1)
  return results
}

export function listSkills(workspaceRoot?: string, force: boolean = false): SkillInfo[] {
  const skillsDir = getSkillsDirectory(workspaceRoot)
  if (!skillsDir || !fs.existsSync(skillsDir)) {
    return []
  }

  const found = findSkillFiles(skillsDir)
  const results: SkillInfo[] = []

  for (const item of found) {
    try {
      const content = fs.readFileSync(item.skillFile, "utf8")
      const parsed = parseSkillFrontmatter(content, item.skillFile)
      const effectiveName = resolveSkillName(parsed.name, item.relativeDir)
      parsed.name = effectiveName

      if (force || parsed.autoRead) {
        results.push(parsed)
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export function computeFuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase()
  const t = target.toLowerCase()
  if (!q || !t) return 0
  if (t === q) return 1000
  if (t.includes(q)) return 500 + Math.floor(100 / (t.length + 1))

  let qIdx = 0
  let subseqScore = 0
  let consecutive = 0
  for (let tIdx = 0; tIdx < t.length && qIdx < q.length; tIdx++) {
    if (t[tIdx] === q[qIdx]) {
      qIdx++
      consecutive++
      subseqScore += 5 + consecutive * 5
    } else {
      consecutive = 0
    }
  }

  const isSubseq = qIdx === q.length
  return isSubseq ? subseqScore : 0
}

export function computeSkillScore(query: string, name: string, description: string): number {
  const q = query.trim().toLowerCase()
  const n = name.toLowerCase()
  const d = description.toLowerCase()

  if (!q) return 0
  if (n === q) return 2000

  let score = 0

  // Exact phrase match
  if (n.includes(q)) {
    score += 1000 + Math.floor(100 / (n.length + 1))
  }
  if (d.includes(q)) {
    score += 500 + Math.floor(100 / (d.length + 1))
  }

  const queryWords = q.split(/\s+/).filter(Boolean)

  if (queryWords.length > 1) {
    // Multi-word query: match words selectively
    const matchingWords = queryWords.filter((w) => n.includes(w) || d.includes(w))
    const allWordsPresent = matchingWords.length === queryWords.length
    const anyWordInName = queryWords.some((w) => n.includes(w))

    if (allWordsPresent) {
      score += 400
    }

    if (anyWordInName) {
      score += 250
    }

    // Require either phrase match, all words present, or at least one word in name
    if (score < 200) {
      return 0
    }
  } else {
    // Single word query
    const single = queryWords[0] || ""
    if (n.includes(single)) {
      score += 300
    } else if (d.includes(single)) {
      score += 150
    } else {
      // Subsequence match on skill name
      const nameFuzzy = computeFuzzyScore(single, n)
      if (nameFuzzy > 0) {
        score += nameFuzzy * 2
      }
    }
  }

  return score
}

export function searchSkills(query: string, workspaceRoot?: string, force: boolean = false): SkillInfo[] {
  const allSkills = listSkills(workspaceRoot, force)
  const q = query.trim().toLowerCase()
  if (!q) {
    return allSkills
  }

  const scored: { skill: SkillInfo; score: number }[] = []

  for (const s of allSkills) {
    const score = computeSkillScore(q, s.name, s.description)
    if (score >= 100) {
      scored.push({ skill: s, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((item) => item.skill)
}

const ALLOWED_SKILL_SUBDIRECTORIES = new Set([
  "scripts",
  "references",
  "examples",
  "resources",
  "assets",
  "docs",
])

function collectAllFilesRecursively(rootDir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(rootDir)) {
    return results
  }

  const stack: string[] = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    const isRootLevel = currentDir === rootDir

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
          continue
        }
        if (isRootLevel && !ALLOWED_SKILL_SUBDIRECTORIES.has(entry.name.toLowerCase())) {
          continue
        }
        stack.push(fullPath)
      } else if (entry.isFile()) {
        if (isRootLevel) {
          // At skill root level, strictly allow only SKILL.md
          if (entry.name.toLowerCase() === "skill.md") {
            results.push(path.relative(rootDir, fullPath))
          }
        } else {
          // Inside allowed subdirectories (scripts, references, etc.), allow non-hidden files
          if (!entry.name.startsWith(".")) {
            results.push(path.relative(rootDir, fullPath))
          }
        }
      }
    }
  }

  return results
}

function sanitizeYamlDescriptionForWorkflow(desc: string): string {
  if (!desc) return '""'
  if (desc.includes(":") || desc.includes("#") || desc.includes('"') || desc.includes("'") || desc.includes("\n")) {
    return JSON.stringify(desc)
  }
  return desc
}

export function syncSkills(
  workspaceRoot?: string,
  targetGlobalDir?: string,
  workflow: boolean = false
): SkillSyncResult {
  // Always include all skills during sync so manual ones are available with warnings
  const skills = listSkills(workspaceRoot, true)
  const defaultDir = workflow
    ? path.join(os.homedir(), ".gemini", "config", "global_workflows")
    : path.join(os.homedir(), ".gemini", "antigravity", "skills")
  const targetDir = targetGlobalDir || defaultDir

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const syncedFiles: string[] = []

  if (workflow) {
    for (const skill of skills) {
      const destFile = path.join(targetDir, `${skill.name}.md`)
      const normalizedSourceUri = `file:///${skill.filePath.replace(/\\/g, "/")}`
      const warningBlock = skill.autoRead
        ? ""
        : "> Warning: Ignore this skill unless explicitly requested by the user.\n\n"

      const safeDesc = sanitizeYamlDescriptionForWorkflow(skill.description)

      const pointerContent = [
        "---",
        `name: ${skill.name}`,
        `description: ${safeDesc}`,
        "---",
        "",
        warningBlock + normalizedSourceUri,
        "",
      ].filter((part) => part !== "").join("\n")

      fs.writeFileSync(destFile, pointerContent, "utf8")
      syncedFiles.push(destFile)
    }

    return {
      syncedCount: skills.length,
      targetDir,
      syncedFiles,
    }
  }

  for (const skill of skills) {
    const targetSkillDir = path.join(targetDir, skill.name)
    if (!fs.existsSync(targetSkillDir)) {
      fs.mkdirSync(targetSkillDir, { recursive: true })
    }

    const relativeFiles = collectAllFilesRecursively(skill.skillDir)

    for (const relFile of relativeFiles) {
      const sourceFile = path.join(skill.skillDir, relFile)
      const destFile = path.join(targetSkillDir, relFile)
      const destFolder = path.dirname(destFile)

      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true })
      }

      const normalizedSourceUri = `file:///${sourceFile.replace(/\\/g, "/")}`

      if (path.basename(relFile).toLowerCase() === "skill.md") {
        const warningBlock = skill.autoRead
          ? ""
          : "> Warning: Ignore this skill unless explicitly requested by the user.\n\n"

        const pointerContent = [
          "---",
          `name: ${skill.name}`,
          `description: ${skill.description}`,
          "---",
          "",
          warningBlock + normalizedSourceUri,
          "",
        ].filter((part) => part !== "").join("\n")

        fs.writeFileSync(destFile, pointerContent, "utf8")
      } else {
        const pointerContent = `${normalizedSourceUri}\n`
        fs.writeFileSync(destFile, pointerContent, "utf8")
      }

      syncedFiles.push(destFile)
    }
  }

  return {
    syncedCount: skills.length,
    targetDir,
    syncedFiles,
  }
}

export class SkillsModule implements GiggleModule {
  name = "skills"
  description = "Skills discovery, fuzzy search, and pointer synchronization module"
  private context?: GiggleModuleContext

  initialize(context: GiggleModuleContext): void {
    this.context = context
  }

  getCliCommands(): CliCommand[] {
    return [
      {
        name: "skill",
        description: "Manage and inspect Antigravity skills (list, search, sync)",
        action: async (args: string[]) => {
          const sub = args[0] || "list"
          const rootDir = this.context?.rootDir || process.cwd()

          if (sub === "list" || sub === "/force" || sub === "/f" || sub === "--force" || sub === "-f") {
            const force = args.includes("/force") || args.includes("/f") || args.includes("--force") || args.includes("-f") || sub === "/force" || sub === "/f" || sub === "--force" || sub === "-f"
            const skills = listSkills(rootDir, force)
            console.log(`Found ${skills.length} skills in workspace:`)
            for (const s of skills) {
              console.log(`  ${s.name}`)
              if (s.description) {
                console.log(`    ${s.description}`)
              }
              console.log(`    Path: ${s.filePath}`)
            }
          } else if (sub === "search") {
            const force = args.includes("/force") || args.includes("/f") || args.includes("--force") || args.includes("-f")
            const queryWords = args.slice(1).filter((a) => !["/force", "/f", "--force", "-f"].includes(a))
            const query = queryWords.join(" ").trim()
            if (!query) {
              console.error("Usage: giggle skill search <query> [/force]")
              process.exit(1)
            }
            const matches = searchSkills(query, rootDir, force)
            console.log(`Found ${matches.length} matching skills for '${query}':`)
            for (const m of matches) {
              console.log(`  ${m.name}`)
              if (m.description) {
                console.log(`    ${m.description}`)
              }
              console.log(`    Path: ${m.filePath}`)
            }
          } else if (sub === "sync") {
            const isWorkflow = args.includes("-w") || args.includes("--workflow")
            const targetArg = args.slice(1).find((a) => !["-w", "--workflow"].includes(a))
            const res = syncSkills(rootDir, targetArg, isWorkflow)
            const fileTypeLabel = isWorkflow ? "workflow markdown files" : "pointer files"
            console.log(`Synced ${res.syncedCount} skills (${res.syncedFiles.length} ${fileTypeLabel})`)
            console.log(`Target location: ${res.targetDir}`)
          } else {
            console.error(`Unknown skill subcommand: ${sub}. Available: list, search, sync`)
            process.exit(1)
          }
        },
      },
    ]
  }

  getMcpTools(): McpToolDefinition[] {
    return [
      {
        name: "giggle_skill_list",
        description: "List workspace skills with names, descriptions, file paths, and auto-read status",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory to scan",
            },
            force: {
              type: "boolean",
              description: "Whether to include manual non auto read skills, defaults to false",
            },
          },
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          const force = Boolean(args.force)
          const skills = listSkills(root, force)
          if (skills.length === 0) {
            return "No skills found in workspace."
          }
          const lines = [`Total: ${skills.length} skills\n`]
          for (const s of skills) {
            lines.push(`- ${s.name}`)
            if (s.description) {
              lines.push(`  Description: ${s.description}`)
            }
            lines.push(`  Path: ${s.filePath}`)
          }
          return lines.join("\n")
        },
      },
      {
        name: "giggle_skill_search",
        description: "Fuzzy search skills across workspace by name and description keywords",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search keyword or fuzzy pattern to match against skills",
            },
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory",
            },
            force: {
              type: "boolean",
              description: "Whether to search across manual non auto read skills, defaults to false",
            },
          },
          required: ["query"],
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          const force = Boolean(args.force)
          const matches = searchSkills(args.query || "", root, force)
          if (matches.length === 0) {
            return `No skills found matching "${args.query}".`
          }
          const lines = [`Total: ${matches.length} matching skills\n`]
          for (const s of matches) {
            lines.push(`- ${s.name}`)
            if (s.description) {
              lines.push(`  Description: ${s.description}`)
            }
            lines.push(`  Path: ${s.filePath}`)
          }
          return lines.join("\n")
        },
      },
      {
        name: "giggle_skill_sync",
        description: "Sync workspace skills to global skills folder as pointers or to global_workflows as markdown files",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory",
            },
            targetDir: {
              type: "string",
              description: "Optional target directory for synced files",
            },
            workflow: {
              type: "boolean",
              description: "Whether to sync as full workflow markdown files to global_workflows, defaults to false",
            },
          },
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          const isWorkflow = Boolean(args.workflow)
          const res = syncSkills(root, args.targetDir, isWorkflow)
          const fileTypeLabel = isWorkflow ? "workflow markdown files" : "pointer files"
          return `Synced ${res.syncedCount} skills (${res.syncedFiles.length} ${fileTypeLabel}) to ${res.targetDir}`
        },
      },
    ]
  }
}
