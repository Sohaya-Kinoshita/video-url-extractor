from app.extractor import extract_video_urls


def test_extracts_video_and_source_urls():
    html = """
    <html>
      <body>
        <video src="/media/clip.mp4"></video>
        <video>
          <source src="https://cdn.example.com/live/stream.m3u8?token=abc" />
        </video>
      </body>
    </html>
    """

    results = extract_video_urls(html, "https://example.com/watch/1")
    urls = {result["url"] for result in results}

    assert "https://example.com/media/clip.mp4" in urls
    assert "https://cdn.example.com/live/stream.m3u8?token=abc" in urls


def test_extracts_escaped_urls_from_inline_json():
    html = """
    <script>
      window.__PLAYER__ = {"file":"https:\\/\\/cdn.example.com\\/movie\\/index.m3u8"};
    </script>
    """

    results = extract_video_urls(html, "https://example.com/page")

    assert results == [
        {
            "url": "https://cdn.example.com/movie/index.m3u8",
            "kind": "hls",
            "source": "HTML text scan",
        }
    ]


def test_extracts_embed_urls():
    html = '<iframe src="https://player.example.com/embed/123"></iframe>'

    results = extract_video_urls(html, "https://example.com/page")

    assert results == [
        {
            "url": "https://player.example.com/embed/123",
            "kind": "embed",
            "source": "<iframe> src",
        }
    ]
