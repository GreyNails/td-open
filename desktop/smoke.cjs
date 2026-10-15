"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { app } = require("electron");

async function smoke(window, options) {
  const { origin, workspace, report, backendPID } = options;
  for (let i = 0; i < 120; i++) {
    if (await window.webContents.executeJavaScript("document.querySelectorAll('.studio-node').length >= 5")) break;
    if (i === 119) throw new Error("Studio nodes did not load");
    await sleep(500);
  }
  const unauthenticated = await fetch(origin + "/api/projects");
  assert.equal(unauthenticated.status, 403);
  const result = await window.webContents.executeJavaScript(`(async () => {
    async function api(url, body, headers={}) {
      const response = await fetch('/api/'+url, body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
      if (!response.ok) throw new Error(url+' HTTP '+response.status+' '+await response.text());
      return response.json();
    }
    const health=await api('health'),catalog=await api('catalog'),examples=await api('examples');
    const original=await api('examples/example_flow');
    const saved=await api('projects',{...original,name:'Desktop smoke — 用户项目',settings:{...original.settings,desktop_smoke:true}});
    const intent=await api('scripts/intent',{});
    const script=await api('scripts/run',{code:'def cook(inputs, time):\\n    return {"desktop": inputs["value"] * 2}',inputs:{value:21},time:0},{'x-td-script-intent':intent.token});
    const web=await api('web-render/capture',{html:'<html><title>TD desktop web capture</title><body style="background:#c0e88e"><h1>Desktop Chromium</h1></body></html>',width:320,height:180,delay:50});
    const local=await api('local-ai/status'),io=await api('io/capabilities');
    const input=new FormData();input.append('file',new Blob(['RIFF desktop upload'],{type:'audio/wav'}),'desktop.wav');
    const uploadResponse=await fetch('/api/upload',{method:'POST',body:input});if(!uploadResponse.ok)throw new Error('Upload failed');
    const upload=await uploadResponse.json();
    const audio=new OfflineAudioContext(1,4800,48000);const oscillator=audio.createOscillator();oscillator.connect(audio.destination);oscillator.start();
    const rendered=await audio.startRendering();const samples=rendered.getChannelData(0);let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
    return {health,operators:catalog.nodes.length,examples:examples.length,savedID:saved.id,sourceID:original.id,
      script:script.value,webTitle:web.title,webImage:web.image_url,localProfiles:local.profiles.length,
      ioProtocols:io.protocols,upload:upload.url,audioPeak:peak,webgl2:!!gl,renderedNodes:document.querySelectorAll('.studio-node').length,
      hasNodeIntegration:typeof window.require !== 'undefined',platform:navigator.platform};
  })()`);
  result.gpuFeatures = app.getGPUFeatureStatus();
  result.gpuInfo = await app.getGPUInfo("basic");
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report.replace(/\.json$/, ".png"), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(report, JSON.stringify({ passed: false, ...result, backendPID }, null, 2));
  assert(result.operators >= 751 && result.examples >= 90);
  assert.notEqual(result.savedID, result.sourceID);
  assert.equal(result.script.desktop, 42);
  assert.equal(result.webTitle, "TD desktop web capture");
  assert(result.audioPeak > .5, "Audio render returned no signal");
  assert(result.webgl2, "WebGL 2 context unavailable; see GPU diagnostics");
  assert.equal(result.hasNodeIntegration, false);
  assert(result.localProfiles >= 7);
  assert(result.ioProtocols.includes("sharedmem"));
  assert.equal(path.resolve(result.health.data_dir), path.join(workspace, "data"));
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report.replace(/\.json$/, ".png"), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(report, JSON.stringify({ passed: true, ...result, backendPID,
    scope: "Native desktop launch, real shared frontend/backend, Python callback, Chromium Web TOP, saved project, upload, audio, WebGL. Large model inference requires separate hardware validation." }, null, 2));
}
module.exports = { smoke };
