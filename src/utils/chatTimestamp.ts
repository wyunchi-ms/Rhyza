const timeOptions: Intl.DateTimeFormatOptions = {
	hour: "2-digit",
	minute: "2-digit",
};

export function formatChatTimestamp(
	timestamp: string,
	options: { now?: Date; locale?: string; timeZone?: string } = {},
): string {
	const value = new Date(timestamp);
	if (!Number.isFinite(value.getTime())) return "";
	const now = options.now ?? new Date();
	const locale = options.locale;
	const timeZone = options.timeZone;
	const dateParts = dateKey(value, locale, timeZone);
	const todayParts = dateKey(now, locale, timeZone);
	const sameDay = dateParts === todayParts;
	const sameYear = value.toLocaleDateString(locale, { year: "numeric", timeZone })
		=== now.toLocaleDateString(locale, { year: "numeric", timeZone });

	return new Intl.DateTimeFormat(locale, {
		...(sameDay
			? {}
			: {
				month: "short",
				day: "numeric",
				...(sameYear ? {} : { year: "numeric" as const }),
			}),
		...timeOptions,
		timeZone,
	}).format(value);
}

export function formatFullChatTimestamp(
	timestamp: string,
	options: { locale?: string; timeZone?: string } = {},
): string {
	const value = new Date(timestamp);
	if (!Number.isFinite(value.getTime())) return "";
	return new Intl.DateTimeFormat(options.locale, {
		dateStyle: "medium",
		timeStyle: "medium",
		timeZone: options.timeZone,
	}).format(value);
}

function dateKey(value: Date, locale?: string, timeZone?: string): string {
	return value.toLocaleDateString(locale, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		timeZone,
	});
}
