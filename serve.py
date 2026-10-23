"""Local website server with explicit JavaScript types and no stale browser cache."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class DemoHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
    }
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    handler = partial(DemoHandler, directory=str(Path(__file__).resolve().parent / "dist"))
    with ThreadingHTTPServer(("127.0.0.1", 4173), handler) as server:
        print("Open http://127.0.0.1:4173", flush=True)
        print("Keep this terminal open. Ctrl+C stops the website.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
