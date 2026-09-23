import { VideoShell } from "./components/VideoShell";
import { chapterStartFrame, type VideoProps } from "./model";
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

export function ChapterPreview(props: VideoProps & { chapterId: string }) {
	const scenes: Record<string, React.ReactNode> = {
		intro: <Intro />,
		sources: <Sources directorMode={props.directorMode} />,
		branching: <Branching directorMode={props.directorMode} />,
		views: <Views directorMode={props.directorMode} />,
		filtering: <Filtering directorMode={props.directorMode} />,
		reading: <Reading directorMode={props.directorMode} />,
		knowledge: <Knowledge directorMode={props.directorMode} />,
		reuse: <Reuse directorMode={props.directorMode} />,
		changes: <Changes directorMode={props.directorMode} />,
		settings: <Settings directorMode={props.directorMode} />,
		outro: <Outro />,
	};
	return (
		<VideoShell {...props} offsetFrames={chapterStartFrame(props.chapterId)}>
			{scenes[props.chapterId]}
		</VideoShell>
	);
}
