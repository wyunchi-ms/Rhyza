import { TransitionSeries } from "@remotion/transitions";
import { VideoShell } from "./components/VideoShell";
import type { VideoProps } from "./model";
import { Intro } from "./scenes/Intro";
import { Sources } from "./scenes/Sources";
import { Branching } from "./scenes/Branching";
import { Views } from "./scenes/Views";
import { Filtering } from "./scenes/Filtering";
import { Reading } from "./scenes/Reading";
import { Knowledge } from "./scenes/Knowledge";
import { Reuse } from "./scenes/Reuse";
import { Changes } from "./scenes/Changes";
import { Settings } from "./scenes/Settings";
import { Outro } from "./scenes/Outro";

export function Walkthrough(props: VideoProps) {
	return (
		<VideoShell {...props}>
			<TransitionSeries>
				<TransitionSeries.Sequence name="00 · 让对话跟得上发散的思路" durationInFrames={900}>
					<Intro />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="01 · 用一个真实项目开始" durationInFrames={720}>
					<Sources directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="02 · 问题先分出去，阅读继续" durationInFrames={1920}>
					<Branching directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="03 · 同一条思路，两种看法" durationInFrames={1560}>
					<Views directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="04 · 把已经探索完的支线收起来" durationInFrames={1080}>
					<Filtering directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="05 · 让长回答更容易读" durationInFrames={1200}>
					<Reading directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="06 · 把研究结论沉淀下来" durationInFrames={780}>
					<Knowledge directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="07 · 下划线，把回答和知识连起来" durationInFrames={1260}>
					<Reuse directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="08 · 顺手检查一次代码修改" durationInFrames={840}>
					<Changes directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="09 · 选择适合自己的服务和外观" durationInFrames={720}>
					<Settings directorMode={props.directorMode} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Sequence name="10 · 让对话跟随思考展开" durationInFrames={420}>
					<Outro />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		</VideoShell>
	);
}
