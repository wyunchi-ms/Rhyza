import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { buildPathSummaryInput, summarySourceEdges } from "../src/utils/pathSummary.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";
import { projectConversationTree } from "../src/utils/conversationTree.js";
import { forkSessionAtTurn } from "../src/utils/sessionFork.js";
import { buildAgentTranscriptBeforeTurn } from "../src/utils/agentTranscript.js";
import { validatePathSummaryRequest, type PathSummaryRequest } from "../src/shared/ipc.js";
import {
	summarizeConversationPaths,
	summaryCompletionMarker,
	summaryTokenEstimate,
	type PathSummaryCompletion,
} from "../electron/main/path-summary.js";
import { loadWorkspaceState, useAppStore } from "../src/store/index.js";
import { allocateBranchUsage } from "../src/utils/branchUsage.js";
import { filterConversationRounds } from "../src/utils/conversationFilter.js";

const root: SessionNode = {
	id: "root",
	parentId: null,
	title: "Root",
	isRoot: true,
	status: "idle",
};
const message = (id: string, role: Turn["role"], sessionId = "root"): Turn => ({
	id,
	role,
	sessionId,
	content: `${id} visible text`,
	status: "complete",
	createdAt: "2026-10-10T00:00:00Z",
	reasoning: "PRIVATE THINKING",
	tools: [
		{
			id: "tool",
			name: "subagent",
			status: "complete",
			output: "PRIVATE TOOL RESULT",
			startedAt: "2026-10-10T00:00:00Z",
		},
	],
});
const history = () =>
	[1, 2, 3].flatMap((n) => [message(`u${n}`, "user"), message(`a${n}`, "assistant")]);
const requestFor = (content: string): PathSummaryRequest => ({
	requestId: "request",
	model: { providerId: "github-copilot", modelId: "" },
	rounds: [{ id: "u", messages: [{ id: "u", role: "user", content }] }],
	paths: [{ id: "u", title: "Question", roundIds: ["u"] }],
});

test("multiple fork endpoints include shared user-visible history once, never execution metadata", () => {
	let sequence = 0;
	const fork = forkSessionAtTurn(
		{ sessions: [root], turns: history() },
		"a1",
		(prefix) => `${prefix}-${++sequence}`,
	)!;
	const turns = [
		...fork.turns,
		message("branch-u", "user", fork.forkSessionId),
		message("branch-a", "assistant", fork.forkSessionId),
	];
	const input = buildPathSummaryInput(fork.sessions, turns, ["u3", "branch-u"]);
	assert.deepEqual(
		input.rounds.map((round) => round.id),
		["u1", "u2", "u3", "branch-u"],
	);
	assert.equal(
		input.rounds.flatMap((round) => round.messages).filter((turn) => turn.id === "a1").length,
		1,
	);
	assert.deepEqual(
		input.paths.map((path) => path.roundIds),
		[
			["u1", "u2", "u3"],
			["u1", "branch-u"],
		],
	);
	assert.doesNotMatch(JSON.stringify(input), /PRIVATE|reasoning|tools|subagent/);
	assert.equal(input.sources.length, 2);
});

test("ancestor endpoints, identical unrelated messages, quotes, and cross-root paths keep their identity", () => {
	const other: SessionNode = { ...root, id: "other" };
	const turns = [
		...history(),
		{
			...message("other-u", "user", "other"),
			content: "u1 visible text",
			quote: { turnId: "a1", text: "Quoted evidence" },
		},
	];
	const input = buildPathSummaryInput([root, other], turns, ["u1", "u3", "other-u", "u1"]);
	assert.equal(input.sources.length, 3);
	assert.equal(input.rounds.length, 4);
	assert.match(input.rounds.at(-1)!.messages[0].content, /Quoted evidence/);
	assert.equal(input.rounds.flatMap((round) => round.messages).length, 7);
	assert.throws(() => buildPathSummaryInput([root], history(), ["missing"]), /no longer exists/);
	assert.throws(
		() =>
			buildPathSummaryInput(
				[root],
				history().map((turn) => (turn.id === "a1" ? { ...turn, status: "running" } : turn)),
				["u3"],
			),
		/finish responding/,
	);
	assert.throws(
		() =>
			buildPathSummaryInput(
				[root],
				history().map((turn) => (turn.id === "a1" ? { ...turn, status: "interrupted" } : turn)),
				["u3"],
			),
		/interrupted/,
	);
});

