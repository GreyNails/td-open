/** Capture existing real model results in the current studio; never substitutes generated assets. */
import {chromium,expect as baseExpect} from '@playwright/test';import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),base=process.env.TD_BASE_URL||'http://127.0.0.1:8774';process.env.TMPDIR=path.join(root,'.cache/tmp');
const browser=await chromium.launch({executablePath:process.env.TD_CHROMIUM,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],env:process.env});const page=await browser.newPage({viewport:{width:1512,height:982}}),expect=baseExpect.configure({timeout:30000});
const profiles=['flux-klein-4b','ace-step-15','hunyuan3d-21','wan22-5b'],shots=[];
try{
 await page.goto(base,{waitUntil:'networkidle'});
 for(const profile of profiles){
  const filename=path.join(root,'data/projects','local_validation_'+profile.replaceAll('-','_')+'.json');await page.locator('input[accept=".json,.tdopen"]').setInputFiles(filename);await page.getByTitle('适应全部节点').click();await page.locator('.react-flow__node[data-id="generation"]').click();await expect(page.locator('.local-node-panel .local-result-title')).toHaveText('本地生成资源');
  if(profile==='ace-step-15')await page.getByRole('button',{name:'读取完整文件为 PCM 采样'}).click();await page.waitForTimeout(2500);const screenshot=await page.screenshot({path:path.join(root,'data/artifacts','local-final-'+profile+'.png')});shots.push({label:profile,data:'data:image/png;base64,'+screenshot.toString('base64')});
 }
 const montage=await browser.newPage({viewport:{width:1512,height:1060},deviceScaleFactor:1});await montage.setContent('<style>body{margin:0;background:#101116;color:#c1e998;font:18px sans-serif}h1{font-size:28px;margin:20px 24px}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 24px 24px}figure{margin:0;background:#1b1b24;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}</style><h1>TD Open · 本地模型在工作台中的真实生成结果</h1><main>'+shots.map(shot=>'<figure><img src="'+shot.data+'"><figcaption>'+shot.label+'</figcaption></figure>').join('')+'</main>');await montage.screenshot({path:path.join(root,'docs/images/local-ai-live.png'),fullPage:true});
 console.log('PASS captured actual image, music, GLB and video outputs in current 0.5 GUI');
}finally{await browser.close();}
