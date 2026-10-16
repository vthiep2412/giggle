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
  rawContent?: string
}

export interface SkillSyncResult {
  syncedCount: number
  targetDir: string
  syncedFiles: string[]
}

export function parseSkillFrontmatter(content: string, filePath: string): SkillInfo {
  const skillDir = path.dirname(filePath)
  const fallbackName = path.basename(skillDir)

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch || !frontmatterMatch[1]) {
    return {
      name: fallbackName,
      description: "",
      filePath,
      skillDir,
      autoRead: true,
      rawContent: content,
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
    rawContent: content,
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

export function listSkills(workspaceRoot?: string): SkillInfo[] {
  const skillsDir = getSkillsDirectory(workspaceRoot)
  if (!skillsDir || !fs.existsSync(skillsDir)) {
    return []
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  const results: SkillInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const dirPath = path.join(skillsDir, entry.name)
    const possibleFiles = ["SKILL.md", "skill.md"]
    let skillFile: string | null = null

    for (const f of possibleFiles) {
      const p = path.join(dirPath, f)
      if (fs.existsSync(p)) {
        skillFile = p
        break
      }
    }

    if (skillFile) {
      try {
        const content = fs.readFileSync(skillFile, "utf8")
        results.push(parseSkillFrontmatter(content, skillFile))
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export function searchSkills(query: string, workspaceRoot?: string): SkillInfo[] {
  const allSkills = listSkills(workspaceRoot)
  const q = query.trim().toLowerCase()
  if (!q) {
    return allSkills
  }

  return allSkills.filter((s) => {
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })
}

function collectAllFilesRecursively(dir: string, baseDir: string = dir): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) {
    return results
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectAllFilesRecursively(fullPath, baseDir))
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath))
    }
  }

  return results
}

export function syncSkills(workspaceRoot?: string, targetGlobalDir?: string): SkillSyncResult {
  const skills = listSkills(workspaceRoot)
  const targetDir = targetGlobalDir || path.join(os.homedir(), ".gemini", "antigravity", "skills")

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const syncedFiles: string[] = []

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
        const pointerContent = [
          "---",
          `name: ${skill.name}`,
          `description: ${skill.description}`,
          "---",
          "",
          normalizedSourceUri,
          "",
        ].join("\n")

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
  description = "Skills discovery, search, and pointer synchronization module"
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

          if (sub === "list") {
            const skills = listSkills(rootDir)
            console.log(`Discovered ${skills.length} skills in workspace:`)
            for (const s of skills) {
              const tag = s.autoRead ? "[OK]" : "[MANUAL]"
              console.log(`  ${tag} ${s.name} (auto-read: ${s.autoRead ? "yes" : "no"})`)
              if (s.description) {
                console.log(`       ${s.description}`)
              }
              console.log(`       Path: ${s.filePath}`)
            }
          } else if (sub === "search") {
            const query = args.slice(1).join(" ").trim()
            if (!query) {
              console.error("Usage: giggle skill search <query>")
              process.exit(1)
            }
            const matches = searchSkills(query, rootDir)
            console.log(`Found ${matches.length} matching skills for '${query}':`)
            for (const m of matches) {
              console.log(`  - ${m.name}: ${m.filePath}`)
              if (m.description) {
                console.log(`    ${m.description}`)
              }
            }
          } else if (sub === "sync") {
            const targetArg = args[1]
            const res = syncSkills(rootDir, targetArg)
            console.log(`Successfully synced ${res.syncedCount} skills (${res.syncedFiles.length} pointer files)`)
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
        description: "List all workspace skills with names, descriptions, file paths, and auto-read status",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory to scan",
            },
          },
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          const skills = listSkills(root)
          return {
            total: skills.length,
            skills,
          }
        },
      },
      {
        name: "giggle_skill_search",
        description: "Search skills across workspace by name and description keywords",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search keyword to match against skill name or description",
            },
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory",
            },
          },
          required: ["query"],
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          const matches = searchSkills(args.query || "", root)
          return {
            query: args.query,
            total: matches.length,
            matches,
          }
        },
      },
      {
        name: "giggle_skill_sync",
        description: "Sync workspace skills to the Antigravity global skills folder with lightweight path pointers",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Optional workspace root directory",
            },
            targetDir: {
              type: "string",
              description: "Optional target directory for synced skill pointers",
            },
          },
        },
        execute: async (args: Record<string, any>) => {
          const root = args.workspaceRoot || this.context?.rootDir || process.cwd()
          return syncSkills(root, args.targetDir)
        },
      },
    ]
  }
}
