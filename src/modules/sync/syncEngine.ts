import * as fs from "node:fs"
import * as path from "node:path"
import { loadManifestRules, collectManifestFiles } from "../../core/manifest"
import { diffWorkingTree } from "../../core/workingtree"
import { commitWorkspace } from "../../core/staging"
import { resolveHead, resolveRef } from "../../core/counter"
import { getRemoteUrl, fetchRemote, rebaseOntoRemote, pushRemote, runGitCommand } from "../../core/remote"

export interface SyncOptions {
  remoteName?: string
  customMessage?: string
  dryRun?: boolean
}

export interface SyncResult {
  autoCommitted: boolean
  commitMessage?: string
  commitOid?: string
  pushed: boolean
  remoteUrl?: string
  branch: string
  filesProcessed: string[]
  message: string
}

export function executeSync(
  rootDir: string,
  giggleDir: string,
  options: SyncOptions = {}
): SyncResult {
  const remoteName = options.remoteName || "origin"
  const manifestFile = path.join(rootDir, ".gigglemanifest")
  const manifestRules = loadManifestRules(manifestFile)
  const trackedFiles = collectManifestFiles(rootDir, manifestRules)

  const diffs = diffWorkingTree(rootDir, giggleDir, trackedFiles)
  const hasChanges = diffs.some((d) => d.status === "added" || d.status === "modified" || d.status === "deleted")

  let autoCommitted = false
  let commitMessage: string | undefined
  let commitOid: string | undefined

  if (hasChanges) {
    if (options.dryRun) {
      return {
        autoCommitted: false,
        pushed: false,
        branch: "main",
        filesProcessed: trackedFiles,
        message: "Dry run: uncommitted changes detected in manifest files",
      }
    }

    const commitRes = commitWorkspace(rootDir, giggleDir, trackedFiles, options.customMessage)
    autoCommitted = true
    commitMessage = commitRes.message
    commitOid = commitRes.commitOid
  }

  const { branch, commitOid: currentHead } = resolveHead(giggleDir)
  const activeBranch = branch || "main"

  const remoteUrl = getRemoteUrl(giggleDir, remoteName, rootDir)
  if (!remoteUrl) {
    return {
      autoCommitted,
      commitMessage,
      commitOid: commitOid || currentHead || undefined,
      pushed: false,
      branch: activeBranch,
      filesProcessed: trackedFiles,
      message: autoCommitted
        ? `Committed as "${commitMessage}". No remote configured, skipped push.`
        : "Working tree is clean. No remote configured, skipped push.",
    }
  }

  if (options.dryRun) {
    return {
      autoCommitted,
      commitMessage,
      commitOid: commitOid || currentHead || undefined,
      pushed: false,
      remoteUrl,
      branch: activeBranch,
      filesProcessed: trackedFiles,
      message: "Dry run completed.",
    }
  }

  // Flow 1: Fetch remote with explicit work tree
  const fetchRes = fetchRemote(giggleDir, rootDir, remoteName, activeBranch)

  // Rebase onto remote branch if remote tracking reference exists
  const remoteBranchRef = `${remoteName}/${activeBranch}`
  const remoteRelRef = `refs/remotes/${remoteName}/${activeBranch}`
  const hasRemoteRef = Boolean(resolveRef(giggleDir, remoteRelRef))

  if (hasRemoteRef) {
    const rebaseRes = rebaseOntoRemote(giggleDir, rootDir, remoteBranchRef)
    if (!rebaseRes.success) {
      try {
        runGitCommand(giggleDir, rootDir, ["rebase", "--abort"])
      } catch {
        // Ignore cleanup error if rebase was not active
      }
      return {
        autoCommitted,
        commitMessage,
        commitOid: commitOid || currentHead || undefined,
        pushed: false,
        remoteUrl,
        branch: activeBranch,
        filesProcessed: trackedFiles,
        message: `Sync halted: rebase conflict or error with ${remoteBranchRef}. ${rebaseRes.output.trim()}`,
      }
    }
  }

  // Push to remote using system git credentials
  const pushRes = pushRemote(giggleDir, rootDir, remoteName, activeBranch)

  if (!pushRes.success) {
    return {
      autoCommitted,
      commitMessage,
      commitOid: commitOid || currentHead || undefined,
      pushed: false,
      remoteUrl,
      branch: activeBranch,
      filesProcessed: trackedFiles,
      message: `Sync warning: push to ${remoteName} failed with: ${pushRes.output.trim()}`,
    }
  }

  return {
    autoCommitted,
    commitMessage,
    commitOid: commitOid || currentHead || undefined,
    pushed: true,
    remoteUrl,
    branch: activeBranch,
    filesProcessed: trackedFiles,
    message: autoCommitted
      ? `Successfully auto-committed "${commitMessage}" and synced with ${remoteName}/${activeBranch}.`
      : `Working tree clean. Successfully synced with ${remoteName}/${activeBranch}.`,
  }
}
