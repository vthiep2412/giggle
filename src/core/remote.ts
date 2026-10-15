import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export interface RemoteInfo {
  name: string
  url: string
}

function getCleanGitEnv(giggleDir: string, workTree: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      env[k] = v
    }
  }

  // Override ambient git environment variables to prevent host repo contamination
  env.GIT_DIR = giggleDir
  env.GIT_WORK_TREE = workTree
  delete env.GIT_INDEX_FILE
  delete env.GIT_OBJECT_DIRECTORY
  return env
}

export function runGitCommand(
  giggleDir: string,
  workTree: string,
  args: string[]
): { success: boolean; stdout: string; stderr: string } {
  const fullArgs = ["--git-dir", giggleDir, "--work-tree", workTree, ...args]
  const env = getCleanGitEnv(giggleDir, workTree)

  const res = spawnSync("git", fullArgs, {
    encoding: "utf8",
    env,
    stdio: "pipe",
  })

  return {
    success: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  }
}

export function getRemoteUrl(giggleDir: string, remoteName: string = "origin", workTree?: string): string | null {
  const configFile = path.join(giggleDir, "config.json")
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"))
      if (cfg.remotes && cfg.remotes[remoteName]) {
        return cfg.remotes[remoteName]
      }
    } catch {
      // Fall through to git config
    }
  }

  const effectiveWorkTree = workTree || path.dirname(giggleDir)
  const res = runGitCommand(giggleDir, effectiveWorkTree, ["config", "--get", `remote.${remoteName}.url`])
  return res.success && res.stdout.trim().length > 0 ? res.stdout.trim() : null
}

export function setRemoteUrl(giggleDir: string, remoteName: string, url: string, workTree?: string): void {
  const configFile = path.join(giggleDir, "config.json")
  let cfg: any = {}
  if (fs.existsSync(configFile)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configFile, "utf8"))
    } catch {
      cfg = {}
    }
  }

  if (!cfg.remotes) {
    cfg.remotes = {}
  }
  cfg.remotes[remoteName] = url
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf8")

  const effectiveWorkTree = workTree || path.dirname(giggleDir)
  runGitCommand(giggleDir, effectiveWorkTree, ["remote", "remove", remoteName])
  runGitCommand(giggleDir, effectiveWorkTree, ["remote", "add", remoteName, url])
}

export function fetchRemote(
  giggleDir: string,
  workTree: string,
  remoteName: string,
  branch: string
): { success: boolean; output: string } {
  // Fetch with explicit refspec to ensure refs/remotes/<remote>/<branch> is populated
  const refspec = `refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`
  const res = runGitCommand(giggleDir, workTree, ["fetch", remoteName, refspec])

  // If fetching with specific refspec fails (e.g. empty new repo), try general fetch
  if (!res.success) {
    const fallbackRes = runGitCommand(giggleDir, workTree, ["fetch", remoteName])
    return {
      success: fallbackRes.success,
      output: fallbackRes.stdout + fallbackRes.stderr,
    }
  }

  return {
    success: true,
    output: res.stdout + res.stderr,
  }
}

export function pushRemote(
  giggleDir: string,
  workTree: string,
  remoteName: string,
  branch: string,
  setUpstream: boolean = true
): { success: boolean; output: string } {
  const args = ["push"]
  if (setUpstream) {
    args.push("-u")
  }
  args.push(remoteName, branch)

  const res = runGitCommand(giggleDir, workTree, args)
  return {
    success: res.success,
    output: res.stdout + res.stderr,
  }
}

export function rebaseOntoRemote(
  giggleDir: string,
  workTree: string,
  remoteBranch: string
): { success: boolean; output: string } {
  const res = runGitCommand(giggleDir, workTree, ["rebase", remoteBranch])
  return {
    success: res.success,
    output: res.stdout + res.stderr,
  }
}
