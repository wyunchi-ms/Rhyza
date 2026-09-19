import type { RhyzaBridge } from "../shared/ipc";

declare global {
	interface Window {
		rhyza?: RhyzaBridge;
	}
}

export {};
