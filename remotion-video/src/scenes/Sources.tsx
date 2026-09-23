import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Sources({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="sources">
			<Sequence name="01-workspace · 一个项目，一个工作区" from={0} durationInFrames={180}>
				<Shot id="01-workspace" directorMode={directorMode} />
			</Sequence>
			<Sequence name="02-sources · 添加源码和文档" from={180} durationInFrames={180}>
				<Shot id="02-sources" directorMode={directorMode} />
			</Sequence>
			<Sequence name="03-first-question · 准备一篇有层次的回答" from={360} durationInFrames={360}>
				<Shot id="03-first-question" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
