# Giggle

Giggle is a standalone Git-compatible workspace preset synchronizer, MCP server, rules auditor, and skill manager.

It allows developer workspaces to track, version-control, and synchronize shared agent rules, presets, and skills without creating nested Git repository collisions with host project repositories.

---

## Core Capabilities

- **Isolated Preset Version Control**: Tracks selective workspace files defined in `.gigglemanifest` into an internal `.giggle` Git database, completely isolated from any project `.git` repository.
- **Index Stat Cache**: Uses file size and modification timestamps to diff and stage hundreds of files in milliseconds without redundant disk reads or repeated SHA-1 hashing.
- **Mirrored Rules Auditor**: Audits and synchronizes shared developer rule files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, and subagent rules) with bidirectional consistency checks and preview reporting.
- **Skills Discovery & Synchronization**: Scans nested skill directories up to 3 levels deep, computes fuzzy search rankings, and synchronizes skills as global pointer references or Antigravity workflow markdown files.
- **Model Context Protocol (MCP) Server**: Exposes rules inspection, skills search, and repository synchronization tools directly to AI coding agents over stdio.

---

## Installation & Compilation

### Requirements
- [Bun](https://bun.com) runtime (v1.1 or later)
- Git command line interface

### Compile Standalone Binary
```powershell
# Install dependencies
bun install

# Compile self-contained executable to dist or your preferred bin directory
bun build --compile --minify bin/giggle.ts --outfile dist/giggle.exe

# Or output directly to your workspace bin
bun build --compile --minify bin/giggle.ts --outfile C:/Workspace/.bin/giggle.exe
```

---

## CLI Reference

### 1. Workspace Presets and Version Control

```powershell
# Initialize a .giggle repository in the current workspace
giggle init [directory]

# Stage tracked manifest files and commit (auto-increments commit count if -m is omitted)
giggle commit [-m "your message"]

# Show working tree status and manifest changes
giggle status

# Configure Git remote URL
giggle remote add <name> <url>

# Auto-commit tracked manifest files, fetch, rebase, and push to remote
giggle sync [--remote <name>] [-m "your message"]
```

### 2. Mirrored Rules Management

```powershell
# Audit all mirrored rule files and check synchronization status
giggle rules check

# Add a numbered rule across all mirrored rule files
giggle rules add "Rule text to append"

# Edit an existing numbered rule across all mirrored rule files
giggle rules edit <number> "Updated rule text"
```

### 3. Antigravity Skills

```powershell
# List workspace skills (filters non-auto-read skills by default)
giggle skill list [/force]

# Fuzzy search skills by keywords or fuzzy pattern
giggle skill search <query> [/force]

# Sync workspace skills as pointer files to ~/.gemini/antigravity/skills
giggle skill sync

# Sync workspace skills as global workflow markdown files to ~/.gemini/config/global_workflows
giggle skill sync -w
```

### 4. MCP Server

```powershell
# Start stdio MCP server for AI coding assistants
giggle mcp
```

---

## MCP Server Configuration

Add Giggle to your IDE or agent MCP settings:

```json
{
  "mcpServers": {
    "giggle": {
      "command": "C:/Workspace/.bin/giggle.exe",
      "args": ["mcp"]
    }
  }
}
```

### Available MCP Tools
- `giggle_sync`: Auto-commits uncommitted presets, rebases, and pushes to remote.
- `giggle_commit`: Stages tracked manifest files and commits using the auto-increment counter.
- `giggle_status`: Reports working tree status and tracked manifest drift.
- `giggle_rules_check`: Audits mirrored rule files and validates synchronization.
- `giggle_rules_add`: Appends a new numbered rule across all mirrored rule files.
- `giggle_rules_edit`: Modifies an existing numbered rule across all mirrored rule files.
- `giggle_skill_list`: Lists workspace skills with names, descriptions, and file paths.
- `giggle_skill_search`: Performs keyword and fuzzy search across skills.
- `giggle_skill_sync`: Synchronizes skills as pointers or full workflow markdown files.

---

## Manifest Configuration (`.gigglemanifest`)

Create a `.gigglemanifest` file at your workspace root to define tracked items:

```text
# Giggle Manifest: explicitly tracked workspace preset paths
.gigglemanifest
.agents/**
AGENTS.md
CLAUDE.md
CODEX.md
GEMINI.md
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
