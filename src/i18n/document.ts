import { useAppStore } from "../store";
import type { Language } from "./language";

function applyDocumentLanguage(language: Language): void {
	document.documentElement.lang = language;
	document.title = "Rhyza";
}

export function startDocumentLocalization(): () => void {
	applyDocumentLanguage(useAppStore.getState().settings.language);
	return useAppStore.subscribe((current, previous) => {
		if (current.settings.language !== previous.settings.language) {
			applyDocumentLanguage(current.settings.language);
		}
	});
}
