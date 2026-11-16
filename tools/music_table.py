# 맵 번호 → 배경음악 표를 원작 클라이언트에서 뽑는다.
#  Main.dll 0x10005458~0x10005586: 맵 번호 0~188 은 0x10005644 의 바이트 표 → 0x100055d4 의 분기 → "rmNNN.mid", 그 밖은 rm004.mid
#  rm3944cl.dll NewMapFix 0x1000227a: 300~316 번 맵을 따로 덮어쓴다
# 사용: python3 -I tools/music_table.py <클라이언트 폴더> > assets/music.json
import pefile, struct, json, sys, os
d = sys.argv[1]
pe = pefile.PE(os.path.join(d, 'Main.dll')); g = lambda va, n: pe.get_data(va - 0x10000000, n)
idx = g(0x10005644, 0xbd); n = max(idx) + 1; tg = struct.unpack('<%dI' % n, g(0x100055d4, 4 * n))
s = lambda get, va: get(va, 12).split(b'\0')[0].decode()
maps = {}
for m in range(0xbd):
    b = g(tg[idx[m]], 5)
    if b[0] == 0x68: maps[m] = s(g, struct.unpack('<I', b[1:])[0])[:-4]
c = pefile.PE(os.path.join(d, 'rm3944cl.dll')); gc = lambda va, n: c.get_data(va - 0x10000000, n)
# NewMapFix 의 비교: 맵 번호 → 문자열 주소
patch = {300: 0x100071e8, 301: 0x1000720c, 302: 0x10007218, 303: 0x10007224, 305: 0x100071f4, 306: 0x10007200, 307: 0x10007200, 308: 0x10007200,
         309: 0x10007200, 310: 0x10007200, 311: 0x10007230, 312: 0x1000723c, 313: 0x1000723c, 314: 0x1000723c, 315: 0x1000723c, 316: 0x1000723c}
print(json.dumps({'maps': maps, 'patch': {k: s(gc, v)[:-4] for k, v in patch.items()}, 'default': 'rm004'}))
