"""Real stdio → TD Open → GPU validation; requires installed FLUX profile and isolated QA backend."""
import asyncio,json,os,sys
from pathlib import Path
import httpx
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('TD_OPEN_APP_URL','http://127.0.0.1:8774')

def unpack(result):
    assert not result.isError,str(result.content)
    value=result.structuredContent or json.loads(result.content[0].text)
    return value.get('result',value)

async def main():
    async with httpx.AsyncClient() as client:
        health=(await client.get(BASE+'/api/health')).json()
        assert '/.cache/' in health['data_dir'],'Use isolated QA data'
    environment={**os.environ,'TD_OPEN_APP_URL':BASE,'PYTHONDONTWRITEBYTECODE':'1'}
    params=StdioServerParameters(command=str(ROOT/'.venv/bin/python'),args=['-m','backend.mcp_server'],cwd=str(ROOT),env=environment)
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as session:
            await session.initialize();listing=await session.list_tools();assert len(listing.tools)==8
            status=unpack(await session.call_tool('get_local_model_status',{}));assert status['environment_ready']
            arguments={'profile_id':'flux-klein-4b','parameters':{'prompt':'A small red ceramic robot in a white studio','steps':4,'seed':91}}
            first=unpack(await session.call_tool('run_local_model',arguments));second=unpack(await session.call_tool('run_local_model',arguments))
            unpack(await session.call_tool('cancel_local_model_job',{'job_id':second['id']}))
            for _ in range(180):
                job=unpack(await session.call_tool('get_local_model_job',{'job_id':first['id']}))
                if job['status'] in {'succeeded','failed','cancelled','interrupted'}:break
                await asyncio.sleep(1)
            assert job['status']=='succeeded',job
            cancelled=unpack(await session.call_tool('get_local_model_job',{'job_id':second['id']}));assert cancelled['status']=='cancelled',cancelled
            async with httpx.AsyncClient() as client:
                output=await client.get(BASE+job['outputs'][0]['url']);assert output.content.startswith(b'\x89PNG\r\n\x1a\n')
            report={'tools':[tool.name for tool in listing.tools],'actual_generation':job,'queued_cancel':cancelled,'all_passed':True}
            (ROOT/'data/artifacts/local-ai-mcp-live.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print('PASS 8 real MCP tools, local GPU generation, resource download and targeted queue cancellation')
asyncio.run(main())
