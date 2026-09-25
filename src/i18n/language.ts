export const languageOptions = [
	{ code: "zh-CN", label: "简体中文" },
	{ code: "zh-TW", label: "繁體中文" },
	{ code: "en", label: "English" },
] as const;

export type Language = (typeof languageOptions)[number]["code"];

export const defaultLanguage: Language = "zh-CN";

const languageStorageKey = "rhyza-language";

export function isLanguage(value: unknown): value is Language {
	return languageOptions.some((option) => option.code === value);
}

export function normalizeLanguage(value: unknown): Language {
	return isLanguage(value) ? value : defaultLanguage;
}

export function readLanguagePreference(): Language | null {
	try {
		const saved = window.localStorage.getItem(languageStorageKey);
		return isLanguage(saved) ? saved : null;
	} catch {
		return null;
	}
}

export function saveLanguagePreference(language: Language): void {
	try {
		window.localStorage.setItem(languageStorageKey, language);
	} catch {
		// Workspace state still persists the language when local storage is unavailable.
	}
}
