import * as fs from "node:fs"
import * as path from "node:path"

export interface ManifestRule {
  raw: string
  pattern: string
  isNegation: boolean
  isDirectory: boolean
}

export function parseManifest(content: string): ManifestRule[] {
  const rules: ManifestRule[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    let isNegation = false
    let pattern = trimmed
    if (pattern.startsWith("!")) {
      isNegation = true
      pattern = pattern.slice(1).trim()
    }

    const isDirectory = pattern.endsWith("/") || pattern.endsWith("/**")
    rules.push({
      raw: trimmed,
      pattern: normalizePath(pattern),
      isNegation,
      isDirectory,
    })
  }

  return rules
}

export function loadManifestRules(manifestPath: string): ManifestRule[] {
  if (!fs.existsSync(manifestPath)) {
    return []
  }
  const content = fs.readFileSync(manifestPath, "utf8")
  return parseManifest(content)
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
}

export function matchesPattern(relPath: string, pattern: string): boolean {
  const normRel = normalizePath(relPath)
  const normPat = normalizePath(pattern)

  if (normRel === normPat) {
    return true
  }

  if (normRel.startsWith(`${normPat}/`)) {
    return true
  }

  let regexStr = "^"
  let i = 0
  while (i < normPat.length) {
    if (normPat.slice(i, i + 3) === "/**") {
      regexStr += "(?:/.*)?"
      i += 3
    } else if (normPat.slice(i, i + 3) === "**/") {
      regexStr += "(?:.*/)?"
      i += 3
    } else if (normPat.slice(i, i + 2) === "**") {
      regexStr += ".*"
      i += 2
    } else if (normPat.charAt(i) === "*") {
      regexStr += "[^/]*"
      i += 1
    } else if (normPat.charAt(i) === "?") {
      regexStr += "[^/]"
      i += 1
    } else {
      const char = normPat.charAt(i)
      if (["\\", ".", "^", "$", "+", "(", ")", "[", "]", "{", "}", "|"].includes(char)) {
        regexStr += `\\${char}`
      } else {
        regexStr += char
      }
      i += 1
    }
  }
  regexStr += "$"

  try {
    const regex = new RegExp(regexStr)
    if (regex.test(normRel)) {
      return true
    }
    if (!normPat.includes("/")) {
      const base = path.posix.basename(normRel)
      return regex.test(base)
    }
    return false
  } catch {
    return false
  }
}

export function isTrackedByManifest(relPath: string, rules: ManifestRule[]): boolean {
  if (rules.length === 0) {
    return false
  }

  let matched = false
  for (const rule of rules) {
    if (matchesPattern(relPath, rule.pattern)) {
      matched = !rule.isNegation
    }
  }

  return matched
}

export function collectManifestFiles(rootDir: string, rules: ManifestRule[]): string[] {
  const resultSet = new Set<string>()

  // Always track .gigglemanifest if it exists on disk
  const manifestRel = ".gigglemanifest"
  if (fs.existsSync(path.join(rootDir, manifestRel))) {
    resultSet.add(manifestRel)
  }

  for (const rule of rules) {
    if (rule.isNegation) {
      continue
    }

    let pattern = rule.pattern
    if (pattern.endsWith("/**")) {
      pattern = pattern.slice(0, -3)
    }

    // Case 1: Pattern is an exact file or exact directory prefix without wildcards
    if (!pattern.includes("*") && !pattern.includes("?")) {
      const fullPath = path.join(rootDir, pattern)
      if (!fs.existsSync(fullPath)) {
        continue
      }

      let stat: fs.Stats
      try {
        stat = fs.statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isFile()) {
        if (isTrackedByManifest(pattern, rules)) {
          resultSet.add(pattern)
        }
      } else if (stat.isDirectory()) {
        walkDirectoryOnly(rootDir, fullPath, rules, resultSet)
      }
      continue
    }

    // Case 2: Pattern contains wildcards but has a fixed directory prefix (e.g. .agents/**/*.ts)
    const firstWildcard = Math.min(
      pattern.indexOf("*") !== -1 ? pattern.indexOf("*") : Infinity,
      pattern.indexOf("?") !== -1 ? pattern.indexOf("?") : Infinity
    )

    const fixedPrefix = pattern.slice(0, firstWildcard)
    const lastSlash = fixedPrefix.lastIndexOf("/")
    if (lastSlash > 0) {
      const baseDirRel = fixedPrefix.slice(0, lastSlash)
      const baseDirFull = path.join(rootDir, baseDirRel)
      if (fs.existsSync(baseDirFull)) {
        walkDirectoryOnly(rootDir, baseDirFull, rules, resultSet)
      }
      continue
    }

    // Case 3: Root-level wildcard (e.g. *.md or **/*.ts)
    // Only walk root-level files and top-level directories, pruning heavy development folders
    walkRootWithPruning(rootDir, rules, resultSet)
  }

  return Array.from(resultSet).sort()
}

function walkDirectoryOnly(
  rootDir: string,
  targetDir: string,
  rules: ManifestRule[],
  resultSet: Set<string>
) {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".giggle" || entry.name === ".git" || entry.name === "node_modules") {
      continue
    }

    const fullPath = path.join(targetDir, entry.name)
    const relPath = normalizePath(path.relative(rootDir, fullPath))

    if (entry.isDirectory()) {
      walkDirectoryOnly(rootDir, fullPath, rules, resultSet)
    } else if (entry.isFile()) {
      if (isTrackedByManifest(relPath, rules)) {
        resultSet.add(relPath)
      }
    }
  }
}

function walkRootWithPruning(
  rootDir: string,
  rules: ManifestRule[],
  resultSet: Set<string>
) {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return
  }

  const ignoredFolders = new Set([
    ".giggle",
    ".git",
    "node_modules",
    "dist",
    "dist-ssr",
    ".bin",
    ".vscode",
    ".idea",
    ".turbo",
    ".next",
    "build",
  ])

  for (const entry of entries) {
    if (entry.isSymbolicLink() || ignoredFolders.has(entry.name)) {
      continue
    }

    const fullPath = path.join(rootDir, entry.name)
    const relPath = normalizePath(path.relative(rootDir, fullPath))

    if (entry.isFile()) {
      if (isTrackedByManifest(relPath, rules)) {
        resultSet.add(relPath)
      }
    } else if (entry.isDirectory()) {
      // Only traverse directory if at least one rule could possibly match inside it
      const couldMatch = rules.some((r) => !r.isNegation && (r.pattern.startsWith(relPath) || r.pattern.startsWith("**")))
      if (couldMatch) {
        walkDirectoryOnly(rootDir, fullPath, rules, resultSet)
      }
    }
  }
}
