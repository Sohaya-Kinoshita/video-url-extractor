import {
  getDownloadFileName,
  validateDownloadUrl,
} from "../../src/extractor.js";

export async function onRequestGet({ request }) {
  try {
    const requestUrl = new URL(request.url);
    const targetUrl = validateDownloadUrl(requestUrl.searchParams.get("url"));
    const response = await fetch(targetUrl, {
      headers: {
        Accept: "video/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      },
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      return new Response("ファイルの取得に失敗しました。", { status: 502 });
    }

    const headers = new Headers(response.headers);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${getDownloadFileName(targetUrl)}"`,
    );
    headers.set("Cache-Control", "no-store");
    headers.delete("Content-Encoding");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return new Response(error.message || "保存用URLを確認できませんでした。", {
      status: error.status || 400,
    });
  }
}
