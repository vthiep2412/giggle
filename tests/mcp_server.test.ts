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

  it("enforces workspace root when explicitly provided", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-mcp-enforced-"))
    initRepository(tempDir, "main")

    const server = createMcpServer(tempDir, true)
    expect(server).toBeDefined()

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("overrides caller-supplied workspaceRoot when enforcement is active", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-mcp-override-"))
    const skillsDir = path.join(tempDir, ".agents", "skills", "enforced-skill")
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      "---\nname: enforced-skill\ndescription: Enforced test.\n---\n",
      "utf8"
    )

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-mcp-other-"))
    const otherSkillsDir = path.join(otherDir, ".agents", "skills", "other-skill")
    fs.mkdirSync(otherSkillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(otherSkillsDir, "SKILL.md"),
      "---\nname: other-skill\ndescription: Other test.\n---\n",
      "utf8"
    )

    const server = createMcpServer(tempDir, true)
    // Query list tool through internal request handler
    const handler = (server as any)._requestHandlers.get("tools/call")
    const response = await handler({
      method: "tools/call",
      params: {
        name: "giggle_skill_list",
        arguments: { workspaceRoot: otherDir },
      },
    })

    expect(response.content[0].text.includes("enforced-skill")).toBe(true)
    expect(response.content[0].text.includes("other-skill")).toBe(false)

    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(otherDir, { recursive: true, force: true })
  })
})
