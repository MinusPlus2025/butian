import gzip,struct,sys,numpy as np
for f in sys.argv[1:]:
    d=gzip.open(f).read()
    m,v,n,sh,fb,fl,r=struct.unpack('<IIIBBBB',d[:16])
    pos=np.frombuffer(d[16:16+n*9],dtype=np.uint8).reshape(n,3,3).astype(np.int32)
    p=pos[:,:,0]|(pos[:,:,1]<<8)|(pos[:,:,2]<<16); p=np.where(p&0x800000,p-0x1000000,p)/(1<<fb)
    print(f,n,sh,np.percentile(p,[1,50,99],axis=0).round(2).tolist())
