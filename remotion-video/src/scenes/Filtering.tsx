import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Filtering({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="filtering">
			<Sequence name="12-mark-status · 给探索进度做标记" from={0} durationInFrames={300}>
				<Shot id="12-mark-status" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="13-filter-completed · 只留下现在还要看的路径"
				from={300}
				durationInFrames={480}
			>
				<Shot id="13-filter-completed" directorMode={directorMode} />
			</Sequence>
			<Sequence name="14-filter-restore · 隐藏不是删除，随时恢复" from={780} durationInFrames={300}>
				<Shot id="14-filter-restore" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
