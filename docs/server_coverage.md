# 원작 서버 패킷 대조표 (CMapServerClient::ProcessPacket 0x40b7b0)

원작 서버가 클라이언트에게서 받는 패킷마다 처리 함수가 있다. 그 함수들을 우리 판과 하나씩 맞대 본 표다.

- 패킷 번호와 함수는 ProcessPacket 의 switch 를 Ghidra 로 풀어 뽑았다. 원본 목록은 tools/coverage/packets.txt 다.
- 상태는 이렇게 나눈다.
  - **구현**: 우리 판에 같은 기능이 있다.
  - **확인 필요**: 비슷한 것은 있지만 원작 함수를 읽고 맞춰 보지 않았다.
  - **없음**: 아직 우리 판에 없다.
  - **운영자 기능**, **군단**: 뒤로 미룬 것이다.
- "근거" 칸의 O 는 우리 코드나 문서에 그 원작 함수 이름이 적혀 있다는 뜻이다. 그 함수를 읽고 옮겼다는 표시다.
  - 구현인데 O 가 없으면, 원작 함수를 직접 읽지 않고 다른 경로로 맞춘 것이다. 다시 읽어 확인해야 한다.

## 합계

- 군단 (맨 마지막): 78
- 구현: 48
- 운영자 기능 (뒤로): 17
- 확인 필요: 7
- 없음: 5

## 표

