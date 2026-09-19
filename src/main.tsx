import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { setWorkspacePersistencePath, useAppStore } from "./store";

async function bootstrap(): Promise<void> {
	if (window.rhyza) {
		const workspace = await window.rhyza.getWorkspace();
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
