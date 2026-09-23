import { useEffect, useState } from "react";
import { getRemotionEnvironment, getStaticFiles, watchStaticFile } from "remotion";

export function useHasAsset(file: string) {
	const [available, setAvailable] = useState(() =>
		getStaticFiles().some((item) => item.name === file),
	);
	useEffect(() => {
		setAvailable(getStaticFiles().some((item) => item.name === file));
		if (!getRemotionEnvironment().isStudio) return;
		const watcher = watchStaticFile(file, (next) => setAvailable(next !== null));
		return () => watcher.cancel();
	}, [file]);
	return available;
}
