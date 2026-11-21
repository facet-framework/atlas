/** The tools the real `facet mcp` server advertises, as the host lists them. */

export type McpTools = { available: boolean; reason?: string; tools: string[] };

export type McpToolsReader = () => Promise<McpTools>;

export const readMcpTools: McpToolsReader = async () => {
  const response = await fetch("/api/mcp/tools");
  if (!response.ok) throw new Error((await response.text()).trim() || String(response.status));
  return (await response.json()) as McpTools;
};
