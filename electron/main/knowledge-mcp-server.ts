import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { KnowledgeExtractionRequest } from "../../src/shared/ipc.js";

type KnowledgeInventory = Pick<KnowledgeExtractionRequest, "existingEntities" | "existingDiagrams">;

const inventoryPath = process.env.RHYZA_KNOWLEDGE_INVENTORY;
if (!inventoryPath) throw new Error("RHYZA_KNOWLEDGE_INVENTORY is required.");

const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as KnowledgeInventory;
const server = new McpServer({ name: "rhyza-knowledge", version: "1.0.0" });

server.registerTool(
	"search_knowledge",
	{
		description:
			"Search the user's knowledge-base entities and diagrams. Omit query to inspect the complete inventory.",
		inputSchema: {
			query: z.string().optional(),
			limit: z.number().int().min(1).max(200).optional(),
		},
	},
	async ({ query, limit }) => {
		const normalizedQuery = query?.trim().toLocaleLowerCase();
		const resultLimit = limit ?? (normalizedQuery ? 20 : 200);
		const entities = inventory.existingEntities
			.filter((entity) => {
				if (!normalizedQuery) return true;
				return [
					entity.id,
					entity.name,
					...entity.aliases,
					entity.type,
					entity.summary,
					entity.content,
				]
					.join(" ")
					.toLocaleLowerCase()
					.includes(normalizedQuery);
			})
			.slice(0, resultLimit);
		const diagrams = inventory.existingDiagrams
			.filter((diagram) => {
				if (!normalizedQuery) return true;
				return [diagram.id, diagram.name, diagram.type, ...diagram.nodeLabels]
					.join(" ")
					.toLocaleLowerCase()
					.includes(normalizedQuery);
			})
			.slice(0, resultLimit);
		return {
			content: [{ type: "text", text: JSON.stringify({ entities, diagrams }) }],
			structuredContent: { entities, diagrams },
		};
	},
);

await server.connect(new StdioServerTransport());
