from playwright.sync_api import sync_playwright

IMDB = "tt0137523"  # Fight Club
TMDB = "550"

PROVIDERS = {
    "CineSrc": f"https://cinesrc.st/embed/movie/{TMDB}",
    "VidNest": f"https://vidnest.fun/movie/{TMDB}",
    "VidZen": f"https://vidzen.fun/movie/{TMDB}",
    "VidSrc": f"https://vidsrc.tw/embed/movie/{IMDB}",
    "VidFast": f"https://vidfast.vc/movie/{IMDB}",
}

SANDBOX = "allow-scripts allow-same-origin allow-forms allow-presentation"

HTML = """
<html>
<body style="margin:0;background:#000">
<iframe
    src="{url}"
    {sandbox}
    allow="autoplay; fullscreen; picture-in-picture"
    allowfullscreen
    style="width:100vw;height:100vh;border:0">
</iframe>
</body>
</html>
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for name, url in PROVIDERS.items():

        for mode in ["normal", "sandbox"]:

            print(f"\nTesting {name} [{mode}]")

            page = browser.new_page(
                viewport={"width": 1280, "height": 720}
            )

            sandbox_attr = (
                f'sandbox="{SANDBOX}"'
                if mode == "sandbox"
                else ""
            )

            page.set_content(
                HTML.format(
                    url=url,
                    sandbox=sandbox_attr
                )
            )

            page.wait_for_timeout(15000)

            texts = []

            for frame in page.frames:
                try:
                    texts.append(
                        frame.locator("body").inner_text(timeout=1500)
                    )
                except:
                    pass

            body = "\n".join(texts).lower()

            if "sandbox" in body:
                print("[BLOCKED] Sandbox explicitly rejected")

            elif "playback unavailable" in body:
                print("[FAILED] Provider loaded but playback unavailable")

            elif "disable sandbox" in body:
                print("[BLOCKED] Disable sandbox message")

            else:
                print("[CHECK] No obvious error detected")

            filename = f"{name.lower()}_{mode}.png"

            page.screenshot(
                path=filename,
                full_page=True
            )

            print(f"Saved: {filename}")

            page.close()

    browser.close()
