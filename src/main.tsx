import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./interface.css";
import "./pages/library-pages.css";
import "./pages/settings-page.css";
import { setWorkspacePersistencePath, useAppStore } from "./store";
import { startDocumentLocalization } from "./i18n/document";

async function bootstrap(): Promise<void> {
	if (window.rhyza) {
		const workspace = await window.rhyza.getWorkspace();
		setWorkspacePersistencePath(workspace.path);
	}
	await useAppStore.persist.rehydrate();
	startDocumentLocalization();
	useAppStore.getState().pruneLegacyDiagrams();
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}

void bootstrap();
