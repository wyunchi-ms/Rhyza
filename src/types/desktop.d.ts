import type { KnowbranchBridge } from "../shared/ipc";

declare global {
	interface Window {
		knowbranch?: KnowbranchBridge;
	}
}

export {};
