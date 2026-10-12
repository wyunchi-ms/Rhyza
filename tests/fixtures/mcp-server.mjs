import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const server = new Server(
	{ name: "rhyza-mcp-fixture", version: "1.0.0" },
	{ capabilities: { tools: { listChanged: true }, resources: {} } },
);
let added = false;
server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "echo",
			description: "Echo a fixture value",
			inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
			annotations: { readOnlyHint: true },
		},
		{
			name: "write",
			description: "Write a fixture file",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		{
			name: "failure",
			description: "Return a fixture tool error",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "echo-text",
			description: "First colliding name",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "echo_text",
			description: "Second colliding name",
			inputSchema: { type: "object", properties: {} },
		},
		...(added
			? [
					{
						name: "new_tool",
						description: "A newly discovered unapproved tool",
						inputSchema: { type: "object", properties: {} },
						annotations: { readOnlyHint: true },
					},
				]
			: []),
		...(added || process.env.MCP_FIXTURE_INCLUDE_PROTOTYPE === "1"
			? [
					{
						name: "constructor",
						description: "An unapproved tool with a prototype property name",
						inputSchema: { type: "object", properties: {} },
					},
				]
			: []),
	],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;
	if (name === "write") {
		await writeFile(path.join(process.cwd(), "mcp-write.txt"), "fixture write");
		return { content: [{ type: "text", text: "written" }] };
	}
	if (name === "failure")
		return { isError: true, content: [{ type: "text", text: "fixture tool failure" }] };
	if (args?.text === "change-tools") {
		added = true;
		await server.sendToolListChanged();
	}
	return {
		content: [{ type: "text", text: String(args?.text ?? name) }],
		structuredContent: { marker: process.env.MCP_FIXTURE_MARKER ?? "fixture" },
	};
});
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
	if (process.env.MCP_FIXTURE_DELAY_RESOURCES === "1")
		await new Promise((resolve) => setTimeout(resolve, 100));
	return {
		resources: [
			{
				uri: request.params?.cursor ? "fixture://second" : "fixture://guide",
				name: "Fixture guide",
				mimeType: "text/plain",
			},
		],
		...(request.params?.cursor ? {} : { nextCursor: "second-page" }),
	};
});
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
	resourceTemplates: [{ uriTemplate: "fixture://{page}", name: "Fixture pages" }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
	contents: [
		{
			uri: request.params.uri,
			mimeType: "text/plain",
			text:
				request.params.uri === "fixture://large"
					? "\u6c49".repeat(50_000)
					: "fixture resource text",
		},
	],
}));
await server.connect(new StdioServerTransport());