test("summary roots have separate provenance edges, stay distinct in lists, and seed only compressed continuation", () => {
	const summary: SessionNode = { ...root, id: "summary" };
	const source = buildPathSummaryInput([root], history(), ["u3"]).sources[0];
	const summaryUser: Turn = {
		...message("summary-u", "user", "summary"),
		pathSummary: {
			sources: [source],
			createdAt: "now",
			model: { providerId: "codex", modelId: "" },
		},
	};
	const turns = [
		...history(),
		summaryUser,
		{ ...message("summary-a", "assistant", "summary"), content: "Compressed answer" },
		message("next-u", "user", "summary"),
	];
	const graph = projectConversationGraph([root, summary], turns);
	assert.deepEqual(graph.paths.get("summary"), ["summary-u", "next-u"]);
	assert.deepEqual(summarySourceEdges(graph.rounds), [{ source: "u3", target: "summary-u" }]);
	assert.deepEqual(
		filterConversationRounds(
			graph.rounds,
			[
				{ ...root, progressStatus: "complete" },
				{ ...summary, progressStatus: "todo" },
			],
			["todo"],
		).map((round) => round.id),
		["summary-u", "next-u"],
		"provenance does not change ordinary leaf filtering",
	);
	assert.equal(
		projectConversationTree([root, summary], turns).nodes.filter(
			(node) => node.sessionId === "summary",
		).length,
		2,
	);
	const transcript = buildAgentTranscriptBeforeTurn(turns, "summary", "next-u");
	assert.deepEqual(
		transcript.map((turn) => turn.id),
		["summary-u", "summary-a"],
	);
	assert.doesNotMatch(JSON.stringify(transcript), /u3 visible|PRIVATE/);
	const deleted = projectConversationGraph(
		[summary],
		turns.filter((turn) => turn.sessionId === "summary"),
	);
	assert.deepEqual(summarySourceEdges(deleted.rounds), []);
	assert.equal(deleted.rounds[0].user?.pathSummary?.sources[0].title, source.title);
	assert.deepEqual(
		buildPathSummaryInput([root, summary], turns, ["next-u"]).rounds.map((round) => round.id),
		["summary-u", "next-u"],
	);
});

test("IPC validation projects only allowed message fields and rejects duplicate or invalid paths", () => {
	const request = requestFor("Hello");
	const valid = validatePathSummaryRequest({
		...request,
		rounds: [
			{
				...request.rounds[0],
				messages: [{ ...request.rounds[0].messages[0], reasoning: "PRIVATE" }],
			},
		],
	});
	assert.doesNotMatch(JSON.stringify(valid), /PRIVATE/);
	assert.throws(
		() =>
			validatePathSummaryRequest({ ...request, rounds: [request.rounds[0], request.rounds[0]] }),
		/duplicate/,
	);
	assert.throws(
		() =>
			validatePathSummaryRequest({
				...request,
				paths: [{ id: "u", title: "", roundIds: ["missing"] }],
			}),
		/Invalid summary path/,
	);
	assert.throws(
		() =>
			validatePathSummaryRequest({
				...request,
				rounds: [{ id: "u", messages: [{ id: "tool", role: "tool", content: "result" }] }],
			}),
		/user and assistant/,
	);
});

test("small contexts use one request and truncated responses retry instead of succeeding", async () => {
	const prompts: string[] = [];
	const completion: PathSummaryCompletion = {
		contextWindow: 8192,
		maxTokens: 1024,
		complete: async (prompt) => {
			prompts.push(prompt);
			return {
				text: prompts.length === 1 ? "truncated" : `# Summary\nDone\n${summaryCompletionMarker}`,
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
			};
		},
	};
	const result = await summarizeConversationPaths(
		requestFor("Question and answer"),
		completion,
		new AbortController().signal,
		() => {},
	);
	assert.equal(result.content, "# Summary\nDone");
	assert.equal(prompts.length, 2);
	assert.equal(result.usage?.cost, 0.02);
	assert.ok(prompts.every((prompt) => summaryTokenEstimate(prompt) + 1024 < 8192));
});

