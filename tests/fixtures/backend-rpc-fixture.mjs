import { parentPort, workerData } from "node:worker_threads";
import { WorkerRpc } from "../../dist-electron/electron/main/worker-rpc.js";

new WorkerRpc(parentPort, {
	initialize() {
		if (workerData.dataRoot === "startup-error") throw new Error("Fixture startup failed");
	},
	shutdown() {},
	getWorkspacePath() {
		process.exit(7);
	},
	stateLoad() {
		return new Promise(() => {});
	},
});
