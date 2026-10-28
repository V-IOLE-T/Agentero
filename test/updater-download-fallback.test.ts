import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	download: vi.fn(),
	install: vi.fn(),
	close: vi.fn(),
	check: vi.fn(),
	fallback: vi.fn(),
	relaunch: vi.fn(),
}));
vi.mock("@/lib/core/tauri", () => ({ isTauri: () => true }));
vi.mock("@/lib/core/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/settings/store", () => ({
	ensureSettingsLoaded: async () => ({
		networkProxyEnabled: true,
		networkProxyUrl: "http://localhost:7890",
	}),
}));
vi.mock("@/lib/core/bindings", () => ({
	commands: { updaterDownloadFallback: mocks.fallback },
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({
	check: mocks.check,
	Update: class {
		constructor(metadata: object) {
			Object.assign(this, metadata);
		}
		download = mocks.download;
		install = mocks.install;
		close = mocks.close;
	},
}));

describe("updater download fallback", () => {
	afterEach(() => vi.unstubAllEnvs());
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		vi.stubEnv("DEV", false);
		mocks.check.mockResolvedValue({
			rid: 1,
			currentVersion: "1.0.0",
			version: "2.0.0",
			rawJson: {},
			download: mocks.download,
			install: mocks.install,
			close: mocks.close,
		});
		mocks.fallback.mockResolvedValue({ status: "ok", data: 2 });
	});

	async function install() {
		const service = await import("@/lib/update/service");
		await service.checkForUpdate();
		return service.installAvailableUpdate();
	}

	it("uses only the API download when it succeeds", async () => {
		await install();
		expect(mocks.download).toHaveBeenCalledTimes(1);
		expect(mocks.fallback).not.toHaveBeenCalled();
		expect(mocks.install).toHaveBeenCalledTimes(1);
	});

	it("retries a failed download once using the fallback resource", async () => {
		mocks.download
			.mockRejectedValueOnce(new Error("403 Forbidden"))
			.mockResolvedValueOnce(undefined);
		await install();
		expect(mocks.fallback).toHaveBeenCalledWith(1);
		expect(mocks.download).toHaveBeenCalledTimes(2);
		expect(mocks.install).toHaveBeenCalledTimes(1);
		expect(mocks.relaunch).toHaveBeenCalledTimes(1);
	});

	it("reports an error when both download attempts fail", async () => {
		mocks.download.mockRejectedValue(new Error("network failure"));
		expect(await install()).toMatchObject({
			phase: "error",
			errorOperation: "install",
		});
		expect(mocks.download).toHaveBeenCalledTimes(2);
		expect(mocks.install).not.toHaveBeenCalled();
	});

	it("resets partial API download progress before retrying", async () => {
		const service = await import("@/lib/update/service");
		const progress: number[] = [];
		service.subscribeUpdate((snapshot) => {
			if (snapshot.phase === "downloading")
				progress.push(snapshot.downloadedBytes ?? 0);
		});
		mocks.download
			.mockImplementationOnce(
				async (onEvent: (event: DownloadEvent) => void) => {
					onEvent({ event: "Started", data: { contentLength: 100 } });
					onEvent({ event: "Progress", data: { chunkLength: 50 } });
					throw new Error("connection interrupted");
				},
			)
			.mockImplementationOnce(
				async (onEvent: (event: DownloadEvent) => void) => {
					onEvent({ event: "Started", data: { contentLength: 100 } });
					onEvent({ event: "Progress", data: { chunkLength: 100 } });
				},
			);
		await service.checkForUpdate();
		await service.installAvailableUpdate();
		expect(progress).toEqual([0, 0, 50, 0, 0, 100]);
	});

	it("does not retry old manifests without a fallback", async () => {
		mocks.download.mockRejectedValue(new Error("403 Forbidden"));
		mocks.fallback.mockResolvedValue({ status: "ok", data: null });
		expect(await install()).toMatchObject({ phase: "error" });
		expect(mocks.download).toHaveBeenCalledTimes(1);
	});

	it("does not retry installation failures", async () => {
		mocks.install.mockRejectedValue(new Error("installer failed"));
		expect(await install()).toMatchObject({ phase: "error" });
		expect(mocks.fallback).not.toHaveBeenCalled();
	});
});
