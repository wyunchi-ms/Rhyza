import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Changes({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="changes">
			<Sequence name="23-edit-request · 只做一个范围明确的修改" from={0} durationInFrames={420}>
				<Shot id="23-edit-request" directorMode={directorMode} />
			</Sequence>
			<Sequence name="24-diff-export · 确认路径，检查 Diff" from={420} durationInFrames={420}>
				<Shot id="24-diff-export" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
