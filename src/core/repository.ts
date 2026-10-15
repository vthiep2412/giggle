import * as fs from "node:fs"
import * as path from "node:path"
import type { GiggleConfig } from "./types"

export function findGiggleRoot(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir)
  while (true) {
    const candidate = path.join(current, ".giggle")
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return null
}

export function initRepository(targetDir: string, defaultBranch: string = "main"): GiggleConfig {
  const repoRoot = path.resolve(targetDir)
  const giggleDir = path.join(repoRoot, ".giggle")
  const manifestFile = path.join(repoRoot, ".gigglemanifest")

  const dirs = [
    giggleDir,
    path.join(giggleDir, "objects"),
    path.join(giggleDir, "refs", "heads"),
    path.join(giggleDir, "refs", "tags"),
    path.join(giggleDir, "refs", "remotes"),
    path.join(giggleDir, "info"),
  ]

  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true })
    }
  }

  // Write HEAD pointing to default branch
  const headFile = path.join(giggleDir, "HEAD")
  if (!fs.existsSync(headFile)) {
    fs.writeFileSync(headFile, `ref: refs/heads/${defaultBranch}\n`, "utf8")
  }

  // Initialize standard Git INI config file so git CLI commands run smoothly
  const gitConfigFile = path.join(giggleDir, "config")
  if (!fs.existsSync(gitConfigFile)) {
    const gitConfigContent = [
      "[core]",
      "\trepositoryformatversion = 0",
      "\tfilemode = false",
      "\tbare = false",
      "\tlogallrefupdates = true",
      "\tsymlinks = false",
      "\tignorecase = true",
    ].join("\n")
    fs.writeFileSync(gitConfigFile, `${gitConfigContent}\n`, "utf8")
  }

  // Prevent any git inside git collision by explicitly excluding .git and .giggle
  const excludeFile = path.join(giggleDir, "info", "exclude")
  if (!fs.existsSync(excludeFile)) {
    const exclusions = [
      "**/.git",
      "**/.git/**",
      ".giggle",
      ".giggle/**",
      "node_modules",
      "node_modules/**",
      "*.log",
    ].join("\n")
    fs.writeFileSync(excludeFile, `${exclusions}\n`, "utf8")
  }

  // If this workspace lives inside an existing Git repository, protect host from staging .giggle
  protectHostRepository(repoRoot)

  // Write default JSON config file
  const configFile = path.join(giggleDir, "config.json")
  if (!fs.existsSync(configFile)) {
    const initialConfig = {
      defaultBranch,
      created: new Date().toISOString(),
    }
    fs.writeFileSync(configFile, JSON.stringify(initialConfig, null, 2), "utf8")
  }

  // Create starter .gigglemanifest if not present
  if (!fs.existsSync(manifestFile)) {
    const starterManifest = [
      "# Giggle Manifest: explicitly tracked workspace preset paths",
      "# Add paths or glob patterns to track and sync with GitHub",
      ".gigglemanifest",
      ".agents/**",
      "AGENTS.md",
      "CLAUDE.md",
      "CODEX.md",
      "GEMINI.md",
    ].join("\n")
    fs.writeFileSync(manifestFile, `${starterManifest}\n`, "utf8")
  }

  return {
    repoRoot,
    giggleDir,
    manifestFile,
    defaultBranch,
  }
}

function protectHostRepository(repoRoot: string): void {
  let current = repoRoot
  while (true) {
    const hostGit = path.join(current, ".git")
    if (fs.existsSync(hostGit) && fs.statSync(hostGit).isDirectory()) {
      const hostExclude = path.join(hostGit, "info", "exclude")
      try {
        if (fs.existsSync(hostExclude)) {
          const content = fs.readFileSync(hostExclude, "utf8")
          if (!content.includes(".giggle")) {
            fs.appendFileSync(hostExclude, "\n# Giggle isolated preset repository\n.giggle\n.giggle/**\n", "utf8")
          }
        }
      } catch {
        // Silently continue if host info/exclude cannot be written
      }
      break
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
}

export function updateRef(giggleDir: string, refPath: string, newOid: string): void {
  const fullPath = path.join(giggleDir, refPath)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fullPath, `${newOid}\n`, "utf8")
}

export function getRef(giggleDir: string, refPath: string): string | null {
  const fullPath = path.join(giggleDir, refPath)
  if (!fs.existsSync(fullPath)) {
    return null
  }
  return fs.readFileSync(fullPath, "utf8").trim()
}
