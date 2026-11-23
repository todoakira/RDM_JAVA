# 원작 DB(redmoon_Data.MDF)의 저장 프로시저에서 이야기 퀘스트 우편(보낸이·제목·내용)을 뽑는다.
# SQL Server 의 찢어진 페이지 감지(torn page)는 8KB 페이지의 512바이트 구역마다 마지막 바이트 아래 2비트를
# 바꿔 두고 원래 비트를 페이지 머리 0x3C 의 32비트 값에 구역 순서대로 2비트씩 보관한다. 그것을 되돌린다.
import sys, re, json, struct
d = bytearray(open(sys.argv[1], 'rb').read())
for pg in range(0, len(d) - 8191, 8192):
    tb = struct.unpack_from('<I', d, pg + 0x3C)[0]
    if d[pg] != 1 or not tb: continue           # 데이터 페이지 머리(m_headerVersion=1)만
    for s in range(1, 16):
        q = pg + s * 512 + 511
        d[q] = (d[q] & ~3) | ((tb >> (2 * s)) & 3)
txt = d.decode('latin1')
# 프로시저 이름 → (StoryQuestState 에 더하는 값, 보낸이, 제목, 내용)
out = {}
for name in ['RMS_BEGINSPYQUEST', 'RMS_BEGINCAPTAINYQUEST', 'RMS_KASAMSPACESHIPMAIL', 'RMS_LEVEL1000MAIL']:
    i = txt.find('CREATE PROCEDURE ' + name); body = txt[i:i + 4000]
    b = re.search(r'StoryQuestState \| (\d+)', body); bit = int(b.group(1)) if b else 0   # 레벨 1000 우편은 이야기 비트가 없다
    m = re.search(r"values ?\(@Time, @GameID, '((?:[^']|'')*)', 0, '((?:[^']|'')*)', \d+, '((?:[^']|'')*)', ''\)", body)
    un = lambda t: t.replace("''", "'").replace('\r', '')
    out[name] = {'bit': bit, 'from': un(m.group(1)), 'title': un(m.group(2)), 'text': un(m.group(3))}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
