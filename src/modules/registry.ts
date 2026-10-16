import type { GiggleModule, GiggleModuleContext, CliCommand, McpToolDefinition } from "./base"
import { RulesModule } from "./rules/rulesModule"
import { SkillsModule } from "./skills/skillsModule"

export class ModuleRegistry {
  private modules: Map<string, GiggleModule> = new Map()

  register(module: GiggleModule): void {
    this.modules.set(module.name, module)
  }

  async initializeAll(context: GiggleModuleContext): Promise<void> {
    for (const mod of this.modules.values()) {
      if (mod.initialize) {
        await mod.initialize(context)
      }
    }
  }

  getModules(): GiggleModule[] {
    return Array.from(this.modules.values())
  }

  getModule(name: string): GiggleModule | undefined {
    return this.modules.get(name)
  }

  getAllCliCommands(): CliCommand[] {
    const commands: CliCommand[] = []
    for (const mod of this.modules.values()) {
      if (mod.getCliCommands) {
        commands.push(...mod.getCliCommands())
      }
    }
    return commands
  }

  getAllMcpTools(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = []
    for (const mod of this.modules.values()) {
      if (mod.getMcpTools) {
        tools.push(...mod.getMcpTools())
      }
    }
    return tools
  }
}

export function createDefaultRegistry(context?: GiggleModuleContext): ModuleRegistry {
  const registry = new ModuleRegistry()
  registry.register(new RulesModule())
  registry.register(new SkillsModule())

  if (context) {
    registry.initializeAll(context)
  }

  return registry
}
