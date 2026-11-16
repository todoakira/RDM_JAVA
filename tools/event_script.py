# 원작 이벤트 대본(DATAs/Info/event00.rmi, "RedMoon EventInfo File 1.0") 풀기.
# 서버는 Data/Event/EventScript.res 를 쓴다 (원본 표: Data/Event/work/EventScript.txt, 머리줄 "이벤트번호; 맵번호; 랜덤; C/S; 발생조건; 클라이언트행동; 서버행동; ...").
# 구조: 머리 문자열, u32 이벤트 수, 이벤트마다 [u16 맵 번호, u16 랜덤, u16 ?, u32 단계 수, 단계마다 [u32 서버 확인(S=1, C=0), 발생조건, 클라이언트 행동, 서버 행동]]
# 사용: python3 -I tools/event_script.py <event00.rmi> > data/event_script.json
import struct, sys, json
d = open(sys.argv[1], 'rb').read(); p = 0
def cs():
    global p
    n = d[p]; p += 1
    if n == 0xff: n = struct.unpack_from('<H', d, p)[0]; p += 2
    s = d[p:p + n].decode('euc-kr'); p += n; return s
def u32():
    global p
    v = struct.unpack_from('<I', d, p)[0]; p += 4; return v
def u16():
    global p
    v = struct.unpack_from('<H', d, p)[0]; p += 2; return v
head = cs(); n = u32(); evs = []
while p < len(d):   # 이벤트 수(n)보다 하나 더 들어 있는 파일이 있어 끝까지 읽는다 (EventScript.res: n=82, 실제 83)
    m = u16(); rnd = u16(); f = u16(); k = u32(); steps = []
    for j in range(k):
        steps.append({'s': u32(), 'cond': cs(), 'client': cs(), 'server': cs()})
    evs.append({'map': m, 'random': rnd, 'flag': f, 'steps': steps})
assert p == len(d), (p, len(d))
print(json.dumps({'head': head, 'events': evs}, ensure_ascii=False))
