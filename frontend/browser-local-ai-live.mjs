/** Paid APIs and fixtures are not used: every run clicks the real studio's local generation button. */
import { chromium, expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),artifacts=path.join(root,'data/artifacts');
const base=process.env.TD_BASE_URL||'http://127.0.0.1:8774';
process.env.TMPDIR=path.join(root,'.cache/tmp');await fs.mkdir(process.env.TMPDIR,{recursive:true});await fs.mkdir(artifacts,{recursive:true});
const health=await fetch(base+'/api/health').then(r=>r.json());
if(!health.data_dir?.includes('/.cache/'))throw new Error('Live browser validation requires an isolated .cache data directory.');
const specs=(await fetch(base+'/api/catalog').then(r=>r.json())).nodes,byType=Object.fromEntries(specs.map(s=>[s.type,s]));
const scenario=process.env.TD_LOCAL_CASE||'';
const profileIds=(process.env.TD_LOCAL_PROFILES||'flux-klein-4b,z-image-turbo,ace-step-15,hunyuan3d-21,melband-roformer,demucs-4,wan22-5b').split(',');
const reportFile=path.join(artifacts,'local-ai-live-results.json');
let previous={runs:[],checks:[],errors:[]};try{previous=JSON.parse(await fs.readFile(reportFile,'utf8'));}catch{}
const report={...previous,base,hardware:(await fetch(base+'/api/local-ai/status').then(r=>r.json())).hardware,validation:'Actual browser buttons → TD Open → managed ComfyUI → pinned real model weights; no API interception',runs:[...previous.runs],checks:[...previous.checks],errors:[]};
const make=(id,type,x,y,params={})=>({id,type,position:{x,y},data:{label:byType[type].label,params:{...Object.fromEntries(byType[type].params.map(p=>[p.key,p.default])),...params}}});
const edge=(source,target,sourceHandle='out',targetHandle='in')=>({id:'edge_'+source+'_'+target,source,target,sourceHandle,targetHandle});
const browser=await chromium.launch({executablePath:process.env.TD_CHROMIUM,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],env:process.env});
const page=await browser.newPage({viewport:{width:1512,height:982},deviceScaleFactor:1});
const expect=baseExpect.configure({timeout:30000});page.setDefaultTimeout(30000);
page.on('pageerror',error=>report.errors.push(error.message));
const mark=(name,extra={})=>{report.checks.push({name,passed:true,...extra});console.log('PASS '+name);};
const outputOf=(profile)=>report.runs.findLast(r=>r.profile_id===profile&&r.status==='succeeded')?.outputs?.[0]?.url;
try{
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'本地 AI',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'本地模型中心'})).toBeVisible();
  await expect(page.locator('.local-model-card')).toHaveCount(7);
  await page.screenshot({path:path.join(artifacts,'local-model-center.png')});
  mark('Model center displays seven actual model installations and hardware');
  await page.getByRole('button',{name:'关闭本地模型中心'}).click();
  for(const profile of profileIds){
    const caseId=scenario||profile;
    const status=await fetch(base+'/api/local-ai/status').then(r=>r.json());
    const model=status.profiles.find(p=>p.id===profile);
    if(!model?.installed)throw new Error('Install the real weights before this test: '+profile);
    let type='local_image',params={model_id:profile,prompt:'A small ceramic robot with blue accents and a friendly round face, full body, white studio background, product photography',seed:77,steps:profile==='z-image-turbo'?9:4},source;
    if(profile==='ace-step-15'){type='local_music';params={prompt:'Instrumental, warm jazzy piano melody, upright bass, light brushed drums, calm relaxed groove, clean studio recording',lyrics:'[Instrumental]',duration:10,bpm:110,seed:77,generate_audio_codes:false};}
    if(profile==='hunyuan3d-21'){type='local_3d';source=outputOf('flux-klein-4b');if(!source)throw new Error('Run flux-klein-4b first to provide the generated reference');params={input_url:source,resolution:'128',steps:30,cfg:5,seed:77};}
    if(['melband-roformer','demucs-4'].includes(profile)){type='local_stems';source=outputOf('ace-step-15');if(!source)throw new Error('Run ace-step-15 first to provide generated music');params={model_id:profile,input_url:source,segment:4};}
    if(profile==='wan22-5b'){type='local_video';source=outputOf('flux-klein-4b');params={input_url:source||'',prompt:'A small ceramic robot slowly waves one arm, a subtle camera push in, clean white studio, smooth natural movement',width:512,height:320,frames:17,fps:16,steps:20,cfg:5,seed:77};}
    if(['image-edit','image-to-image','inpaint'].includes(scenario)){
      type=scenario==='image-edit'?'local_image_edit':scenario==='inpaint'?'local_inpaint':'local_image_to_image';
      source=outputOf('flux-klein-4b');params={input_url:source,prompt:'Change the robot accents to bright red ceramic, preserve the white background',seed:78,steps:scenario==='image-edit'?4:9,denoise:.65};
      if(scenario==='inpaint'){
        params.mask_url=await page.evaluate(async()=>{
          const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const context=canvas.getContext('2d');context.fillStyle='black';context.fillRect(0,0,512,512);context.fillStyle='white';context.fillRect(150,130,200,260);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const form=new FormData();form.append('file',blob,'mask.png');const response=await fetch('/api/artifacts',{method:'POST',body:form});if(!response.ok)throw new Error(await response.text());return (await response.json()).url;
        });
      }
    }
    if(scenario==='api-workflow'){type='comfy_workflow';params={output_kind:'image'};}
    let gen=make('generation',type,120,100,params),out=make('output','output',690,100),nodes=[gen,out],edges=[];
    if(byType[type].outputs[0].kind==='SOP'){
      const render=make('render','render',420,100,{speed:0,wireframe:false});nodes.splice(1,0,render);edges.push(edge(gen.id,render.id,'out',byType.render.inputs.find(p=>p.kind==='SOP'||p.kind==='any').id),edge(render.id,out.id));
    }else if(byType[type].outputs[0].kind==='CHOP'){
      const visual=make('visual','particles',420,100);nodes.splice(1,0,visual);edges.push(edge(gen.id,visual.id,'out',byType.particles.inputs.find(p=>p.kind==='CHOP').id),edge(visual.id,out.id));
    }else edges.push(edge(gen.id,out.id));
    if(scenario==='advanced-z'){
      const document=JSON.parse(await fs.readFile(path.join(root,'examples/local-comfy-z.tdopen.json'),'utf8'));nodes=document.nodes;edges=document.edges;
      gen=nodes.find(node=>node.type==='comfy_save_image');const original=gen.id;gen.id='generation';for(const edge of edges){if(edge.source===original)edge.source=gen.id;if(edge.target===original)edge.target=gen.id;}
    }
    const project={id:'qa_local_'+caseId.replaceAll('-','_'),name:'本地实跑 · '+(scenario||model.name),version:1,nodes,edges};
    await page.locator('input[accept=".json,.tdopen"]').setInputFiles({name:profile+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
    await expect(page.getByLabel('作品名称')).toHaveValue(project.name);
    await page.getByTitle('适应全部节点').click();
    await page.locator('.react-flow__node[data-id="generation"]').click();
    await expect(page.locator('.local-node-panel')).toBeVisible();
    if(scenario==='api-workflow')await page.locator('.local-node-panel input[type="file"]').setInputFiles(path.join(artifacts,'local-live-z-image-turbo.workflow.json'));
    const queueResponse=page.waitForResponse(response=>response.url().endsWith('/api/local-ai/generate')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'运行本地工作流',exact:true}).click();
    const response=await queueResponse;if(!response.ok())throw new Error(await response.text());
    const queued=await response.json();console.log('RUN '+profile+' '+queued.id);
    let result;
    const begin=Date.now();
    while(Date.now()-begin<3600000){
      result=await fetch(base+'/api/local-ai/jobs/'+queued.id).then(r=>r.json());
      if(['succeeded','failed','cancelled','interrupted'].includes(result.status))break;
      await page.waitForTimeout(2000);
    }
    if(result?.status!=='succeeded')throw new Error(profile+': '+JSON.stringify(result));
    if(!result.outputs?.length)throw new Error('Real model produced no downloadable output');
    if(result.peak_vram_mib>24576)throw new Error('Measured process memory exceeded 24 GiB');
    const saved={...result,profile_id:profile,project_id:project.id,case_id:caseId,executed_via:'browser-button',source_url:source};
    if(scenario){report.features=(report.features||[]).filter(r=>r.case_id!==caseId);report.features.push(saved);}
    else {report.runs=report.runs.filter(r=>r.profile_id!==profile);report.runs.push(saved);}
    await expect(page.locator('.local-node-panel .local-result-title')).toHaveText('本地生成资源');
    await expect(page.locator('.local-node-panel .local-output')).toHaveCount(result.outputs.length);
    if(result.outputs[0].kind==='audio'){
      await page.getByRole('button',{name:'读取完整文件为 PCM 采样'}).click();
      await expect(page.locator('.runtime-values')).toContainText('通道');
    }
    if(result.outputs[0].kind==='3d'){
      await page.waitForTimeout(3000);
      const errors=await page.locator('.error-status').allTextContents();
      if(errors.length)throw new Error('3D model rendered with errors: '+errors.join(','));
    }
    await page.getByRole('button',{name:'保存作品',exact:true}).click();
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(artifacts,'local-live-'+caseId+'.png')});
    await fs.writeFile(path.join(artifacts,'local-live-'+caseId+'.workflow.json'),JSON.stringify(await fetch(base+'/api/local-ai/jobs/'+queued.id+'/workflow').then(r=>r.json()),null,2));
    mark(profile+' generated in the studio and returned previewable real resources',{outputs:result.outputs.length,peak_vram_mib:result.peak_vram_mib,seconds:result.elapsed_seconds});
    await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
  }
  if(report.errors.length)throw new Error('Browser JavaScript errors: '+report.errors.join('\n'));
}catch(error){report.errors.push(error.message);await page.screenshot({path:path.join(artifacts,'local-live-failure.png')}).catch(()=>{});throw error;}
finally{await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');await browser.close();}
