import storyboard from "./data/storyboard.json";
import media from "./data/media.json";

export const project = storyboard;
export const totalFrames = project.chapters.reduce(
	(sum, chapter) => sum + chapter.seconds * project.fps,
	0,
);

export type VideoProps = {
	directorMode: boolean;
	showCaptions: boolean;
	voiceoverFile: string;
};

export function chapterById(id: string) {
	const chapter = project.chapters.find((item) => item.id === id);
	if (!chapter) throw new Error(`Unknown chapter: ${id}`);
	return chapter;
}

export function chapterStartFrame(id: string) {
	let start = 0;
	for (const chapter of project.chapters) {
		if (chapter.id === id) return start;
		start += chapter.seconds * project.fps;
	}
	throw new Error(`Unknown chapter: ${id}`);
}

export function shotById(id: string) {
	const shot = project.chapters.flatMap((chapter) => chapter.shots).find((item) => item.id === id);
	if (!shot) throw new Error(`Unknown shot: ${id}`);
	return shot;
}

export function mediaById(id: string) {
	const entry = media[id as keyof typeof media];
	if (!entry) throw new Error(`Missing media mapping: ${id}`);
	return entry;
}

export function timecode(seconds: number) {
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, "0")}:${Math.floor(seconds % 60)
		.toString()
		.padStart(2, "0")}`;
}
