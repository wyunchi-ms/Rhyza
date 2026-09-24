import { useCallback } from "react";
import { useAppStore } from "../store";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import type { Language } from "./language";

export type MessageKey = keyof typeof zhCN;
export type { Language } from "./language";

const translations: Record<Exclude<Language, "en">, Record<MessageKey, string>> = {
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};

export function translate(language: Language, message: MessageKey): string {
	return language === "en" ? message : translations[language][message];
}

export function useTranslation(): {
	language: Language;
	t: (message: MessageKey) => string;
} {
	const language = useAppStore((state) => state.settings.language);
	const t = useCallback((message: MessageKey) => translate(language, message), [language]);
	return { language, t };
}
