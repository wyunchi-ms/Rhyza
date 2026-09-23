import { Composition, Folder } from "remotion";
import { ChapterPreview } from "./ChapterPreview";
import { Walkthrough } from "./Walkthrough";

export function Root() {
	return (
		<>
			<Composition
				id="Rhyza-Walkthrough"
				component={Walkthrough}
				durationInFrames={11400}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{
					directorMode: true,
					showCaptions: true,
					voiceoverFile: "audio/narration.wav",
				}}
			/>
			<Composition
				id="Rhyza-Clean"
				component={Walkthrough}
				durationInFrames={11400}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{
					directorMode: false,
					showCaptions: true,
					voiceoverFile: "audio/narration.wav",
				}}
			/>
			<Folder name="Chapters">
				<Composition
					id="00-intro"
					component={ChapterPreview}
					durationInFrames={900}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "intro",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="01-sources"
					component={ChapterPreview}
					durationInFrames={720}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "sources",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="02-branching"
					component={ChapterPreview}
					durationInFrames={1920}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "branching",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="03-views"
					component={ChapterPreview}
					durationInFrames={1560}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "views",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="04-filtering"
					component={ChapterPreview}
					durationInFrames={1080}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "filtering",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="05-reading"
					component={ChapterPreview}
					durationInFrames={1200}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "reading",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="06-knowledge"
					component={ChapterPreview}
					durationInFrames={780}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "knowledge",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="07-reuse"
					component={ChapterPreview}
					durationInFrames={1260}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "reuse",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="08-changes"
					component={ChapterPreview}
					durationInFrames={840}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "changes",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="09-settings"
					component={ChapterPreview}
					durationInFrames={720}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "settings",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
				<Composition
					id="10-outro"
					component={ChapterPreview}
					durationInFrames={420}
					fps={30}
					width={1920}
					height={1080}
					defaultProps={{
						chapterId: "outro",
						directorMode: true,
						showCaptions: true,
						voiceoverFile: "audio/narration.wav",
					}}
				/>
			</Folder>
		</>
	);
}
