# 🗣️ 5초 뒷담화

익명으로 일상 속 작은 불만이나 생각을 털어놓고, 5초 후 자동으로 사라지는 실시간 소통 앱의 서버입니다.

## ✨ 주요 기능

- **🕶️ 완전 익명**: 사용자 식별 불가능
- **⏰ 5초 삭제**: 모든 메시지가 5초 후 자동 삭제
- **📱 하루 3회**: 일일 사용량 제한으로 신중한 소통
- **🔄 실시간**: Socket.IO를 통한 실시간 동기화
- **📝 50자 제한**: 간결하고 명확한 메시지

## 🛠️ 기술 스택

- **서버**: Node.js + Express
- **실시간 통신**: Socket.IO
- **클라이언트**: iOS (SwiftUI)

## 🚀 로컬 실행

```bash
# 의존성 설치
npm install

# 서버 실행
npm start
```

서버가 실행되면 `http://localhost:3000`에서 확인 가능합니다.

## 📡 API 엔드포인트

### 서버 상태 확인
```
GET /
```

### 뒷담화 작성
```
POST /api/gossip
Content-Type: application/json

{
  "content": "오늘 지하철이 너무 늦었어...",
  "deviceId": "unique-device-id"
}
```

### 일일 사용량 확인
```
GET /api/usage/:deviceId
```

## 🔌 Socket.IO 이벤트

### 서버 → 클라이언트
- `gossip-display`: 새로운 뒷담화 표시
- `countdown`: 5초 카운트다운 업데이트
- `new-gossip`: 새 뒷담화 알림

## 🎯 프로젝트 구조

```
📦 gossip-server
├── 📄 server.js          # 메인 서버 파일
├── 📄 package.json       # 프로젝트 설정
└── 📄 README.md          # 프로젝트 문서
```

## 🔄 작동 원리

1. 사용자가 뒷담화 작성
2. 큐에 순서대로 추가
3. 5초씩 순서대로 표시
4. 자동 삭제 후 다음 메시지 표시
5. 모든 사용자에게 실시간 동기화

## 📱 iOS 앱

이 서버와 연동되는 iOS 앱이 별도로 개발되어 있습니다.
- https://github.com/blackreo123/GossipApp

---

💡 **컨셉**: 어디에도 답답함을 소리칠 곳이 없으면 이곳에 적어서 날려보내요

