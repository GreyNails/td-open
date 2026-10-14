const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sameOrigin, externalURL } = require("../security.cjs");
test("desktop origin includes the assigned port and rejects lookalikes", () => {
  const origin = "http://127.0.0.1:45678";
  assert(sameOrigin(origin + "/api/projects", origin));
  for (const value of ["http://127.0.0.1:45679", "http://127.0.0.1.evil.test:45678", "file:///tmp/index.html", "javascript:alert(1)"]) assert(!sameOrigin(value, origin));
});
test("only ordinary HTTP(S) links may open the system browser", () => {
  assert(externalURL("https://github.com/GreyNails/td-open"));
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "ms-settings:privacy", "https://user:pass@example.org"]) assert(!externalURL(value));
});
