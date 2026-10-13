import path from "node:path";
import { workerData } from "node:worker_threads";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { CodexAppServer } from "../../dist-electron/electron/main/codex-app-server.js";

const runtime = await ModelRuntime.create({
	authPath: path.join(workerData.agentDir, "auth.json"),
	modelsPath: path.join(workerData.agentDir, "models.json"),
	modelsStorePath: path.join(workerData.agentDir, "models-store.json"),
	allowModelNetwork: false,
});
const faux = fauxProvider({
	provider: "github-copilot",
	api: "openai-responses",
	models: [{ id: "worker-fixture" }],
});
faux.setResponses([
	fauxAssistantMessage("Worker answer"),
	fauxAssistantMessage("Continued worker answer"),
]);
runtime.registerNativeProvider(faux.provider);
ModelRuntime.create = async () => runtime;
CodexAppServer.prototype.account = async () => null;
await import("../../dist-electron/electron/main/backend-worker.js");
