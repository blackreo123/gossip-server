const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// CORS 설정 (iOS 앱에서 접근 가능하도록)
app.use(cors());
app.use(express.json());

// Socket.IO 설정
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 메모리 기반 데이터 저장소
let gossipQueue = [];           // 뒷담화 큐
let userUsage = new Map();      // 사용자별 일일 사용량
let reportQueue = [];           // 신고 큐 (새로 추가)
let bannedUsers = new Set();    // 차단된 사용자 (새로 추가)
let activeGossip = null;        // 현재 표시중인 뒷담화
let displayTimer = null;        // 5초 타이머

const PORT = process.env.PORT || 3000;

// 강화된 콘텐츠 필터링 (새로 추가)
const contentFilter = {
  bannedWords: [
    '시발', '씨발', '개새끼', '병신', '좆', '존나', '개놈', '년', '놈', '디져', '뒤져',
    '보지', '자지', '따먹', '강간', '섹스', '쎅스', '빠구리', '창녀', '창년', '창놈',
    '죽어', '죽일', '살인', '폭행', '테러', '자살', '마약', '대마초', '도박', '미친',
    '개미친', '또라이', '정신병자', '바보', '멍청이', '븅신', '니미', '니애미',
    '개쓰레기', '쓰레기', '썅', '시발놈', '개자식', '자식', '개년', '걸레'
  ],
  
  suspiciousPatterns: [
    /\d{3}-?\d{4}-?\d{4}/, // 전화번호 패턴
    /010-?\d{4}-?\d{4}/,   // 휴대폰 번호
    /@[a-zA-Z0-9]+/,       // 이메일/소셜미디어
    /카톡|텔레|라인|위챗|인스타|페북/, // 메신저 앱
    /http|www\.|\.com|\.kr/ // 웹사이트
  ],
  
  checkContent(content) {
    const lowerContent = content.toLowerCase();
    
    // 금지어 체크
    for (const word of this.bannedWords) {
      if (lowerContent.includes(word)) {
        return { allowed: false, reason: '부적절한 언어가 포함되어 있습니다' };
      }
    }
    
    // 의심스러운 패턴 체크
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(content)) {
        return { allowed: false, reason: '개인정보나 연락처가 포함되어 있을 수 있습니다' };
      }
    }
    
    // 반복 문자 체크 (4번 이상 반복)
    if (/(.)\1{3,}/.test(content)) {
      return { allowed: false, reason: '의미 없는 반복 문자는 사용할 수 없습니다' };
    }
    
    // 숫자만 있는 경우
    if (/^\d[\d\s\-\(\)]*$/.test(content)) {
      return { allowed: false, reason: '숫자만으로는 메시지를 작성할 수 없습니다' };
    }
    
    return { allowed: true };
  }
};

// 기본 라우트 (서버 상태 확인용)
app.get('/', (req, res) => {
  res.json({
    message: '임귀당귀 서버가 실행중입니다! 🗣️',
    activeUsers: io.sockets.sockets.size,
    queueLength: gossipQueue.length,
    currentGossip: activeGossip,
    totalReports: reportQueue.length,
    bannedUsersCount: bannedUsers.size
  });
});

// 뒷담화 생성 API (강화된 필터링 적용)
app.post('/api/gossip', (req, res) => {
  const { content, deviceId } = req.body;
  
  // 차단된 사용자 체크
  if (bannedUsers.has(deviceId)) {
    return res.status(403).json({ error: '이용이 제한된 사용자입니다' });
  }
  
  // 입력 유효성 검사
  if (!content || content.length > 50) {
    return res.status(400).json({ error: '내용은 1-50자 사이여야 합니다.' });
  }
  
  // 콘텐츠 필터링
  const filterResult = contentFilter.checkContent(content);
  if (!filterResult.allowed) {
    return res.status(400).json({ error: filterResult.reason });
  }
  
  // 일일 사용량 확인
  const today = new Date().toDateString();
  const userKey = `${deviceId}-${today}`;
  const usage = userUsage.get(userKey) || 0;
  
  if (usage >= 3) {
    return res.status(429).json({ error: '하루 3번만 사용 가능합니다.' });
  }
  
  // 뒷담화 생성
  const gossip = {
    id: uuidv4(),
    content: content.trim(),
    createdAt: new Date(),
    deviceId
  };
  
  // 큐에 추가
  gossipQueue.push(gossip);
  
  // 사용량 증가
  userUsage.set(userKey, usage + 1);
  
  // 모든 클라이언트에 새 뒷담화 알림
  io.emit('new-gossip', {
    queueLength: gossipQueue.length,
    userUsage: usage + 1
  });
  
  res.json({ 
    success: true, 
    queuePosition: gossipQueue.length,
    userUsage: usage + 1
  });
  
  console.log(`📝 새 뒷담화: "${content}" (큐 길이: ${gossipQueue.length})`);
  
  // 현재 표시중인 뒷담화가 없다면 바로 시작
  if (!activeGossip) {
    processNextGossip();
  }
});

