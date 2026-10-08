import base64,json,os
w=json.load(open('world.json'))
b=lambda p:'b64:'+base64.b64encode(open(p,'rb').read()).decode()
w['spz']=b('dist/assets/world.spz'); w['collider']=b('dist/assets/collider.glb')
a={}
for k in ['wood','fire','earth','metal','water']:
    p=f'dist/assets/stone_{k}.glb'
    if os.path.exists(p): a[k]=b(p)
if os.path.exists('dist/assets/furnace.glb'): a['furnace']=b('dist/assets/furnace.glb')
json.dump({'assets':a,'world':w},open('config_local.json','w'))
