"""Authenticate private desktop HTTP/WebSocket APIs without changing web mode."""
import secrets


class DesktopAccess:
    def __init__(self, app, token):
        self.app, self.token = app, token.encode()

    async def __call__(self, scope, receive, send):
        kind, path = scope["type"], scope.get("path", "")
        # Generated media has opaque filenames and is also used by isolated Web TOPs.
        media = scope.get("method") in ("GET", "HEAD") and path.startswith(("/api/assets/", "/api/exports/"))
        if kind in ("http", "websocket") and path.startswith("/api/") and not media:
            supplied = dict(scope.get("headers", [])).get(b"x-td-desktop-token", b"")
            if not secrets.compare_digest(supplied, self.token):
                if kind == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": b'{"detail":"Desktop session required"}'})
                return
        await self.app(scope, receive, send)
