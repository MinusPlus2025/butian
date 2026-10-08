# pack binary assets into base64 .txt chunks (<=9MB text each) under dist/pub/, write config.json
import base64,json,os,sys
CH=9_000_000
os.makedirs('dist/pub',exist_ok=True)
for f in os.listdir('dist/pub'): os.remove('dist/pub/'+f)
def pack(src,name):
    t=base64.b64encode(open(src,'rb').read()).decode(); parts=[]
    for i in range(0,len(t),CH):
        fn=f'pub/{name}.{i//CH}.txt'; open('dist/'+fn,'w').write(t[i:i+CH]); parts.append(fn)
    return parts
w=json.load(open('world.json'))
w['spz']=pack('dist/assets/world.spz','world'); w['collider']=pack('dist/assets/collider.glb','collider')
assets={}
for k in ['wood','fire','earth','metal','water','furnace']:
    p=f'dist/assets/stone_{k}.glb' if k!='furnace' else 'dist/assets/furnace.glb'
    if os.path.exists(p): assets[k]=pack(p,k)
json.dump({'assets':assets,'world':w},open('config.json','w'))
print(sorted(os.listdir('dist/pub')), assets.keys())
