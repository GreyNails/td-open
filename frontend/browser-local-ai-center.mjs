/** Real services: installation controls, native schemas and direct input upload. */
import {chromium,expect as baseExpect} from '@playwright/test';
import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),base=process.env.TD_BASE_URL||'http://127.0.0.1:8774',artifacts=path.join(root,'data/artifacts');
process.env.TMPDIR=path.join(root,'.cache/tmp');
const health=await fetch(base+'/api/health').then(r=>r.json());if(!health.data_dir.includes('/.cache/'))throw new Error('Use isolated QA data');
const browser=await chromium.launch({executablePath:process.env.TD_CHROMIUM,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],env:process.env});
const page=await browser.newPage({viewport:{width:1512,height:982}}),expect=baseExpect.configure({timeout:30000}),checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
const mark=name=>{checks.push({name,passed:true});console.log('PASS '+name);};
try{
 await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'本地 AI',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'本地模型中心'});await expect(dialog).toBeVisible();await expect(dialog.locator('.local-model-card')).toHaveCount(7);
 expect(await dialog.locator('.local-model-card').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('界面实测通过')]));
 await page.screenshot({path:path.join(root,'docs/images/local-model-center.png')});mark('Verified local models display actual GPU validation records');
 const install=page.waitForResponse(r=>r.url().endsWith('/api/local-ai/install')&&r.request().method()==='POST');await dialog.locator('.local-model-card').first().getByRole('button',{name:'校验 / 修复环境'}).click();const queued=await (await install).json();
 await expect.poll(async()=> (await fetch(base+'/api/local-ai/jobs/'+queued.id).then(r=>r.json())).status,{timeout:120000}).toBe('succeeded');mark('One-click existing environment and weight verification succeeds through actual installer');
 await dialog.getByRole('button',{name:'环境设置',exact:true}).click();await expect(dialog.getByLabel('显存预算（GiB）')).toHaveValue('24');await expect(dialog.getByLabel('下载源')).toHaveValue('auto');
 await dialog.getByRole('button',{name:'Comfy 节点库',exact:true}).click();await expect(dialog.locator('.local-node-search')).toContainText('个实际节点');
 await dialog.getByPlaceholder('搜索已安装的 Comfy 类名、分类…').fill('SaveVideo');await expect(dialog.locator('.local-comfy-list > div')).toHaveCount(1);await dialog.locator('.local-comfy-list').getByRole('button',{name:'添加',exact:true}).click();
 const save=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存作品',exact:true}).click();const doc=(await save).request().postDataJSON();const node=doc.nodes.findLast(n=>n.type==='comfy_custom');const widgets=JSON.parse(node.data.params.inputs_json);expect(widgets.format).toBe('auto');expect(widgets['format.codec']).toBe('auto');expect(node.data.params.input_names).toBe('video');mark('Native V3 dynamic combo imports nested codec widgets correctly');
 await page.getByRole('button',{name:'本地 AI',exact:true}).click();await dialog.getByRole('button',{name:'模型库',exact:true}).click();const card=dialog.locator('.local-model-card').filter({has:page.getByRole('heading',{name:'Hunyuan3D 2.1 Shape',exact:true})});await card.getByRole('button',{name:'添加节点',exact:true}).click();
 const upload=page.waitForResponse(r=>r.url().endsWith('/api/upload')&&r.request().method()==='POST');const live=JSON.parse(await fs.readFile(path.join(artifacts,'local-ai-live-results.json'),'utf8'));const source=live.runs.find(r=>r.profile_id==='flux-klein-4b').outputs[0].url.split('/').pop();
 await page.locator('.local-node-panel input[accept="image/*"]').setInputFiles(path.join(root,'.cache/local-ai-qa/assets',source));expect((await upload).ok()).toBe(true);mark('Input picture uploads directly from the generation node panel');
 await page.getByRole('button',{name:'本地 AI',exact:true}).click();await page.setViewportSize({width:390,height:844});await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:path.join(artifacts,'local-model-center-mobile.png')});await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();mark('390px model center and Escape work');
 expect(errors).toEqual([]);
}finally{await fs.writeFile(path.join(artifacts,'local-ai-center-browser.json'),JSON.stringify({checks,errors},null,2));await browser.close();}
