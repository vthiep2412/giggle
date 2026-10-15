import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { initRepository } from "../src/core/repository"
import { createMcpServer } from "../src/mcp/server"

describe("Giggle MCP Server", () => {
  it("initializes MCP server and registers tools", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-mcp-"))
    initRepository(tempDir, "main")

    const server = createMcpServer(tempDir)
    expect(server).toBeDefined()

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
