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
let activeGossip = null;        // 현재 표시중인 뒷담화
let displayTimer = null;        // 5초 타이머

const PORT = process.env.PORT || 3000;

// 기본 라우트 (서버 상태 확인용)
app.get('/', (req, res) => {
  res.json({
    message: '5초 뒷담화 서버가 실행중입니다! 🗣️',
    activeUsers: io.sockets.sockets.size,
    queueLength: gossipQueue.length,
    currentGossip: activeGossip
  });
});

// 뒷담화 생성 API
app.post('/api/gossip', (req, res) => {
  const { content, deviceId } = req.body;
  
  // 입력 유효성 검사
  if (!content || content.length > 50) {
    return res.status(400).json({ error: '내용은 1-50자 사이여야 합니다.' });
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

// 사용량 확인 API
app.get('/api/usage/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const today = new Date().toDateString();
  const userKey = `${deviceId}-${today}`;
  const usage = userUsage.get(userKey) || 0;
  
  res.json({ 
    usage,
    remaining: 3 - usage,
    resetTime: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString()
  });
});

// 다음 뒷담화 처리 함수
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

// 서버 시작
server.listen(PORT, () => {
  console.log(`🚀 5초 뒷담화 서버가 포트 ${PORT}에서 실행중입니다!`);
  console.log(`🌍 http://localhost:${PORT} 에서 확인하세요`);
  resetDailyUsage();
});