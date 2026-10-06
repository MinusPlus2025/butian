import json,os,shutil
os.makedirs('pages/assets',exist_ok=True)
w=json.load(open('world.json')); w['spz']='assets/world.spz'; w['collider']='assets/collider.glb'; w['spzB']='assets/worldB.spz'
a={}
for k in ['wood','fire','earth','metal','water','furnace','hand']:
    p=f'dist/assets/stone_{k}.glb' if k not in ('furnace','hand') else f'dist/assets/{k}.glb'
    if os.path.exists(p): shutil.copy(p,'pages/assets/'); a[k]='assets/'+os.path.basename(p)
for f in ['world.spz','collider.glb','worldB.spz']: shutil.copy('dist/assets/'+f,'pages/assets/')
if os.path.exists('dist/assets/bgm.mp3'): shutil.copy('dist/assets/bgm.mp3','pages/assets/'); a['bgm']='assets/bgm.mp3'
if os.path.exists('dist/assets/hand_left.glb'): shutil.copy('dist/assets/hand_left.glb','pages/assets/'); a['handL']='assets/hand_left.glb'
if os.path.exists('dist/assets/rain.mp3'): shutil.copy('dist/assets/rain.mp3','pages/assets/'); a['rain']='assets/rain.mp3'
import glob
th=sorted(glob.glob('dist/assets/thunder*.mp3'))
for f in th: shutil.copy(f,'pages/assets/')
if th: a['thunder']=['assets/'+os.path.basename(f) for f in th]
json.dump({'assets':a,'world':w},open('config_pages.json','w'))
for k,f in [('nuwa','nuwa.glb'),('forge','forge.mp3'),('dragon','dragon.mp3'),('ending','ending.mp3'),('intro','intro.mp3')]:
    if os.path.exists('dist/assets/'+f): shutil.copy('dist/assets/'+f,'pages/assets/'); a[k]='assets/'+f
json.dump({'assets':a,'world':w},open('config_pages.json','w'))
if os.path.isdir('dist/assets/voice'):
    os.makedirs('pages/assets/voice',exist_ok=True)
    for f in os.listdir('dist/assets/voice'): shutil.copy('dist/assets/voice/'+f,'pages/assets/voice/')
    a['voice']='assets/voice/'
json.dump({'assets':a,'world':w},open('config_pages.json','w'))
