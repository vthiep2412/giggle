import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import * as path from "node:path"
import * as fs from "node:fs"
import { findGiggleRoot, initRepository } from "../core/repository"
import { loadManifestRules, collectManifestFiles } from "../core/manifest"
import { diffWorkingTree } from "../core/workingtree"
import { commitWorkspace } from "../core/staging"
import { executeSync } from "../modules/sync/syncEngine"
import { createDefaultRegistry } from "../modules/registry"
import { resolveHead } from "../core/counter"

export function createMcpServer(customRootDir?: string) {
  const rootDir = customRootDir || findGiggleRoot(process.cwd()) || process.cwd()
  const giggleDir = path.join(rootDir, ".giggle")

  const server = new Server(
    {
      name: "giggle-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  const registry = createDefaultRegistry({ rootDir, giggleDir })

  function assertRepoInitialized(): void {
    if (!fs.existsSync(giggleDir)) {
      initRepository(rootDir, "main")
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const builtinTools = [
      {
        name: "giggle_sync",
        description: "Auto-commit uncommitted presets, rebase, and push to remote",
        inputSchema: {
          type: "object",
          properties: {
            remoteName: {
              type: "string",
              description: "Remote name, defaults to origin",
            },
            message: {
              type: "string",
              description: "Optional custom commit message, defaults to 'Git commit {count + 1}'",
            },
          },
        },
      },
      {
        name: "giggle_commit",
        description: "Stage tracked manifest files and create a commit using the auto-increment counter",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Optional commit message, defaults to 'Git commit {count + 1}'",
            },
          },
        },
      },
      {
        name: "giggle_status",
        description: "Check working tree status of files tracked by .gigglemanifest",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ]

    const moduleTools = registry.getAllMcpTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    }))

    return {
      tools: [...builtinTools, ...moduleTools],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params

    if (name === "giggle_sync") {
      assertRepoInitialized()
      const result = executeSync(rootDir, giggleDir, {
        remoteName: (args as any).remoteName,
        customMessage: (args as any).message,
      })
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }

    if (name === "giggle_commit") {
      assertRepoInitialized()
      const manifestFile = path.join(rootDir, ".gigglemanifest")
      const rules = loadManifestRules(manifestFile)
      const trackedFiles = collectManifestFiles(rootDir, rules)
      const result = commitWorkspace(rootDir, giggleDir, trackedFiles, (args as any).message)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }

    if (name === "giggle_status") {
      assertRepoInitialized()
      const head = resolveHead(giggleDir)
      const manifestFile = path.join(rootDir, ".gigglemanifest")
      const rules = loadManifestRules(manifestFile)
      const trackedFiles = collectManifestFiles(rootDir, rules)
      const diffs = diffWorkingTree(rootDir, giggleDir, trackedFiles)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                branch: head.branch || "detached",
                commitOid: head.commitOid,
                trackedFilesCount: trackedFiles.length,
                changes: diffs.filter((d) => d.status !== "unmodified"),
              },
              null,
              2
            ),
          },
        ],
      }
    }

    // Check module registry tools
    const moduleTool = registry.getAllMcpTools().find((t) => t.name === name)
    if (moduleTool) {
      const toolRes = await moduleTool.execute(args)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(toolRes, null, 2),
          },
        ],
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  })

  return server
}

export async function runMcpServer(customRootDir?: string) {
  const server = createMcpServer(customRootDir)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