// 신고 접수 API (새로 추가)
app.post('/api/report', (req, res) => {
  const { content, reason, timestamp, deviceId, appVersion } = req.body;
  
  if (!content || !reason || !deviceId) {
    return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
  }
  
  const report = {
    id: uuidv4(),
    content,
    reason,
    timestamp,
    deviceId,
    appVersion,
    reportedAt: new Date(),
    status: 'pending'
  };
  
  reportQueue.push(report);
  
  console.log(`🚨 신고 접수: "${content}" - 사유: ${reason}`);
  
  // 심각한 내용의 경우 자동 사용자 차단
  if (isSeriosViolation(content, reason)) {
    bannedUsers.add(deviceId);
    console.log(`🔨 자동 차단: ${deviceId} (심각한 위반)`);
  }
  
  res.json({ success: true, reportId: report.id });
});

// 심각한 위반 여부 판단
function isSeriosViolation(content, reason) {
  const seriousReasons = ['harassment', '괴롭힘/혐오', 'violence', '폭력적 내용', 'sexual', '성적인 내용'];
  const seriousWords = ['죽', '살인', '강간', '테러', '자살', '죽어', '죽일'];
  
  // 심각한 신고 사유
  if (seriousReasons.some(serious => reason.includes(serious))) {
    return true;
  }
  
  // 심각한 단어 포함
  for (const word of seriousWords) {
    if (content.includes(word)) {
      return true;
    }
  }
  
  return false;
}

// 사용량 확인 API (차단 체크 추가)
app.get('/api/usage/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  // 차단된 사용자 체크
  if (bannedUsers.has(deviceId)) {
    return res.status(403).json({ error: '이용이 제한된 사용자입니다.' });
  }
  
  const today = new Date().toDateString();
  const userKey = `${deviceId}-${today}`;
  const usage = userUsage.get(userKey) || 0;
  
  res.json({ 
    usage,
    remaining: 3 - usage,
    resetTime: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString()
  });
});

// 관리자 API - 신고 목록 조회 (새로 추가)
app.get('/api/admin/reports', (req, res) => {
  res.json({
    reports: reportQueue.slice(-50), // 최근 50개만
    totalCount: reportQueue.length,
    pendingCount: reportQueue.filter(r => r.status === 'pending').length,
    bannedUsersCount: bannedUsers.size
  });
});

// 다음 뒷담화 처리 함수 (기존 유지)
function processNextGossip() {
  if (gossipQueue.length === 0) {
    activeGossip = null;
    io.emit('gossip-display', { gossip: null, timeLeft: 0 });
    return;
  }
  
  // 큐에서 다음 뒷담화 가져오기
  activeGossip = gossipQueue.shift();
  
  console.log(`📢 표시 시작: "${activeGossip.content}"`);
  
  // 모든 클라이언트에 뒷담화 표시
  io.emit('gossip-display', { 
    gossip: activeGossip, 
    timeLeft: 5,
    queueLength: gossipQueue.length 
  });
  
  // 5초 카운트다운
  let timeLeft = 5;
  const countdownInterval = setInterval(() => {
    timeLeft--;
    io.emit('countdown', { timeLeft, gossip: activeGossip });
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      console.log(`🗑️ 삭제됨: "${activeGossip.content}"`);
      
      // 1초 후 다음 뒷담화 처리
      setTimeout(() => {
        processNextGossip();
      }, 1000);
    }
  }, 1000);
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log(`🔗 클라이언트 연결: ${socket.id}`);
  
  // 연결시 현재 상태 전송
  socket.emit('current-state', {
    activeGossip,
    queueLength: gossipQueue.length
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 클라이언트 연결 해제: ${socket.id}`);
  });
});

// 자정마다 사용량 초기화
function resetDailyUsage() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime();
  
  setTimeout(() => {
    console.log('🌙 자정! 일일 사용량을 초기화합니다.');
    userUsage.clear();
    
    // 매일 자정마다 반복
    setInterval(() => {
      console.log('🌙 일일 사용량 초기화');
      userUsage.clear();
    }, 24 * 60 * 60 * 1000);
    
  }, msUntilMidnight);
}

// 정기적으로 오래된 신고 기록 정리 (7일 후)
function cleanupOldReports() {
  setInterval(() => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const initialCount = reportQueue.length;
    
    reportQueue = reportQueue.filter(report => 
      new Date(report.reportedAt) > weekAgo
    );
    
    const cleanedCount = initialCount - reportQueue.length;
    if (cleanedCount > 0) {
      console.log(`🧹 오래된 신고 기록 ${cleanedCount}개 정리`);
    }
  }, 24 * 60 * 60 * 1000); // 24시간마다
}

// 서버 시작
server.listen(PORT, () => {
  console.log(`🚀 임귀당귀 서버가 포트 ${PORT}에서 실행중입니다!`);
  console.log(`🌍 http://localhost:${PORT} 에서 확인하세요`);
  console.log(`🔞 18세 이상 전용 익명 소통 서비스`);
  console.log(`🛡️ 강화된 콘텐츠 필터링 및 신고 시스템 활성화`);
  
  resetDailyUsage();
  cleanupOldReports();
});