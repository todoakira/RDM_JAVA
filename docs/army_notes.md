# 군단(Army) 해독 메모

원작 파일에서 읽은 것만 적는다. 서버 svMapServer.exe(3944판), DB 함수 rmDB.dll(3944판 CArmy), DB 저장 프로시저 redmoon_Data.MDF(RMS_ARMY_*), 클라이언트 Main.dll.

## 영문 용어 (Message.ctf 0/0)
- 0xe6 " PENDING" = 예비 군단(Free Agent Army, DB State=-1) 목록, 0xe7 "IMMEDIATE" = 바로 만들기, 0xe8 "  MANAGE" = 관리(비밀번호)
- 0x199 "Free Agent Army created", 0x19a "Addition accepted.", 0x19b "Deletion completed.", 0x19c "Your army has now been created.", 0x19d "You have successfully joined an army."
- 0x1a7 "Double click on list to see Free Agent Army detailed report and menu.", 0x1a8 "This Free Agent Army does not exist."

## 진영(Camp, GetArmySide 0x464820)
맵 47 → 1, 맵 109 → 2, 그 밖 0. 0 이면 군단 컴퓨터 일(예비 군단 목록 등)을 하지 않는다. 맵 0xb4~0xbc 도 0.
군단 컴퓨터는 이벤트 종류 11 (EventInfo 24번, 맵 47·109 의 클릭 영역 24). ProcessEvent case 0xb → 패킷 0x709.

## 조건
- 군단장 자격 (CheckCommanderLicense 0x411fe0): 레벨 400 이상, 명성 절댓값 400 이상 (서버 종류 3·4 는 300). 아니면 0/2/0x11a "To create army you must be at level %u and honor %u."
- 핵심 멤버 자격 (CanBeInitMember 0x412090): 군단에 없고 레벨 300 이상 (서버 종류 3·4 는 200). 아니면 0/2/0x25
- 예비 군단 수 100 미만 (0xd6), 군단 수 100 미만 (0xd5), 핵심 멤버 50 미만 (0xf0)
- 탈퇴·해산 뒤 7일은 다시 들 수 없다 (RMS_ARMY_ADDREJOINSANCTION, 0/2/0x164)
- 정식 군단이 되려면 GetArmyMemberCount(멤버 + 군단장 1) >= 11 (ProcessAttemptCreateArmy 0x4131f0, 모자라면 0x1d)
- 일반 병사 한도 = 군단장 레벨/10 + 100 (ProcessArmyEmployment 0x4197f0, 넘으면 0x26)

## DB (tblArmyList1: Mark, State, Camp, Name, Commander, Password, CreateTime, ActivityPeriod, Notice, ...)
- State -1 예비 군단(이름 10자, 공지 166자, 7일), -2 예비 군단에서 만드는 중, -3 바로 만드는 중, 1 정식 군단 (활동 기간 한 달)
- 예비 군단 핵심 멤버가 10명이 되면 군단장에게 ArmyAdmin 우편 "Create Pending Army" (RMS_ARMY_ADDARMYINITMEMBER)
- 문장(Mark): 진영 1 은 1~100, 진영 2 는 101~200. 이미 쓰는 문장은 고를 수 없다 (GetArmyCreateInfo, 0xef)
- 해산 (RMS_ARMY_BREAKUPARMY Kind 1): 모든 멤버와 군단장에게 우편 "Army Disbandment", 모두 7일 재가입 제한
- 탈퇴 (RMS_ARMY_REMOVEARMYMEMBER Kind 0), 해고 Kind 1 은 우편 "Dismiss New Soldier"

## 패킷 (클라이언트 → 서버, 서버 표 0x40d534)
0x70a 예비 목록, 0x70c 예비 만들기 시도, 0x70e 예비 만들기(이름 11 + 공지 84), 0x710 찾기, 0x712 예비 상세, 0x714 군단 만들기 시도, 0x716 만들기 정보(이름·비밀번호·문장),
0x718 핵심 멤버 초대, 0x71a 핵심 멤버 빼기, 0x71c 만들기 마침, 0x71e 만들기 취소, 0x720 예비 군단 핵심 멤버로 들기, 0x724 초대 대답, 0x726 관리 로그인(비밀번호),
0x728/0x72a 공지 고치기, 0x754 멤버 정보, 0x774 군단 정보 창, 0x776 탈퇴, 0x77a/0x77c/0x77e 병사 모집·대답, 0x792 예비 해산, 0x796 군단 해산
(그 밖: 부대·부관, 동맹, 전쟁, 홀(아지트), 금고, 본부, 상점 세금 — 아직)

## 클라이언트 창 (Main.dll, 받는 패킷 처리 0x10028530)
- 0x709 → ia-z18-ba (군단 컴퓨터, 146×130, 0x10062660): 단추 ia-z18-bu 97×23 세 개 (24,18) (24,44) (24,69), 글 0/0/0xe6~0xe8, 닫기 n-ia-cl-bu (42,99)
- 0x70b/0x711 → ia-z38-ba (예비 목록, 0x100600b0), 0x70d → ia-z36-ba (예비 만들기, 0x10061a40), 0x713 → ia-z35-ba (예비 상세, 0x1005e440)
- 0x715 → ia-z22-ba (만들기 정보, 0x1004c350), 0x717~0x71d → ia-z8-ba (핵심 멤버, 0x1005ae60)
- 0x727 → ia-z20-ba (관리, 0x100534f0), 0x729 → ia-z15-ba (공지), 0x755 → ia-z4-ba (멤버), 0x775 → n-ia-ib-ba (군단 정보, 0x1003e870), 0x77b → ia-z11-ba (모집)
- 군단 대화: ProcessArmyChat 0x4417a0, 5초에 세 번, "이름 : 글", 대화 종류 5

## 2단계에서 읽은 것
- 클라이언트 주 객체 vtable 0x100ac9c0: +0x214 = 0x70a 보내기, +0x228 = 0x714 ... (창 단추 처리 함수가 jmp/call [edx+off] 로 부른다)
- 관리 ia-z20-ba 단추 → 0x72c, 동맹 창(ia-z7), 0x748, 공지 고르기(ia-z21 +0x9f270), 0x754, 군단장 관리(ia-z21 +0xa1a58), 0x75c, 0x79c, 해산 확인 0/0/0x65
- 군단 정보 단추 → 0/0/0x148 탈퇴 확인, 0x149 부대 탈퇴, FUN_1001ed50(1~3) 모집 창(ia-z11), 0/0/0x1a5 홀, 0/0/0x1a4 멤버에게 가기
- 문장 그리기 0x100012f0: 모양 표 0x100c6a18[0..19] = is-i0~19-bu, 특수 0x100c6a00 = is-i20~25-bu, 틀 0x100c6a68 = is-f2-bu,
  색 = 번호 % 10 → {0,1,4,5,9,0x12,0x13,0x19,0x1c,0x1d} → 색 표 0x100c777c + 색*64 (효과 0xb). 색 표는 .data 의 초기값 없는 곳이라 실행 중에 채워진다.
- 창 초기화 함수를 유니콘으로 돌려 Create 호출을 뽑는 도구: tools(작업 폴더) emuwin.py
