import json,os,shutil
os.makedirs('pages/assets',exist_ok=True)
w=json.load(open('world.json')); w['spz']='assets/world.spz'; w['collider']='assets/collider.glb'
a={}
for k in ['wood','fire','earth','metal','water','furnace','hand']:
    p=f'dist/assets/stone_{k}.glb' if k not in ('furnace','hand') else f'dist/assets/{k}.glb'
    if os.path.exists(p): shutil.copy(p,'pages/assets/'); a[k]='assets/'+os.path.basename(p)
for f in ['world.spz','collider.glb']: shutil.copy('dist/assets/'+f,'pages/assets/')
if os.path.exists('dist/assets/bgm.mp3'): shutil.copy('dist/assets/bgm.mp3','pages/assets/'); a['bgm']='assets/bgm.mp3'
json.dump({'assets':a,'world':w},open('config_pages.json','w'))
