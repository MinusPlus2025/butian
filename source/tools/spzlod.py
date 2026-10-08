import gzip,struct,sys,numpy as np
src,dst,target=sys.argv[1],sys.argv[2],int(sys.argv[3])
d=gzip.open(src).read()
m,v,n,sh,fb,fl,r=struct.unpack('<IIIBBBB',d[:16])
assert sh==0
o=16
pos=np.frombuffer(d,np.uint8,n*9,o).reshape(n,9);o+=n*9
al=np.frombuffer(d,np.uint8,n,o);o+=n
col=np.frombuffer(d,np.uint8,n*3,o).reshape(n,3);o+=n*3
sc=np.frombuffer(d,np.uint8,n*3,o).reshape(n,3);o+=n*3
rot=np.frombuffer(d,np.uint8,n*3,o).reshape(n,3);o+=n*3
assert o==len(d),(o,len(d))
q=pos.reshape(n,3,3).astype(np.int32);p=q[:,:,0]|(q[:,:,1]<<8)|(q[:,:,2]<<16);p=np.where(p&0x800000,p-0x1000000,p)/(1<<fb)
# playable box in raw units (game/0.3) with margin
x0,x1,z0,z1=-14/0.3,4/0.3,-38/0.3,30/0.3
dx=np.maximum(0,np.maximum(x0-p[:,0],p[:,0]-x1));dz=np.maximum(0,np.maximum(z0-p[:,2],p[:,2]-z1))
dist=np.sqrt(dx*dx+dz*dz)
# splat size (log scale encoded): bigger splats survive more
s=sc.astype(np.float32).mean(1)
M=15.0
def keep(R):
    return np.clip(R*(M/np.maximum(dist,M))**2,0,1)
lo,hi=0.01,1.0
for _ in range(40):
    R=(lo+hi)/2
    if keep(R).sum()>target: hi=R
    else: lo=R
pr=keep(R)
rng=np.random.default_rng(1)
k=rng.random(n)<pr
print('R',round(R,1),'near(all kept)',int((dist<R).sum()),'kept',int(k.sum()),'of',n)
# compensate: thinned splats get scaled up a bit so coverage holds (scale is log, 16 units per e)
boost=np.zeros(n);boost[k]=np.log(pr[k]**(-1/3))*16
sc2=np.clip(sc.astype(np.float32)+boost[:,None],0,255).astype(np.uint8)
out=struct.pack('<IIIBBBB',m,v,int(k.sum()),sh,fb,fl,r)+pos[k].tobytes()+al[k].tobytes()+col[k].tobytes()+sc2[k].tobytes()+rot[k].tobytes()
with gzip.open(dst,'wb',compresslevel=9) as f: f.write(out)