test("long Unicode messages are fully chunked, merged recursively, and every request fits its window", async () => {
	const original = "共享路径和分支结论。\n".repeat(1000);
	const prompts: string[] = [];
	const progress: number[] = [];
	const completion: PathSummaryCompletion = {
		contextWindow: 4096,
		maxTokens: 512,
		complete: async (prompt) => {
			prompts.push(prompt);
			return { text: `# Summary\nShort branch facts.\n${summaryCompletionMarker}` };
		},
	};
	const result = await summarizeConversationPaths(
		requestFor(original),
		completion,
		new AbortController().signal,
		(event) => progress.push(event.level),
	);
	assert.equal(result.error, undefined);
	assert.ok(prompts.length > 2);
	assert.ok(progress.some((level) => level > 0));
	assert.ok(prompts.every((prompt) => summaryTokenEstimate(prompt) + 512 + 410 < 4096));
	const mapped = prompts
		.filter((prompt) => prompt.includes('"content":'))
		.flatMap((prompt) =>
			prompt
				.split("\n\n")
				.filter((unit) => unit.startsWith("{"))
				.map((unit) => JSON.parse(unit) as { content: string }),
		);
	assert.equal(mapped.map((unit) => unit.content).join(""), original);
});

test("context errors lower budgets and cancellation/error preserve usage without a success-shaped result", async () => {
	const controller = new AbortController();
	let calls = 0;
	const completion: PathSummaryCompletion = {
		contextWindow: 8192,
		maxTokens: 1024,
		complete: async () => {
			calls++;
			if (calls === 1)
				return {
					text: "",
					error: "Maximum context window exceeded",
					usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
				};
			return { text: `Short\n${summaryCompletionMarker}` };
		},
	};
	const recovered = await summarizeConversationPaths(
		requestFor("Question".repeat(300)),
		completion,
		controller.signal,
		() => {},
	);
	assert.ok(recovered.content);
	assert.equal(recovered.usage?.cost, 0.01);
	assert.ok(calls > 1);
	const canceled = await summarizeConversationPaths(
		requestFor("Question"),
		{
			...completion,
			complete: async () => {
				controller.abort();
				return {
					text: "Partial",
					usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.02 },
				};
			},
		},
		controller.signal,
		() => {},
	);
	assert.equal(canceled.canceled, true);
	assert.equal(canceled.content, undefined);
	assert.equal(canceled.usage?.cost, 0.02);
});

test("summary creation, persistence, forks, and source deletion keep one independently owned snapshot and usage", () => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalState = useAppStore.getState();
	let saved: string | null = null;
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: () => saved,
				setItem: (_name: string, value: string) => {
					saved = value;
				},
				removeItem: () => {
					saved = null;
				},
			},
		},
	});
	try {
		useAppStore.setState({
			sessions: [root],
			turns: history(),
			activeSessionId: root.id,
			visibleSessionId: root.id,
		});
		const snapshot = {
			sources: buildPathSummaryInput([root], history(), ["u3"]).sources,
			createdAt: "now",
			model: { providerId: "codex" as const, modelId: "" },
		};
		const usage = { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.01 };
		const id = useAppStore
			.getState()
			.createSummarySession("# Summary\nConclusions", snapshot, usage);
		assert.equal(useAppStore.getState().activeSessionId, root.id);
		loadWorkspaceState(saved);
		let state = useAppStore.getState();
		assert.equal(
			state.turns.find((turn) => turn.sessionId === id && turn.role === "user")?.pathSummary
				?.sources.length,
			1,
		);
		assert.equal(allocateBranchUsage(state.sessions, state.turns).total.cost, 0.01);
		const answer = state.turns.find((turn) => turn.sessionId === id && turn.role === "assistant")!;
		state.addSessionSummaryUsage(id, usage);
		state.addManualTurn(message("continued-u", "user", id));
		const forkId = useAppStore.getState().forkNode(id, answer.id);
		assert.ok(forkId);
		state = useAppStore.getState();
		assert.equal(
			allocateBranchUsage(state.sessions, state.turns).total.cost,
			0.02,
			"forks do not duplicate summary generation or failure costs",
		);
		state.deleteSession("root");
		state = useAppStore.getState();
		assert.ok(state.sessions.some((session) => session.id === id));
		assert.equal(
			state.turns.find((turn) => turn.sessionId === id)?.pathSummary?.sources[0].roundId,
			"u3",
		);
		assert.equal(
			summarySourceEdges(projectConversationGraph(state.sessions, state.turns).rounds).length,
			0,
		);
	} finally {
		useAppStore.setState(originalState, true);
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});
