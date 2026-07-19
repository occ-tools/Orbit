import { OrbitTool } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, OrbitTool<unknown, unknown>>();

  register(tool: OrbitTool<unknown, unknown>) {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): OrbitTool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): OrbitTool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }

  getDefinitions() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      inputJsonSchema: t.inputJsonSchema,
    }));
  }
}

export const toolRegistry = new ToolRegistry();
