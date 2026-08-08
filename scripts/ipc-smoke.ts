import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PiService } from "../electron/main/pi-service.js";
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
