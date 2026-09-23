import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Reading({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="reading">
			<Sequence
				name="15-answer-outline · Outline：先看到回答的结构"
				from={0}
				durationInFrames={420}
			>
				<Shot id="15-answer-outline" directorMode={directorMode} />
			</Sequence>
			<Sequence name="16-outline-jump · 点目录，直接到关心的部分" from={420} durationInFrames={420}>
				<Shot id="16-outline-jump" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="17-section-collapse · 读过的章节折叠，需要时再展开"
				from={840}
				durationInFrames={360}
			>
				<Shot id="17-section-collapse" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
