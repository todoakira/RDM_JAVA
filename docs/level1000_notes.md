# 레벨 1000 퀘스트 (전설의 단약) 분석 노트

원본: `svMapServer.exe`, `rmDB.dll` 의 DB 호출, 원작 DB `redmoon_Data.MDF` 의 저장 프로시저 (`tools/story_mail.py` 가 찢어진 페이지를 고쳐 읽는다).
구현: `world.js` (gainExp, useBonus, useSpecialItem, initBonusPoint, tryMakeMysteryPill, Pills), 대본 이벤트 44~46.

## DB 칸 (tblGameID1)
- `Bonus2` (+0x3f86): 레벨 1000 점수. 전설의 단약·인공 단약으로 얻는다.
- `SBonus` (+0x3f88): 단약 점수. 레벨 1000 에서 경험치를 다 채울 때마다 +2.
- `STotalBonus` (+0x3f8a): 지금까지 받은 합.
- 클라이언트에 보내는 남은 점수 = 보통 점수(+0x3f84) + Bonus2 + SBonus (SendBonusInfo 0x439dd0).

## 레벨 1000 되기 (DoExperimentUp 0x438e70)
- 999 → 1000: RMS_LEVEL1000MAIL (보낸이 `[Kasham]`, 제목 "Legendary Medicine") + 0/2/0x74.
- 1000 에서 필요 경험치를 채우면: 경험치 0, RMS_INCREASEBONUSQUESTCOUNT (SBonus +2, STotalBonus +2), 점수 정보, 레벨업 효과.

## 점수 쓰기 (ProcessUseBonus 0x438800)
보통 점수 → Bonus2 → SBonus 순으로 1 을 쓴다. (원작은 능력치 합이 레벨식과 맞는지 검사한다: 여기서는 뺐다.)

## 카삼 (ProcessEvent 종류 29, 0x421064)
다른 이야기 차례가 아니면, SBonus 가 0 이면 0/7/0x297, 아니면 `Level1000Quest` (이벤트 44): 대사 287·288, 선택 289/290, "만든다" 면 7초 뒤 `TryMakeMysteryPill`.

## TryMakeMysteryPill (DoEventServerAction, RMS_TRYMAKEMYSTERYPILL)
- 서버가 6/66 을 넣을 칸(소지품 0~99 또는 빠른 창 0~7)을 찾는다. 없으면 아무 일도 없다.
- SBonus ≥ 1 이고 STotalBonus ≥ 1 이면 둘 다 −1.
- tblSpecialItemLimit1 의 6/66 한도가 서버 전체 6/66 개수(tblSpecialItem1)보다 크고 RAND()%100 ≥ 70 이면 전설의 단약을 넣는다.
- 아이템 수가 늘었으면 `MakeMysteryPillSuccess` (이벤트 45: 291·292), 아니면 `MakeMysteryPillFail` (이벤트 46: 293·294).
- **받은 원작 DB 의 tblSpecialItemLimit1 은 비어 있다** (sysindexes 의 첫 페이지 0, 행 수 0). 그대로면 한도 0 이라 만들 수 없다. 여기서는 `save/pills.json` 의 `limit` 으로 운영자가 정한다 (기본 0). `count` 는 만든 수 − 먹은 수.

## 특수 아이템 (ProcessUseItem 0x430f73~)
- 6/66 전설의 단약 (RMS_USEMYSTERYPILL): Bonus2 +4, STotalBonus +4.
- 6/74 인공 단약 (RMS_USEARTIFICIALMYSTERYPILL): STotalBonus < 200 일 때만 +2/+2. 아이템은 어느 쪽이든 없어진다.
- 6/67 극약: InitBonusPoint (0x428e10: 순수 능력치 모두 10, 보통 점수 = L/100 + 2L, RMS_INITBONUS2: Bonus2 = STotalBonus − SBonus 또는 0) 뒤 `Dead("+Poison+")` 로 죽는다.
- (6/0x44 는 0x439930(100), 6/0xc3 은 0/2/0x183: 아직)

## 저장
DB 의 SELECT 에 SubQuestKind·SubQuestDone·…·SubQuestTimer 칸이 있어 보조 퀘스트도 저장된다 (이번에 함께 저장하도록 고쳤다). Bonus2·SBonus·STotalBonus 도 저장한다.
