import assert from "node:assert/strict";
import test from "node:test";
import { addUpdaterFallbacks } from "./updater-fallback-manifest.mjs";

const asset = {
	url: "https://api.github.com/repos/example/app/releases/assets/123",
	browser_download_url:
		"https://github.com/example/app/releases/download/v1/app.exe",
};
test("preserves API URLs, signatures and platform aliases, with matching direct URLs", () => {
	const entry = { url: asset.url, signature: "signature" };
	const manifest = {
		version: "1.0.0",
		platforms: { windows: entry, nsis: entry },
	};
	const result = addUpdaterFallbacks(manifest, [asset]);
	assert.deepEqual(result, {
		...manifest,
		platforms: Object.fromEntries(
			Object.keys(manifest.platforms).map((key) => [
				key,
				{ ...entry, fallback_url: asset.browser_download_url },
			]),
		),
	});
	assert.equal(entry.fallback_url, undefined);
	assert.deepEqual(addUpdaterFallbacks(result, [asset]), result);
});
test("fails for empty manifests, missing assets or signatures", () => {
	assert.throws(() => addUpdaterFallbacks({ platforms: {} }, [asset]));
	assert.throws(() =>
		addUpdaterFallbacks(
			{ platforms: { windows: { url: asset.url, signature: "signature" } } },
			[],
		),
	);
	assert.throws(() =>
		addUpdaterFallbacks({ platforms: { windows: { url: asset.url } } }, [
			asset,
		]),
	);
});
