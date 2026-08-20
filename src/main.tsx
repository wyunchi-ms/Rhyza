import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { setWorkspacePersistencePath, useAppStore } from "./store";
import { installTauriBridge } from "./tauriBridge";

async function bootstrap(): Promise<void> {
	await installTauriBridge();
	if (window.knowbranch) {
		const workspace = await window.knowbranch.getWorkspace();
		setWorkspacePersistencePath(workspace.path);
	}
	await useAppStore.persist.rehydrate();
	useAppStore.getState().pruneLegacyDiagrams();
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}

void bootstrap();
