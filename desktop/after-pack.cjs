"use strict";
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const application = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");
  const browsers = path.join(application, "Contents/Resources/td-runtime/browsers");
  const libraries = path.join(application, "Contents/Frameworks/Electron Framework.framework/Libraries");
  // Chromium 151+ dynamically loads Vulkan even for software SwiftShader on
  // macOS. Reuse the same-architecture loader shipped with our bundled Chrome,
  // preserving its notices and signing it with the rest of the application.
  const candidates = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/^libvulkan(?:\.1)?\.dylib$/i.test(entry.name)) candidates.push(file);
    }
  }
  visit(browsers);
  if (!candidates.length) throw new Error("Bundled Chromium has no macOS Vulkan loader; software graphics would be incomplete");
  const source = candidates.find(file => file.endsWith("libvulkan.1.dylib")) || candidates[0];
  fs.mkdirSync(libraries, { recursive: true });
  for (const name of ["libvulkan.dylib", "libvulkan.1.dylib"]) {
    fs.copyFileSync(source, path.join(libraries, name));
  }
  console.log("Bundled macOS Vulkan loader for SwiftShader:", source);
};
