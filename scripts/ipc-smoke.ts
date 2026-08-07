import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PiService } from "../electron/main/pi-service.js";
import {
	validateAgentPromptRequest,
	validateModelCatalogRequest,
	validateProviderStatusRequest,
} from "../src/shared/ipc.js";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "knowbranch-ipc-smoke-"));

try {
	const service = new PiService(tempRoot);

	assertThrows(() => validateProviderStatusRequest({ providerId: "openai" }));
	assertThrows(() => validateAgentPromptRequest({ prompt: "missing workspace" }));
	validateProviderStatusRequest({ providerId: "github-copilot" });
	validateModelCatalogRequest({ providerId: "github-copilot", refresh: false });

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
