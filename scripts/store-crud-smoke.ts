const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
		key: (index: number) => [...values.keys()][index] ?? null,
		get length() { return values.size; },
	},
});
Object.defineProperty(globalThis, "window", { value: globalThis });

const { loadWorkspaceState, useAppStore } = await import("../src/store/index.js");
const timestamp = new Date().toISOString();

useAppStore.setState({
	sessions: [
		{ id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" },
		{ id: "child", parentId: "root", title: "Child", isRoot: false, status: "idle" },
	],
	activeSessionId: "child",
	turns: [
		{ id: "turn", sessionId: "child", role: "user", content: "test", status: "complete", createdAt: timestamp },
	],
});
useAppStore.getState().deleteSession("root");
assert(useAppStore.getState().sessions.length === 1, "Deleting the final session must create a replacement root.");
assert(useAppStore.getState().turns.length === 0, "Deleting a session tree must remove its turns.");

useAppStore.setState({
	sessions: [{ id: "fork-root", parentId: null, title: "Fork root", isRoot: true, status: "idle" }],
	activeSessionId: "fork-root",
	turns: [
		{ id: "turn-1", sessionId: "fork-root", role: "user", content: "Question", status: "complete", createdAt: timestamp },
		{ id: "turn-2", sessionId: "fork-root", role: "assistant", content: "Answer", status: "complete", createdAt: timestamp },
	],
});
assert(useAppStore.getState().forkSession("turn-2") === null, "The latest turn must not be forkable.");
const fork = useAppStore.getState().forkSession("turn-1");
assert(Boolean(fork), "A historical turn should remain forkable.");
assert(useAppStore.getState().sessions.find((session) => session.id === "fork-root")?.continuationTitlePending === true, "The original path must become a titled leaf.");
assert(useAppStore.getState().sessions.find((session) => session.id === fork?.forkSessionId)?.titlePending === true, "The new branch title must be marked for AI refresh.");
useAppStore.getState().setSessionProgressStatus("fork-root", "complete");
useAppStore.getState().setSessionProgressStatus("fork-root", "todo", true);
assert(useAppStore.getState().sessions.find((session) => session.id === "fork-root")?.progressStatus === "complete", "A branch status must be stored on the session.");
assert(useAppStore.getState().sessions.find((session) => session.id === "fork-root")?.continuationProgressStatus === "todo", "The original path must keep an independent status.");

useAppStore.setState({
	entities: [{ id: "entity", name: "Worktree", aliases: [], type: "Concept", summary: "Summary", content: "Content", confidence: "confirmed", sourceRefs: [], version: 1, updatedAt: timestamp }],
	relations: [{ id: "relation", sourceEntityId: "entity", targetEntityId: "other", type: "related_to", description: "Relation", confidence: "inferred", sourceRefs: [], version: 1 }],
	diagrams: [{ id: "diagram", name: "Map", type: "architecture", mermaidSource: "flowchart LR\n  entity[Worktree] --> other[Other]", nodes: [{ id: "entity", entityId: "entity", label: "Worktree" }], edges: [{ id: "edge", source: "entity", target: "other" }], version: 1, versions: [], updatedAt: timestamp }],
	selectedEntityId: "entity",
});
useAppStore.getState().softDeleteEntity("entity");
assert(Boolean(useAppStore.getState().entities[0]?.deletedAt), "Archiving an entity must soft-delete it.");
assert(Boolean(useAppStore.getState().relations[0]?.deletedAt), "Archiving an entity must archive its relations.");
assert(useAppStore.getState().diagrams[0]?.nodes.length === 1, "Archiving an entity must not rewrite Mermaid diagram content.");

const diagram = useAppStore.getState().diagrams[0];
if (!diagram) throw new Error("Expected a diagram.");
useAppStore.getState().saveDiagram({ ...diagram, name: "Renamed map" });
assert(useAppStore.getState().diagrams[0]?.name === "Renamed map", "Diagram rename was not saved.");
useAppStore.getState().softDeleteDiagram("diagram");
assert(Boolean(useAppStore.getState().diagrams[0]?.deletedAt), "Diagram was not archived.");

loadWorkspaceState(JSON.stringify({
	version: 2,
	state: {
		sessions: [{ id: "interrupted-session", parentId: null, title: "Interrupted", isRoot: true, status: "running" }],
		activeSessionId: "interrupted-session",
		turns: [{ id: "interrupted-turn", sessionId: "interrupted-session", role: "assistant", content: "Partial", status: "running", createdAt: timestamp, tools: [{ id: "tool", name: "read", target: "src/app.ts", status: "running", startedAt: timestamp }] }],
	},
}));
assert(useAppStore.getState().sessions[0]?.status === "error", "A stale running session must recover as an error.");
assert(useAppStore.getState().turns[0]?.status === "interrupted", "A stale running turn must recover as interrupted.");
assert(useAppStore.getState().turns[0]?.tools?.[0]?.status === "error", "A running tool must recover as interrupted instead of staying active.");

useAppStore.setState({
	sources: [
		{ id: "source-a", name: "A", path: "/a", fileCount: 1, status: "indexed", type: "docs", revision: "a1" },
		{ id: "source-b", name: "B", path: "/b", fileCount: 2, status: "indexed", type: "repo", revision: "b1" },
		{ id: "source-c", name: "C", path: "/c", fileCount: 3, status: "indexed", type: "docs", revision: "c1" },
	],
});
useAppStore.getState().upsertSources([
	{ id: "source-b", name: "B", path: "/b", fileCount: 4, status: "indexed", type: "repo", revision: "b2" },
]);
assert(useAppStore.getState().sources.map((source) => source.id).join(",") === "source-a,source-b,source-c", "Refreshing a source must preserve list order.");
assert(useAppStore.getState().sources[1]?.fileCount === 4, "Refreshing a source must update it in place.");
useAppStore.getState().upsertSources([
	{ id: "source-d", name: "D", path: "/d", fileCount: 1, status: "indexed", type: "docs" },
]);
assert(useAppStore.getState().sources.at(-1)?.id === "source-d", "A new source must be appended after existing sources.");

useAppStore.setState({
	sessions: [{ id: "diagram-session", parentId: null, title: "Diagram", isRoot: true, status: "idle" }],
	activeSessionId: "diagram-session",
	turns: [{ id: "diagram-turn", sessionId: "diagram-session", role: "assistant", content: "", status: "finalizing", createdAt: timestamp }],
	entities: [],
	relations: [],
	diagrams: [],
	changesets: [],
	settings: { ...useAppStore.getState().settings, autoExtract: true, knowledgeMode: "automatic" },
});
const loginDiagram = {
	name: "Login sequence",
	type: "sequence" as const,
	mermaidSource: "sequenceDiagram\n  User->>App: Sign in",
	nodes: [{ key: "user", label: "User" }, { key: "app", label: "App" }],
	edges: [{ sourceKey: "user", targetKey: "app", label: "Sign in" }],
};
useAppStore.getState().finalizeTurn("diagram-session", "diagram-turn", "No diagram", [], []);
assert(useAppStore.getState().diagrams.length === 0, "Entity finalization must not synthesize a workspace diagram.");
useAppStore.getState().finalizeTurn("diagram-session", "diagram-turn", "First", [], [], [loginDiagram]);
const createdDiagram = useAppStore.getState().diagrams.find((item) => item.name === "Login sequence");
assert(createdDiagram?.version === 1, "A Mermaid answer must create a knowledge diagram.");
useAppStore.getState().finalizeTurn("diagram-session", "diagram-turn", "Second", [], [], [{ ...loginDiagram, mermaidSource: `${loginDiagram.mermaidSource}\n  App-->>User: Ready` }]);
const matchingDiagrams = useAppStore.getState().diagrams.filter((item) => item.name === "Login sequence");
assert(matchingDiagrams.length === 1, "A matching Mermaid answer must update instead of duplicate the diagram.");
assert(matchingDiagrams[0]?.version === 2, "Updating a matching diagram must create a new version.");

useAppStore.setState({
	entities: [{ id: "agent-loop", name: "Agent Loop", aliases: [], type: "Pattern", summary: "Old summary", content: "Old content", confidence: "confirmed", sourceRefs: [], version: 1, updatedAt: timestamp }],
	relations: [],
	diagrams: [],
	changesets: [],
	turns: [{ id: "knowledge-turn", sessionId: "diagram-session", role: "assistant", content: "", status: "finalizing", createdAt: timestamp }],
	settings: { ...useAppStore.getState().settings, autoExtract: true, knowledgeMode: "suggest" },
});
useAppStore.getState().finalizeTurn(
	"diagram-session",
	"knowledge-turn",
	"Updated answer",
	[
		{ existingEntityId: "agent-loop", name: "Agent Loop", type: "Pattern", summary: "Updated summary", content: "Updated content", confidence: "explicit" },
		{ name: "Tool Call", type: "Concept", summary: "A model request to execute a tool.", content: "A tool call delegates a bounded operation to a registered tool.", confidence: "explicit" },
	],
	[{ sourceEntityId: "agent-loop", sourceName: "Agent Loop", targetName: "Tool Call", type: "calls", description: "The loop executes requested tools.", confidence: "explicit" }],
	[],
	[{ sourceId: "source", path: "agent.ts", revision: "abc", lineStart: 12, lineEnd: 12 }],
);
assert(useAppStore.getState().entities.find((item) => item.id === "agent-loop")?.content === "Updated content", "Finalization must update an existing entity.");
assert(useAppStore.getState().relations.some((item) => item.type === "calls"), "Finalization must create extracted relations.");
assert(useAppStore.getState().entities.find((item) => item.id === "agent-loop")?.sourceRefs.some((item) => item.path === "agent.ts"), "Finalization must preserve source evidence.");
const proposal = useAppStore.getState().changesets[0];
assert(proposal?.status === "proposed", "Suggest mode must create a proposed ChangeSet.");
useAppStore.getState().rejectChangeSet(proposal.id);
assert(useAppStore.getState().entities.find((item) => item.id === "agent-loop")?.content === "Old content", "Rejecting a proposal must restore updated entities.");
assert(!useAppStore.getState().entities.some((item) => item.name === "Tool Call"), "Rejecting a proposal must remove proposed entities.");
assert(useAppStore.getState().relations.length === 0, "Rejecting a proposal must remove proposed relations.");
assert(useAppStore.getState().changesets.find((item) => item.id === proposal.id)?.status === "superseded", "Rejected proposals must retain an audited status.");

console.log("Store CRUD smoke passed: recovery, knowledge proposals, relations, and diagram versions are consistent.");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
