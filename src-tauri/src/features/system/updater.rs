//! Reuse the official updater resource for one direct-download retry.

use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::Update;

fn fallback_url(
    api: &tauri::Url,
    signature: &str,
    manifest: &serde_json::Value,
) -> Option<tauri::Url> {
    let entry = manifest
        .get("platforms")?
        .as_object()?
        .values()
        .find(|entry| {
            entry.get("url").and_then(|v| v.as_str()) == Some(api.as_str())
                && entry.get("signature").and_then(|v| v.as_str()) == Some(signature)
        })?;
    let fallback = tauri::Url::parse(entry.get("fallback_url")?.as_str()?).ok()?;
    // Only fall back from GitHub's asset API to the same repository's release files.
    let repo = api
        .path()
        .strip_prefix("/repos/")?
        .split("/releases/assets/")
        .next()?;
    if api.scheme() != "https"
        || api.host_str() != Some("api.github.com")
        || !api.path().contains("/releases/assets/")
        || fallback.scheme() != "https"
        || fallback.host_str() != Some("github.com")
        || !fallback
            .path()
            .starts_with(&format!("/{repo}/releases/download/"))
        || !fallback.username().is_empty()
        || fallback.password().is_some()
    {
        return None;
    }
    Some(fallback)
}

#[tauri::command]
#[specta::specta]
pub fn updater_download_fallback(
    webview: Webview,
    rid: ResourceId,
) -> Result<Option<ResourceId>, String> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    let Some(url) = fallback_url(&update.download_url, &update.signature, &update.raw_json) else {
        return Ok(None);
    };
    let mut retry = (*update).clone();
    retry.download_url = url;
    // Signature, selected platform, proxy and installer context stay unchanged.
    Ok(Some(webview.resources_table().add(retry)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fallback_matches_selected_asset_and_signature() {
        let api =
            tauri::Url::parse("https://api.github.com/repos/poco-ai/Agentero/releases/assets/123")
                .unwrap();
        let direct = "https://github.com/poco-ai/Agentero/releases/download/v1/app.exe";
        let manifest = json!({"platforms": {
            "other-platform": {"url": "https://example.com/other", "signature": "other", "fallback_url": "https://example.com/other"},
            "windows-x86_64-nsis": {"url": api.as_str(), "signature": "signed", "fallback_url": direct}
        }});
        assert_eq!(
            fallback_url(&api, "signed", &manifest).unwrap().as_str(),
            direct
        );
        assert!(fallback_url(&api, "wrong-signature", &manifest).is_none());
        assert!(fallback_url(&tauri::Url::parse(direct).unwrap(), "signed", &manifest).is_none());
        assert!(fallback_url(&api, "signed", &json!({})).is_none());
    }

    #[test]
    fn fallback_rejects_unrelated_or_insecure_urls() {
        let api =
            tauri::Url::parse("https://api.github.com/repos/poco-ai/Agentero/releases/assets/123")
                .unwrap();
        for direct in [
            "http://github.com/poco-ai/Agentero/releases/download/v1/app.exe",
            "https://example.com/poco-ai/Agentero/releases/download/v1/app.exe",
            "https://github.com/other/repo/releases/download/v1/app.exe",
            "https://github.com/poco-ai/Agentero/issues/1",
        ] {
            let manifest = json!({"platforms": {"windows": {"url": api.as_str(), "signature": "signed", "fallback_url": direct}}});
            assert!(fallback_url(&api, "signed", &manifest).is_none());
        }
    }
}
