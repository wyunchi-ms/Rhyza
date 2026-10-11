import clsx from "clsx";
import { ArrowLeft, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";

export const settingsCategories = [
	{ id: "language-heading", label: "Language", terms: ["language", "语言", "語言"] },
	{ id: "plugins-heading", label: "Pi plugins", terms: ["plugin", "package", "插件", "软件包"] },
	{ id: "appearance-heading", label: "Appearance", terms: ["appearance", "theme", "外观", "主题"] },
	{
		id: "provider-heading",
		label: "AI provider",
		terms: ["provider", "model", "azure", "服务", "模型"],
	},
	{
		id: "workspace-heading",
		label: "Workspace",
		terms: ["workspace", "worktree", "git", "工作区", "对话"],
	},
	{
		id: "knowledge-heading",
		label: "Knowledge policy",
		terms: ["knowledge", "thinking", "知识", "思考"],
	},
	{
		id: "accessibility-heading",
		label: "Accessibility",
		terms: ["accessibility", "motion", "font", "辅助", "字体"],
	},
] as const;

export function matchesSettingsSearch(query: string, terms: readonly string[]): boolean {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return (
		!normalizedQuery || terms.some((term) => term.toLocaleLowerCase().includes(normalizedQuery))
	);
}

type SettingsNavigationProps = {
	query: string;
	selectedSection: string | undefined;
	visibleCategories: readonly (typeof settingsCategories)[number][];
	onQueryChange: (query: string) => void;
	onSelect: (id: string) => void;
};

export function SettingsNavigation({
	query,
	selectedSection,
	visibleCategories,
	onQueryChange,
	onSelect,
}: SettingsNavigationProps) {
	const { t } = useTranslation();

	return (
		<aside className="settings-navigation" aria-label={t("Settings")}>
			<Link className="settings-back" to="/">
				<ArrowLeft size={16} aria-hidden="true" />
				{t("Back to app")}
			</Link>
			<p className="settings-navigation-heading">{t("Settings")}</p>
			<label className="settings-search">
				<Search size={15} aria-hidden="true" />
				<input
					type="search"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="Search settings…"
					aria-label="Search settings sections"
				/>
			</label>
			<nav aria-label={t("Settings")}>
				{visibleCategories.length > 0 ? (
					visibleCategories.map((category) => (
						<button
							key={category.id}
							type="button"
							className={clsx(selectedSection === category.id && "is-active")}
							aria-current={selectedSection === category.id ? "location" : undefined}
							onClick={() => onSelect(category.id)}
						>
							{t(category.label)}
						</button>
					))
				) : (
					<p className="settings-navigation-empty" role="status">
						No matching settings sections
					</p>
				)}
			</nav>
		</aside>
	);
}
