export type GitObjectType = "blob" | "tree" | "commit" | "tag"

export interface TreeEntry {
  mode: string
  name: string
  oid: string
  type: "blob" | "tree"
}

export interface CommitObject {
  tree: string
  parents: string[]
  author: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  committer: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  message: string
}

export interface ManifestEntry {
  pattern: string
  exactPath?: string
  isDirectory: boolean
}

export interface FileStatus {
  path: string
  status: "unmodified" | "modified" | "added" | "deleted" | "untracked"
  staged: boolean
}

export interface GiggleConfig {
  repoRoot: string
  giggleDir: string
  manifestFile: string
  remoteUrl?: string
  defaultBranch: string
}
