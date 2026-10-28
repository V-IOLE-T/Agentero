/** Preserve API-first downloads and attach the matching public asset URL. */
export function addUpdaterFallbacks(manifest, assets) {
	if (!manifest.platforms || !Object.keys(manifest.platforms).length) {
		throw new Error("Updater manifest has no platforms");
	}
	return {
		...manifest,
		platforms: Object.fromEntries(
			Object.entries(manifest.platforms).map(([platform, entry]) => {
				const asset = assets.find((candidate) => candidate.url === entry.url);
				if (!asset?.browser_download_url || !entry.signature) {
					throw new Error(`Missing API asset or signature for ${platform}`);
				}
				return [
					platform,
					{ ...entry, fallback_url: asset.browser_download_url },
				];
			}),
		),
	};
}