| 패킷 | 원작 함수 | 상태 | 근거 |
|---|---|---|---|
| 0x0 | ProcessRegisterUser | 구현 | O |
| 0x1 | ProcessCancelItemGrowth | 없음 |  |
| 0x3 | ProcessRegisterUser | 구현 | O |
| 0x7c | ProcessUserMoving | 구현 | O |
| 0xca | ProcessUserMoving | 구현 | O |
| 0xcc | ProcessSetUserPosition | 해당 없음 — 클라이언트가 자리를 알려 맞추는 것. 우리 판은 서버가 자리를 정한다 (0x43dc50) |  |
| 0xd2 | ProcessUserAttack | 구현 | O |
| 0xd4 | ProcessUserAttackRange | 확인 필요 | O |
| 0xdc | ProcessGetItem | 구현 | O |
| 0xde | ProcessDropItem | 구현 — 땅에 아이템·돈(4)·시그(0x13) 버리기. 거래 중이면 0xa0, +0x4394 면 0x182, 이벤트 0x12 칸이면 안 됨 (0x42f210). 원작은 클라이언트가 고른 자리, 우리 판은 발밑. 화면에서는 아이콘을 빈 곳으로 끌어 놓는다 | O |
| 0xe0 | ProcessGiveItem | 구현 — 같은 맵 사람에게 아이템·돈·시그 건네기 (GiveItemTo 0x462a90: 거래 중 0xa0, 이벤트 10 칸 한쪽만 0x18, 돈 넘침 5, Tau 넘침 0x16f, 같은 아이템 40억 4, 다 못 받으면 2). 화면에서는 소지품 아이콘을 사람 위로 끌어 놓는다 (원작 클라이언트 조작은 확인 못 함) | O |
| 0xe2 | ProcessMoveItem | 구현 | O |
| 0xe4 | ProcessUseItem | 구현 | O |
| 0xf2 | ProcessSelectedBattleChar | 없음 |  |
| 0xfa | ProcessUseSkill | 구현 | O |
| 0xfc | ProcessRegisterSkill | 구현 | O |
| 0xfe | ProcessUseGateSkill | 구현 | O |
| 0x100 | ProcessUseRecallSkill | 구현 | O |
| 0x102 | ProcessResponseRecall | 구현 | O |
| 0x104 | ProcessRestart | 구현 | O |
| 0x106 | ProcessUseBonus | 구현 | O |
| 0x108 | ProcessTeleportationTo | 구현 | O |
| 0x10a | ProcessResponseRevival | 구현 | O |
| 0x110 | ProcessInviteGroup | 구현 | O |
| 0x112 | ProcessLeaveGroup | 구현 — 원작 확인: 이름이 있으면 그룹장이 그 사람을 내보내고(16자 이하), 없으면 스스로 나간다 (0x440430). group.js 와 같다 |  |
| 0x114 | ProcessJoinGroup | 구현 | O |
| 0x118 | ProcessInformEvent | 구현 | O |
| 0x12e | ProcessChat | 구현 | O |
| 0x1ae | ProcessGetMailList | 구현 | O |
| 0x1b0 | ProcessReadMail | 구현 | O |
| 0x1b4 | ProcessWriteMail | 구현 — 원작 확인: 거래 중 0xa0, 성장 창(+0x4394) 열림 0x182 (0x410b10). 0x182 는 성장 창을 만들 때 넣는다 |  |
| 0x1b6 | ProcessEndWriteMail | 구현 | O |
| 0x1b8 | ProcessDelMail | 구현 | O |
| 0x1ba | ProcessStartWritingMail | 구현 | O |
| 0x1bc | ProcessGetMailItem | 구현 | O |
| 0x1be | ProcessCancelWritingMail | 구현 — 원작 확인: 쓰던 편지를 버린다 (0x410b00) |  |
| 0x1cc | ProcessAddBankMoney | 구현 | O |
| 0x1ce | ProcessAddBankItem | 구현 | O |
| 0x1d0 | ProcessGetBankMoney | 구현 | O |
| 0x1d2 | ProcessGetBankItem | 구현 | O |
| 0x1d6 | ProcessCure | 구현 | O |
| 0x1da | ProcessMoveJail | 구현 | O |
| 0x1f4 | ProcessGetShopSellList | 다름 — 원작은 군단 아지트 상점이면 세금(GetArmyShopTax 0~100%)을 붙인다 (0x429230). 우리 판에는 세금이 없다 (군단 일) |  |
| 0x1f6 | ProcessUserBuyItem | 구현 | O |
| 0x1f8 | ProcessUserSellItem | 구현 | O |
| 0x1fa | ProcessGetShopBuyList | 다름 — 위와 같은 세금 쪽 (0x42a260) |  |
| 0x386 | ProcessInformUserSelection | 구현 | O |
| 0x3b6 | ProcessExchangeSellItem | 구현 | O |
| 0x3b8 | ProcessExchangeRequestItemList | 다름 — 원작은 한 번에 24 개씩 쪽으로 보낸다 (GetItemForSaleList, 0x40f610). 우리 판 쪽 나누기는 맞춰 보지 않음 |  |
| 0x3ba | ProcessExchangeBuyItem | 구현 | O |
| 0x3be | ProcessExchangeCancel | 구현 | O |
| 0x3ca | ProcessTryTrade | 구현 | O |
| 0x3cc | ProcessResponseAskTrade | 구현 — 원작 확인: 실제 일은 CMapServerServer::ResponseAskTrade 0x443260 이고 trade.js 에 근거가 있다 |  |
| 0x3ce | ProcessAddTradeItem | 구현 | O |
| 0x3d0 | ProcessCancelTrade | 구현 — 원작 확인: CMapServerServer::CancelTrade 0x444280, trade.js |  |
| 0x3d2 | ProcessTradeOK | 구현 | O |
| 0x3f6 | ProcessChangePKMode | 구현 | O |
| 0x3f8 | ProcessOperatorInvisible | 운영자 기능 (뒤로) |  |
| 0x44c | ProcessCloseMap | 운영자 기능 (뒤로) |  |
| 0x450 | ProcessPreserveItem | 운영자 기능 (뒤로) |  |
| 0x452 | ProcessChangeMapPKMode | 없음 | O |
| 0x456 | ProcessMobRegen | 운영자 기능 (뒤로) |  |
| 0x458 | ProcessOpenOpBulletin | 운영자 기능 (뒤로) | O |
| 0x45a | ProcessManageDumbUser | 운영자 기능 (뒤로) |  |
| 0x45c | ProcessManageOPArmy | 운영자 기능 (뒤로) |  |
| 0x45e | ProcessManageOPPKTimer | 운영자 기능 (뒤로) | O |
| 0x460 | ProcessOpenOPShop | 운영자 기능 (뒤로) |  |
| 0x462 | ProcessWarpToUser | 운영자 기능 (뒤로) |  |
| 0x466 | ProcessManageSurvivalEvent | 운영자 기능 (뒤로) |  |
| 0x468 | ProcessChangeMoveSkillMode | 운영자 기능 (뒤로) |  |
| 0x46a | ProcessChangeChatMode | 운영자 기능 (뒤로) |  |
| 0x46c | ProcessChangeSkillMode | 운영자 기능 (뒤로) |  |
| 0x46e | ProcessChangeMoveMode | 운영자 기능 (뒤로) |  |
| 0x470 | ProcessManageUserSanction | 운영자 기능 (뒤로) |  |
| 0x472 | ProcessManageChatLogUser | 운영자 기능 (뒤로) |  |
| 0x4be | ProcessMoveItemToGrowthWindow | 없음 |  |
| 0x4c0 | ProcessTryItemGrowth | 없음 |  |
| 0x70a | ProcessClickReserveArmy | 군단 (맨 마지막) | O |
| 0x70c | ProcessTryToCreateReserveArmy | 군단 (맨 마지막) | O |
| 0x70e | ProcessAttemptCreateReserveArmy | 군단 (맨 마지막) | O |
| 0x710 | ProcessSearchReserveArmy | 군단 (맨 마지막) | O |
| 0x712 | ProcessClickReserveArmyList | 군단 (맨 마지막) | O |
| 0x714 | ProcessTryToCreateArmy | 군단 (맨 마지막) | O |
| 0x716 | ProcessCreateArmyInfo | 군단 (맨 마지막) | O |
| 0x718 | ProcessInviteInitMember | 군단 (맨 마지막) | O |
| 0x71a | ProcessRemoveInitMember | 군단 (맨 마지막) | O |
| 0x71c | ProcessAttemptCreateArmy | 군단 (맨 마지막) | O |
| 0x71e | ProcessCancelCreateArmy | 군단 (맨 마지막) | O |
| 0x720 | ProcessJoinReserveArmyInitMember | 군단 (맨 마지막) | O |
| 0x724 | ProcessResponseInviteInitMember | 군단 (맨 마지막) | O |
| 0x726 | ProcessArmyManagementLogin | 군단 (맨 마지막) | O |
| 0x728 | ProcessRewriteNotice | 군단 (맨 마지막) | O |
| 0x72a | ProcessFinishRewriteNotice | 군단 (맨 마지막) | O |
| 0x72c | ProcessManageSubCommander | 군단 (맨 마지막) |  |
| 0x72e | ProcessAppointSubCommander | 군단 (맨 마지막) | O |
| 0x730 | ProcessSubArmyCreateInfo | 군단 (맨 마지막) | O |
| 0x732 | ProcessChangeSubCommander | 군단 (맨 마지막) | O |
| 0x734 | ProcessSubArmyChangeInfo | 군단 (맨 마지막) | O |
| 0x736 | ProcessClickSubCommanderPermission | 군단 (맨 마지막) |  |
| 0x738 | ProcessRequestSubCommanderPermission | 군단 (맨 마지막) | O |
| 0x73a | ProcessChangeSubCommanderPermission | 군단 (맨 마지막) | O |
| 0x73c | ProcessClickSubCommanderPassword | 군단 (맨 마지막) |  |
| 0x73e | ProcessChangeSubCommanderPassword | 군단 (맨 마지막) | O |
| 0x740 | ProcessClickRequestArmyAlliance | 군단 (맨 마지막) | O |
| 0x742 | ProcessRequestArmyAlliance | 군단 (맨 마지막) |  |
| 0x744 | ProcessAnswerArmyAlliance | 군단 (맨 마지막) | O |
| 0x748 | ProcessClickManageArmyWar | 군단 (맨 마지막) |  |
| 0x74a | ProcessStartDeclareWar | 군단 (맨 마지막) |  |
| 0x74c | ProcessFinishDeclareWar | 군단 (맨 마지막) |  |
| 0x74e | ProcessEndWarAgreement | 군단 (맨 마지막) |  |
| 0x750 | ProcessAnswerEndWarAgreement | 군단 (맨 마지막) |  |
| 0x752 | ProcessSurrenderOfWar | 군단 (맨 마지막) |  |
| 0x754 | ProcessClickArmyMemberInfo | 군단 (맨 마지막) | O |
| 0x756 | ProcessChangeCommanderPassword | 군단 (맨 마지막) | O |
| 0x758 | ProcessChangeArmyCommander | 군단 (맨 마지막) | O |
| 0x75a | ProcessResultAskChangeCommander | 군단 (맨 마지막) | O |
| 0x75c | ProcessClickAgitManagement | 군단 (맨 마지막) |  |
| 0x75e | ProcessClickManageShopTax | 군단 (맨 마지막) |  |
| 0x760 | ProcessChangeTax | 군단 (맨 마지막) |  |
| 0x762 | ProcessPayAgitRentCost | 군단 (맨 마지막) |  |
| 0x764 | ProcessRestoreAgit | 군단 (맨 마지막) |  |
| 0x768 | ProcessClickArmySafeMoney | 군단 (맨 마지막) |  |
| 0x76a | ProcessClickArmySafeItem | 군단 (맨 마지막) |  |
| 0x76c | ProcessAddArmySafeMoney | 군단 (맨 마지막) |  |
| 0x76e | ProcessGetArmySafeMoney | 군단 (맨 마지막) |  |
| 0x770 | ProcessAddArmySafeItem | 군단 (맨 마지막) |  |
| 0x772 | ProcessGetArmySafeItem | 군단 (맨 마지막) |  |
| 0x774 | ProcessArmyInfoWindow | 군단 (맨 마지막) | O |
| 0x776 | ProcessWithdrawalFromArmy | 군단 (맨 마지막) | O |
| 0x778 | ProcessReturnAgit | 군단 (맨 마지막) |  |
| 0x77a | ProcessClickArmyEmployment | 군단 (맨 마지막) |  |
| 0x77c | ProcessArmyEmployment | 군단 (맨 마지막) | O |
| 0x77e | ProcessAnswerJoinArmy | 군단 (맨 마지막) | O |
| 0x780 | ProcessSubArmyEmployment | 군단 (맨 마지막) | O |
| 0x782 | ProcessAnswerJoinSubArmy | 군단 (맨 마지막) | O |
| 0x784 | ProcessWarpToMember | 군단 (맨 마지막) |  |
| 0x788 | ProcessClickEmptyAgit | 군단 (맨 마지막) |  |
| 0x78a | ProcessRentEmptyAgit | 군단 (맨 마지막) |  |
| 0x78c | ProcessPayArmyActivityCost | 군단 (맨 마지막) |  |
| 0x78e | ProcessClickBreakArmyAlliance | 군단 (맨 마지막) |  |
| 0x790 | ProcessBreakArmyAlliance | 군단 (맨 마지막) | O |
| 0x792 | ProcessBreakUpReserveArmy | 군단 (맨 마지막) | O |
| 0x794 | ProcessRequestSubArmyMemberInfo | 군단 (맨 마지막) | O |
| 0x796 | ProcessBreakUpArmy | 군단 (맨 마지막) | O |
| 0x798 | ProcessGoArmyAgit | 군단 (맨 마지막) |  |
| 0x79a | ProcessSubmitEnteredCode | 군단 (맨 마지막) |  |
| 0x79c | ProcessClickManageArmyBase | 군단 (맨 마지막) |  |
| 0x79e | ProcessClickAddBaseGuard | 군단 (맨 마지막) |  |
| 0x7a0 | ProcessAddBaseGuard | 군단 (맨 마지막) |  |
| 0x7a2 | ProcessClickRepairArmyBase | 군단 (맨 마지막) |  |
| 0x7a4 | ProcessRepairArmyBase | 군단 (맨 마지막) |  |
| 0x7a6 | ProcessRestoreArmyBase | 군단 (맨 마지막) |  |
| 0x7a8 | ProcessOpenArmyBaseShop | 군단 (맨 마지막) |  |
| 0x7ae | ProcessClickChangeAgitTaxRate | 군단 (맨 마지막) |  |
| 0x7b0 | ProcessClickDeclareWar | 군단 (맨 마지막) |  |
