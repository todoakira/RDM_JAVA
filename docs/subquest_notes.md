# 보조 퀘스트 (Sub Quest) 분석 노트

원본: 서버 `svMapServer.exe` (3944), 클라이언트 `Main.dll` (rma 판, 이미지 기준 0x10000000), 설정 `Bin/Config/SubQuest.ini` → `data/subquest.json` (`tools/subq_ini.py`).
구현: `server/subquest.js`, 연결은 `world.js` (tryTalk·npcAction·몬스터 죽음·tick), `events.js` (대본 행동), `story.js` (퀘스트 창).

## 사용자 필드 (CMapServerClient)
| 칸 | 뜻 |
|---|---|
| +0x41c4 | 상태 0 없음, 1 잡기, 2 찾기, 3 전하기 |
| +0x41c8 | 다 했음 |
| +0x41cc | 맡긴 NPC 이름 (대본 `%NPCID`) |
| +0x41de / +0x41e0 | 맡긴 NPC 그림 / 맡긴 맵 |
| +0x41e4 (16바이트) | 퀘스트 물건 IIS (분류 byte, 번호 short@2, 개수 dword@4) |
| +0x41f4 / +0x41f6 | 목표 몬스터·NPC 그림 / 목표 맵 |
| +0x41f8 | 남은 시간 ms (시작 1,800,000) |
| +0x41fc / +0x4200 / +0x4204 | 보상 경험치 / 명성 / 아이템 IIS |
| +0x4520 | 끊긴 NPC 이벤트 (StopSubQuestAndResume 이 다시 실행) |

## 시작 (ProcessEvent 0x41ee70)
NPC 이벤트 종류 6 은행, 8 병원, 0x14 교환소, 0x1b 고고학자(이야기 차례가 아닐 때), 0x1f 상인(군단 상점 조건이 아닐 때), 0x20 동네아주머니, 0x21 작은 가게, 0x22 가출소녀, 0x23 과학자, 0x24 경비원, 0x25 지리학자.
조건: NPC 이름이 있고, 아레나·배틀매치가 아니고, **그 NPC 이벤트 칸의 시각([4])에서 5분이 지났고** (모든 사람 공용), `rand()%100==99`, 보조 퀘스트 없음, 이야기 퀘스트 창(+0x451c) 없음, `SelectRandomNPC` 성공.
그러면 이름·그림·맵을 기억하고 `"<X>SubQuest"` 대본(이벤트 24~35)을 돌린다. 아니면 원래 일(상점·은행…)을 한다.
(+0x449c, +0x4158, +0x4214 조건은 뜻을 몰라 넣지 않았다.)

## 대본 (EventScript 24~38)
- 24~35: 인사 → 선택. "돕겠다" 면 `BeginRandEvent 36 37 38` (셋 중 무작위, 그 이벤트의 지금 조건이 EventTriggered 면 진행), 아니면 `StopSubQuestAndResume`.
- 36 잡기: 대사 136(0x88) → 140(0x8c) → 276 + `BeginSubQuest1` → 141(0x8d 보상) → 142.
- 37 찾기: 143(0x8f) → 144 → 145(0x91 보상) → 선택 → `BeginSubQuest2` + 278.
- 38 전하기: 148 → 149(0x95) → 150(0x96 보상) → 선택 → `BeginSubQuest3`.

### 특수 대사 (DoEventServerAction ChatOneByCode, 클라이언트 0x10026a7a 가 %s 를 채움)
| 번호 | 서버 | 클라이언트 글 |
|---|---|---|
| 0x88 | SelectQuestMonster → 목표 맵·몬스터 | (몬스터 이름, 맵 이름) |
| 0x8c | 같은 것 다시 | (맵, 몬스터) |
| 0x8d/0x91/0x96 | 보상 정함 | 0/7/0x117 "EXP %u," + 0x118 "Honor %u," + "%s : %u " (각각 0 이 아닐 때) |
| 0x8f | GetRandomIIS + SelectQuestMonster | (맵, 물건, 몬스터) |
| 0x95 | GetRandomIIS + SelectRandomNPC. NPC 를 못 고르면 대본 끝 (Jmp 100) | (물건, 맵, NPC) |

이름: 맵은 Message 0/6, 몬스터·NPC 는 그림 번호 → Message 0/5 (클라이언트 0x10032d20 의 표).

