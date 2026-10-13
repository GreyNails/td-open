"""Launch the pinned ComfyUI runtime with an allocator budget and project-local caches."""
from pathlib import Path
import os
import runpy
import sys

root=Path(os.environ['TD_LOCAL_AI_ROOT']).resolve()
runtime=root/'runtimes/comfyui'
sys.path.insert(0,str(runtime))
import torch

if torch.cuda.is_available():
    total=torch.cuda.get_device_properties(0).total_memory
    # Reserve space for the CUDA context and workspaces outside the allocator.
    requested=max(2,float(os.environ.get('TD_LOCAL_AI_VRAM_GB','24'))-1.5)*1024**3
    torch.cuda.set_per_process_memory_fraction(min(1,requested/total),0)
    print(f'TD Open: CUDA allocator budget {requested/1024**3:.1f} GiB; GPU total {total/1024**3:.1f} GiB',flush=True)
import comfy.options
comfy.options.enable_args_parsing()
import folder_paths
folder_paths.add_model_folder_path('custom_nodes',str(runtime/'custom_nodes'))
sys.argv[0]=str(runtime/'main.py')
runpy.run_path(str(runtime/'main.py'),run_name='__main__')
