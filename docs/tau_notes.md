# Tau (시그너스 돈) 분석 노트

원본: `svMapServer.exe`. 구현: `world.js` (isSignus, cur, itemInfo 5/2, giveItem, buy/sell, bankOf, deathPenalty), `trade.js`.

- 사용자 칸 +0x3f98 (64비트, 한도 4,000,000,000 = 0xee6b2800). DB 칸 `SigMoney`. 돈은 +0x3f90.
- 아이템으로는 분류 5 번호 2 (AddItem 0x431d07). 시그너스 몬스터가 떨어뜨린다 (배치표 아이템 칸 [5,2,n]).
- **시그너스 맵**: 0x5d~0x6c (93~108), 0x89~0xb0 (137~176). 여기서는
  - 상점에서 사고팔 때 돈 대신 Tau (ProcessUserBuyItem 0x4294f0: 모자라면 0/2/0x170, ProcessUserSellItem 0x42a540: 넘치면 0x171).
  - 은행은 따로 (돈 칸과 아이템 칸 모두 은행 종류 1: ProcessAddBankMoney 0x41dc10, ProcessGetBankMoney 0x41e3d0, SendBankInfo 0x41ec10).
- 죽을 때: 아이템·돈과 같은 확률로 Tau 를 모두 떨어뜨린다 (DropSigMoney 0x433610, Dead 0x43af25).
- 거래: 돈 칸 아래에 Tau 칸. 받는 쪽이 40억을 넘으면 0/2/0x9f (ProcessAddTradeItem 0x40eb70, TradeOK).
- 캐릭터 창의 물방울 칸에 보인다.
- 아직: 소지품에서 Tau 떨어뜨리기·건네기 (0/0/436·437, ProcessDropItem·ProcessGiveItem — 돈 떨어뜨리기도 아직 없다), 우편에 Tau 붙이기.
