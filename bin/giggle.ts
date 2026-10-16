#!/usr/bin/env bun
import * as path from "node:path"
import * as fs from "node:fs"
import { initRepository, findGiggleRoot } from "../src/core/repository"
import { loadManifestRules, collectManifestFiles } from "../src/core/manifest"
import { diffWorkingTree } from "../src/core/workingtree"
import { commitWorkspace } from "../src/core/staging"
import { executeSync } from "../src/modules/sync/syncEngine"
import { setRemoteUrl, getRemoteUrl } from "../src/core/remote"
import { checkMirroredRules, addMirroredRule, editMirroredRule, findWorkspaceRoot } from "../src/modules/rules/rulesModule"
import { listSkills, searchSkills, syncSkills } from "../src/modules/skills/skillsModule"
import { runMcpServer } from "../src/mcp/server"
import { resolveHead } from "../src/core/counter"

const args = process.argv.slice(2)
const command = args[0] || "--help"

async function main() {
  switch (command) {
    case "init": {
      const target = args[1] || process.cwd()
      const branch = getArgValue(args, "--branch") || "main"
      const config = initRepository(target, branch)
      console.log(`Initialized empty Giggle repository in ${config.giggleDir}`)
      console.log(`Manifest created at ${config.manifestFile}`)
      break
    }

    case "sync": {
      const rootDir = findGiggleRoot() || process.cwd()
      const giggleDir = path.join(rootDir, ".giggle")
      if (!fs.existsSync(giggleDir)) {
        console.error("Error: Not a giggle repository (or any parent up to mount point). Run 'giggle init' first.")
        process.exit(1)
      }

      const remoteName = getArgValue(args, "--remote") || "origin"
      const customMessage = getArgValue(args, "-m") || getArgValue(args, "--message")
      const dryRun = args.includes("--dry-run")

      console.log(`Synchronizing presets with ${remoteName}...`)
      const res = executeSync(rootDir, giggleDir, { remoteName, customMessage, dryRun })
      console.log(res.message)
      if (res.commitMessage) {
        console.log(`Commit: ${res.commitMessage} (${res.commitOid?.slice(0, 7)})`)
      }
      break
    }

    case "commit": {
      const rootDir = findGiggleRoot() || process.cwd()
      const giggleDir = path.join(rootDir, ".giggle")
      if (!fs.existsSync(giggleDir)) {
        console.error("Error: Not a giggle repository. Run 'giggle init' first.")
        process.exit(1)
      }

      const manifestFile = path.join(rootDir, ".gigglemanifest")
      const rules = loadManifestRules(manifestFile)
      const trackedFiles = collectManifestFiles(rootDir, rules)
      const diffs = diffWorkingTree(rootDir, giggleDir, trackedFiles)
      const hasChanges = diffs.some((d) => d.status === "added" || d.status === "modified" || d.status === "deleted")

      if (!hasChanges) {
        console.log("Nothing to commit, working tree clean.")
        break
      }

      const customMessage = getArgValue(args, "-m") || getArgValue(args, "--message")
      const res = commitWorkspace(rootDir, giggleDir, trackedFiles, customMessage)
      console.log(`[${res.commitOid.slice(0, 7)}] ${res.message}`)
      console.log(`Committed ${trackedFiles.length} tracked manifest files`)
      break
    }

    case "status": {
      const rootDir = findGiggleRoot() || process.cwd()
      const giggleDir = path.join(rootDir, ".giggle")
      if (!fs.existsSync(giggleDir)) {
        console.error("Error: Not a giggle repository. Run 'giggle init' first.")
        process.exit(1)
      }

      const head = resolveHead(giggleDir)
      console.log(`On branch ${head.branch || "detached"} (HEAD: ${head.commitOid ? head.commitOid.slice(0, 7) : "initial"})`)

      const manifestFile = path.join(rootDir, ".gigglemanifest")
      const rules = loadManifestRules(manifestFile)
      const trackedFiles = collectManifestFiles(rootDir, rules)
      const diffs = diffWorkingTree(rootDir, giggleDir, trackedFiles)

      const changes = diffs.filter((d) => d.status !== "unmodified")
      if (changes.length === 0) {
        console.log("Working tree clean. All manifest preset files up to date.")
      } else {
        console.log(`Changes detected (${changes.length} files):`)
        const maxDisplay = 25
        for (let i = 0; i < Math.min(changes.length, maxDisplay); i++) {
          const change = changes[i]
          if (!change) continue
          const tag = change.status.padEnd(8)
          console.log(`  ${tag} ${change.path}`)
        }
        if (changes.length > maxDisplay) {
          console.log(`  ... and ${changes.length - maxDisplay} more files (run 'giggle commit' to save changes)`)
        }
      }
      break
    }

    case "remote": {
      const rootDir = findGiggleRoot() || process.cwd()
      const giggleDir = path.join(rootDir, ".giggle")
      if (!fs.existsSync(giggleDir)) {
        console.error("Error: Not a giggle repository. Run 'giggle init' first.")
        process.exit(1)
      }

      const sub = args[1]
      if (sub === "add") {
        const name = args[2] || "origin"
        const url = args[3]
        if (!url) {
          console.error("Usage: giggle remote add <name> <url>")
          process.exit(1)
        }
        setRemoteUrl(giggleDir, name, url, rootDir)
        console.log(`Configured remote '${name}' -> ${url}`)
      } else {
        const name = args[2] || "origin"
        const url = getRemoteUrl(giggleDir, name, rootDir)
        if (url) {
          console.log(`${name}  ${url}`)
        } else {
          console.log(`No remote found named '${name}'`)
        }
      }
      break
    }

    case "rules": {
      const sub = args[1] || "check"
      const rootDir = findGiggleRoot() || findWorkspaceRoot()

      if (sub === "check") {
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
      } else if (sub === "add") {
        const ruleText = args.slice(2).join(" ").trim()
        if (!ruleText) {
          console.error("Usage: giggle rules add <rule text>")
          process.exit(1)
        }
        const res = addMirroredRule(ruleText, rootDir)
        console.log(`Successfully added Rule ${res.newRuleNumber}: ${res.summary}`)
        console.log(`Updated all ${res.updatedFiles.length} mirrored rule files cleanly.`)
      } else if (sub === "edit") {
        const ruleNum = parseInt(args[2] || "", 10)
        const newText = args.slice(3).join(" ").trim()
        if (isNaN(ruleNum) || !newText) {
          console.error("Usage: giggle rules edit <rule_number> <new rule text>")
          process.exit(1)
        }
        const res = editMirroredRule(ruleNum, newText, rootDir)
        console.log(`Successfully updated Rule ${res.ruleNumber}:`)
        console.log(`  Previous: ${res.oldSummary}`)
        console.log(`  Updated:  ${res.newSummary}`)
        console.log(`Updated all ${res.updatedFiles.length} mirrored rule files cleanly.`)
      } else {
        console.error(`Unknown rules subcommand: ${sub}. Available: check, add, edit`)
        process.exit(1)
      }
      break
    }

    case "skill":
    case "skills": {
      const sub = args[1] || "list"
      const rootDir = findGiggleRoot() || findWorkspaceRoot()

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
        const query = args.slice(2).join(" ").trim()
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
        const targetArg = args[2]
        const res = syncSkills(rootDir, targetArg)
        console.log(`Successfully synced ${res.syncedCount} skills (${res.syncedFiles.length} pointer files)`)
        console.log(`Target location: ${res.targetDir}`)
      } else {
        console.error(`Unknown skill subcommand: ${sub}. Available: list, search, sync`)
        process.exit(1)
      }
      break
    }

    case "mcp":
    case "serve": {
      const rootDir = findGiggleRoot() || process.cwd()
      await runMcpServer(rootDir)
      break
    }

    case "--version":
    case "-v": {
      console.log("giggle v1.0.0 (Bun Git-compatible preset engine)")
      break
    }

    case "--help":
    case "-h":
    default: {
      printHelp()
      break
    }
  }
}

function getArgValue(argList: string[], flag: string): string | undefined {
  const index = argList.indexOf(flag)
  if (index !== -1 && index + 1 < argList.length) {
    return argList[index + 1]
  }
  return undefined
}

function printHelp() {
  console.log(`
Giggle: Standalone Git-compatible Preset Synchronizer

Usage:
  giggle <command> [options]

Commands:
  init [directory]                    Initialize a new .giggle repository
  sync [--remote <name>]              Auto-commit and synchronize with GitHub in one command
  commit [-m <message>]               Stage manifest files and commit (auto-increments count if omitted)
  status                              Display working tree status and manifest drift
  remote add <name> <url>             Configure GitHub remote URL
  rules check                         Audit and report all 6 mirrored rules with 3-word previews
  rules add <rule text>               Add a new numbered rule across all 6 mirrored files
  rules edit <number> <new rule text> Edit an existing numbered rule across all 6 mirrored files
  mcp, serve                          Start the stdio Model Context Protocol (MCP) server
  --help, -h                          Display help information
  --version, -v                       Display version number
`)
}

main().catch((err) => {
  console.error("Giggle error:", err.message)
  process.exit(1)
})
