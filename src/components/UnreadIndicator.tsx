import { Bell } from "lucide-react";
import { useTranslation } from "../i18n";
import "./unreadIndicator.css";

export function UnreadIndicator() {
	const { t } = useTranslation();
	const label = t("New response, unread");
	return (
		<span className="session-unread-indicator" role="img" aria-label={label} title={label}>
			<Bell size={13} strokeWidth={2} aria-hidden="true" />
		</span>
	);
}
