const greetingWords = [
	"hi",
	"hello",
	"hey",
	"hiya",
	"yo",
	"你好",
	"您好",
	"嗨",
	"哈喽",
	"哈囉",
	"早上好",
	"下午好",
	"晚上好",
];

const greetingPattern = new RegExp(
	`^(?:${greetingWords.join("|")})(?:[\\s!！,.，。?？~～]+)?$`,
	"iu",
);

/** Keep pure greetings out of retrieval and knowledge-maintenance pipelines. */
export function isLightweightGreeting(
	prompt: string,
	options: { hasImages?: boolean; hasSelection?: boolean } = {},
): boolean {
	if (options.hasImages || options.hasSelection) return false;
	return greetingPattern.test(prompt.trim());
}
