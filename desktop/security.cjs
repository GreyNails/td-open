"use strict";
function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
function externalURL(url) {
  try { const u = new URL(url); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}
function privateAPI(url, origin) {
  return sameOrigin(url, origin) && new URL(url).pathname.startsWith("/api/");
}
module.exports = { sameOrigin, externalURL, privateAPI };
