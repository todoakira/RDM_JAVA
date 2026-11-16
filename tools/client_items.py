# 원작 클라이언트의 아이템 정보(DATAs/Info/ItemNN.rmi)에서 서버 파일에 없는 값만 뽑는다.
# 한 칸: u32, u32, CString, CString, u32 ×14 (+0x10~+0x44), u16 +0x48, u32 +0x4c, u32 +0x50, u8 +0x54, u8 +0x55(사거리), u8 +0x56, u8 +0x57, u32 +0x58(값)
#   (Main.dll 0x10037a3b~0x10037f16 의 읽기·쓰기 순서)
# +0x56 이 0 보다 크면 공격할 때 총알을 띄우고(Main.dll 0x1002af46), +0x57 이 그 총알 그림 번호다(공격 꾸러미에 실어 보냄, 0x1002adfc).
# 사용: python3 -I tools/client_items.py <클라이언트 폴더> > data/client_items.json
import struct, sys, os, json
def cs(d, p):
    n = d[p]; p += 1
    if n == 0xff: n = struct.unpack_from('<H', d, p)[0]; p += 2
    return d[p:p + n], p + n
out = {}
for k in range(1, 7):
    f = os.path.join(sys.argv[1], 'DATAs', 'Info', 'Item%02d.rmi' % k)
    if not os.path.exists(f): continue
    d = open(f, 'rb').read(); p = 0
    _, p = cs(d, p); ver, cnt = struct.unpack_from('<2I', d, p); p += 8
    recs = []
    for i in range(cnt):
        p += 8; _, p = cs(d, p); _, p = cs(d, p)
        v = struct.unpack_from('<14IHIIBBBBI', d, p); p += 74
        recs.append({'atk': v[2], 'range': v[18], 'shot': v[19], 'bul': v[20], 'price': v[21]})
    out[k] = recs
print(json.dumps(out))
