import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Knowledge({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="knowledge">
			<Sequence
				name="18-organize-knowledge · 让结论变成可复用的知识"
				from={0}
				durationInFrames={360}
			>
				<Shot id="18-organize-knowledge" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="19-knowledge-library · 概念和图表留在同一个工作区"
				from={360}
				durationInFrames={420}
			>
				<Shot id="19-knowledge-library" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
