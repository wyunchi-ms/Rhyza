import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMermaidDiagramCandidates, isDurableKnowledgeEntityCandidate, PiService } from "../electron/main/pi-service.js";
import {
	validateAgentPromptRequest,
	validateModelCatalogRequest,
	validateProviderStatusRequest,
	validateSummaryRequest,
	validateKnowledgeExtractionRequest,
	validateOpenExternalRequest,
	validateAppStateSaveRequest,
} from "../src/shared/ipc.js";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "knowbranch-ipc-smoke-"));

try {
	const service = new PiService(
		tempRoot,
		undefined,
		undefined,
		path.join(tempRoot, "pi-agent"),
	);

	assertThrows(() => validateProviderStatusRequest({ providerId: "openai" }));
	assertThrows(() => validateAgentPromptRequest({ prompt: "missing workspace" }));
	const imageOnlyPrompt = validateAgentPromptRequest({
		frontendSessionId: "image-session",
		prompt: "",
		images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
		transcript: [{ id: "image-turn", role: "user", content: "", images: [{ mimeType: "image/png", data: "aGVsbG8=" }] }],
	});
	assert(imageOnlyPrompt.images?.length === 1, "An image-only prompt must retain its attachment.");
	assert(imageOnlyPrompt.transcript[0]?.images?.length === 1, "Transcript attachments must survive validation.");
	validateProviderStatusRequest({ providerId: "github-copilot" });
	validateModelCatalogRequest({ providerId: "github-copilot", refresh: false });
	validateSummaryRequest({ text: "How does the session tree work?" });
	assertThrows(() => validateSummaryRequest({ text: "" }));
	validateKnowledgeExtractionRequest({
		question: "What is a worktree?",
		answer: "A worktree is an additional checkout.",
		existingEntities: [],
		existingDiagrams: [],
	});
	assertThrows(() => validateKnowledgeExtractionRequest({ question: "", answer: "x", existingEntities: [], existingDiagrams: [] }));
	validateOpenExternalRequest({ url: "https://github.com/login/device" });
	assertThrows(() => validateOpenExternalRequest({ url: "file:///etc/passwd" }));
	validateAppStateSaveRequest({ value: "{}", workspacePath: tempRoot });
	assertThrows(() => validateAppStateSaveRequest({ value: "{}" }));
	const diagramCandidates = extractMermaidDiagramCandidates({
		question: "Explain the architecture",
		answer: [
			"## Request flow",
			"```mermaid",
			"sequenceDiagram",
			"  participant U as User",
			"  U->>API: Request",
			"```",
			"## Top-level structure",
			"```mermaid",
			"flowchart TD",
			"  CLI[OpenCode CLI] --> Server[HTTP Server]",
			"```",
		].join("\n"),
		existingEntities: [],
		existingDiagrams: [],
	});
	assert(diagramCandidates.length === 2, "Every Mermaid block must produce a deterministic diagram candidate.");
	assert(diagramCandidates[0]?.name === "Request flow" && diagramCandidates[0].nodes.length === 2, "Sequence diagram fallback was not parsed.");
	assert(diagramCandidates[1]?.name === "Top-level structure" && diagramCandidates[1].edges.length === 1, "Flowchart fallback was not parsed.");
	assert(!isDurableKnowledgeEntityCandidate("OpenCode 架构", "Technology"), "A project architecture view must not become an entity.");
	assert(!isDurableKnowledgeEntityCandidate("OpenCode Core 与 Legacy 服务边界", "Pattern"), "A relationship title must not become an entity.");
	assert(!isDurableKnowledgeEntityCandidate("OpenCode 协议适配层", "Pattern"), "An explanatory layer must not become an entity.");
	assert(!isDurableKnowledgeEntityCandidate("登录流程", "Concept"), "A flow title must not become an entity.");
	assert(isDurableKnowledgeEntityCandidate("OpenCode", "Technology"), "A named product should remain eligible as an entity.");
	assert(isDurableKnowledgeEntityCandidate("Agent Loop", "Pattern"), "An established technical concept should remain eligible as an entity.");
	assert(isDurableKnowledgeEntityCandidate("Hexagonal Architecture", "Pattern"), "An established architecture pattern should remain eligible as an entity.");

	const status = await service.getProviderStatus("github-copilot");
	if (status.providerId !== "github-copilot") {
		throw new Error("Provider status returned the wrong provider id.");
	}

	const catalog = await service.getModelCatalog({
		providerId: "github-copilot",
		refresh: false,
	});
	if (!Array.isArray(catalog.models)) {
		throw new Error("Model catalog did not return an array.");
	}

	console.log(
		`IPC smoke passed: configured=${status.configured}, models=${catalog.models.length}`,
	);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

function assertThrows(action: () => unknown): void {
	let threw = false;
	try {
		action();
	} catch {
		threw = true;
	}
	if (!threw) {
		throw new Error("Expected validation to reject invalid input.");
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
