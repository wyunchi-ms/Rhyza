import { useAppStore } from "../store";
import type { Language } from "./language";

const titles: Record<Language, string> = {
	"zh-CN": "Rhyza - 知识工作区",
	"zh-TW": "Rhyza - 知識工作區",
	en: "Rhyza - Knowledge Workspace",
};

function applyDocumentLanguage(language: Language): void {
	document.documentElement.lang = language;
	document.title = titles[language];
}

export function startDocumentLocalization(): () => void {
	applyDocumentLanguage(useAppStore.getState().settings.language);
	return useAppStore.subscribe((current, previous) => {
		if (current.settings.language !== previous.settings.language) {
			applyDocumentLanguage(current.settings.language);
		}
	});
}