### BeginSubQuest1·2·3
상태 0 이고 맡긴 NPC·목표가 있어야 한다. 2·3 은 물건도. 3 은 먼저 `AddQuestItem` 이 되어야 한다. 상태 = k, 시간 30분, 퀘스트 창을 보내고 연다.

## 고르기
- **SelectQuestMap 0x428240** (레벨 L, 지금 맵 m): L≤50 → SubQuest3MapLink[m]; L≤100 → m 이 0·2 면 링크, 아니면 0; L≤300 → m 이 {3,6,12,35,7,13,15,16,18,37,17,39,40,8,14,19,20,38,70} 이면 링크, 아니면 38; 그 위 → m 이 71·75 면 73, 아니면 75.
- **SelectRandomNPC 0x4281c0**: 위 맵의 [NPC] 목록에서 하나.
- **SelectRandomMonster 0x428880**: 그림 {0x38,0x32,…,0x47} 과 기준 레벨 {1,10,20,40,80,…,600}. 원작 버그 그대로: 위쪽 경계가 두 번째 칸에서 0 이 되어 버려 **레벨 52~650 은 실패**, 1~51 은 첫 몬스터(0x38), 651 이상은 마지막(0x47).
- **SelectQuestMonster 0x428800**: 그 몬스터의 [MonsterMap] 목록에서 맵 하나.
- **GetRandomIIS 0x484eb0**: GetTickCount()&3 → 분류 1(76개 표)·2(34개)·돈·4(19개). 돈은 (tick%10+1)×100,000 (10만~100만), Lang=1 (rmServer.ini) 이면 ÷100.

## 보상 (0x40fe60, 0x40fec0, 0x40fee0, ProcessSubQuestGift 0x422090)
- 경험치 = expTable[min(L,1000)] / (tick%101+100), L≥900 이면 ÷8. `DoExperimentUp(…, 필요 경험치, 1)` → 한 번에 필요 경험치 전부까지. 0/2/0x7d.
- 명성 = tick%1000==0 이면 10, 아니면 0. 오른 만큼 0/2/0x7c.
- 아이템 = GetRandomIIS, 돈이면 개수 L×(tick%991+10), 아니면 1. 못 들면 발밑. 0/2/0x7f.

## 끝내기
- 잡기·찾기 (CMopServer::Dead 0x47872a): 패턴 4(노란 이름) 몬스터, 상태 1·2, 아직 안 함, 그림 == +0x41f4, **죽은 맵 == +0x41e0 (맡긴 맵)** — 원작 그대로. 찾기는 물건을 퀘스트 아이템으로 받는다.
- 전하기: 목표 맵에서 그림이 +0x41f4 인 NPC 를 누르면 퀘스트 아이템을 거두고 0/7/0xf3. 아이템이 없으면 퀘스트 취소.
- 맡긴 NPC (맵·그림·이름이 같음): 아직이면 0xa5/0xa6/0xa7 + 창. 다 했으면 보상 후 1: 0xa9, 0xaa / 2: 0xab, 물건 거둠, 0xac / 3: 0xad. **그 뒤에도 NPC 의 원래 일은 계속한다.**
- 시간 (OnTimer): 분이 바뀌면 창을 다시 보냄. 끝나면 물건 거두고 0/2/0xcb.

## 퀘스트 창 (SendQuestInfo 0x4254e0 → SendSetQuestInfoWindow 0x425320, 패킷 0x38d)
보조 퀘스트가 있으면 그것만 보내고 끝 (이야기 퀘스트보다 먼저). 줄 1 제목 0xf6/0xf8/0xfa, 줄 2 0xf7/0xf9/0xfb, 줄 3 남은 분 (클라이언트 "%13u %s", 0/7/0xf4).
- 0xf7: (목표 맵, 몬스터, 맡긴 맵, 맡긴 NPC)
- 0xf9: (목표 맵, 몬스터, 물건, 맡긴 맵, 맡긴 NPC)
- 0xfb: (물건, 목표 맵, 목표 NPC, 맡긴 맵, 맡긴 NPC)
줄 0 은 세 칸을 모두 지운다 (클라이언트 0x100277bc).

## 저장
원작이 이 칸들을 DB 에 저장하는지는 아직 확인하지 못했다. 여기서는 저장하지 않는다 (접속을 끊으면 퀘스트 아이템만 남는다).
