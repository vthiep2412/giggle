export interface CliCommandOption {
  flags: string
  description: string
  defaultValue?: string | boolean
}

export interface CliCommand {
  name: string
  description: string
  options?: CliCommandOption[]
  action: (args: string[], options: Record<string, any>) => Promise<void> | void
}

export interface McpToolParameter {
  type: string
  description: string
  required?: boolean
  default?: any
}

export interface McpToolDefinition {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, McpToolParameter>
    required?: string[]
  }
  execute: (args: Record<string, any>) => Promise<any> | any
}

export interface GiggleModuleContext {
  rootDir: string
  giggleDir: string
}

export interface GiggleModule {
  name: string
  description: string
  initialize?: (context: GiggleModuleContext) => Promise<void> | void
  getCliCommands?: () => CliCommand[]
  getMcpTools?: () => McpToolDefinition[]
  onBeforeSync?: (context: GiggleModuleContext) => Promise<void> | void
  onAfterSync?: (context: GiggleModuleContext) => Promise<void> | void
}
