export function toolLabel(name: string): string {
	const match = /^mcp__(.+?)__(.+)$/.exec(name);
	if (match) return `MCP ${match[1]} / ${match[2]}`;
	return name === "tool_search" ? "Discover tools" : name;
}
