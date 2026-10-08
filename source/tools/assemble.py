# runs on the user's Mac: inline local assets into the CDN template -> 补天.html
import base64,json,os,gzip,sys
D=os.path.dirname(os.path.abspath(__file__)); B=os.path.dirname(D)
tpl=gzip.decompress(base64.b64decode(open(os.path.join(D,'t.b64')).read())).decode()
w=json.load(open(os.path.join(D,'world.json')))
b=lambda p:'b64:'+base64.b64encode(open(p,'rb').read()).decode()
S=os.path.join(B,'small')
w['spz']=b(os.path.join(S,'world.spz')); w['collider']=b(os.path.join(S,'collider.glb'))
a={}
for k in ['wood','fire','earth','metal','water','furnace']:
    p=os.path.join(S,f'stone_{k}.glb' if k!='furnace' else 'furnace.glb')
    if os.path.exists(p): a[k]=b(p)
cfg=json.dumps({'assets':a,'world':w})
out=tpl.replace('<!--CONFIG-->','<script>window.BUTIAN_CONFIG='+cfg+';</script>',1)
out='<!doctype html>\n'+out
open(os.path.join(B,'补天_双击打开.html'),'w').write(out); print('ok',len(out)//1024//1024,'MB',list(a))
