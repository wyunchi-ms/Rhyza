import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Reuse({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="reuse">
			<Sequence name="20-entity-hover · 悬停下划线，先看概念摘要" from={0} durationInFrames={420}>
				<Shot id="20-entity-hover" directorMode={directorMode} />
			</Sequence>
			<Sequence name="21-diagram-link · 图表也能从正文直接打开" from={420} durationInFrames={420}>
				<Shot id="21-diagram-link" directorMode={directorMode} />
			</Sequence>
			<Sequence name="22-mention-reuse · 新问题继续引用已有结论" from={840} durationInFrames={420}>
				<Shot id="22-mention-reuse" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
