require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { Usage, Report, BannedUser, UserBlock } = require('./models');

const app = express();
const server = http.createServer(app);

// CORS 설정 (iOS 앱에서 접근 가능하도록)
app.use(cors());
app.use(express.json());

// MongoDB 연결
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gossipapp';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB 연결 성공'))
  .catch(err => {
    console.error('❌ MongoDB 연결 실패:', err.message);
    process.exit(1);
  });

// Socket.IO 설정
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 메모리에만 유지해도 되는 데이터 (큐, 타이머 등)
let gossipQueue = [];           // 뒷담화 큐
let activeGossip = null;        // 현재 표시중인 뒷담화
let displayTimer = null;        // 10초 타이머

const PORT = process.env.PORT || 3000;

// 오늘 날짜 문자열 (YYYY-MM-DD)
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

// 강화된 콘텐츠 필터링
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

    for (const word of this.bannedWords) {
      if (lowerContent.includes(word)) {
        return { allowed: false, reason: '부적절한 언어가 포함되어 있습니다' };
      }
    }

    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(content)) {
        return { allowed: false, reason: '개인정보나 연락처가 포함되어 있을 수 있습니다' };
      }
    }

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
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 뒷담화 생성 API
app.post('/api/gossip', async (req, res) => {
  try {
    const { content, deviceId } = req.body;

    // 차단된 사용자 체크
    const isBanned = await BannedUser.exists({ deviceId });
    if (isBanned) {
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
    const today = getTodayString();
    const usageDoc = await Usage.findOne({ deviceId, date: today });
    const usage = usageDoc ? usageDoc.count : 0;

    if (usage >= 10) {
      return res.status(429).json({ error: '하루 10번만 사용 가능합니다.' });
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

    // 사용량 증가 (upsert)
    await Usage.findOneAndUpdate(
      { deviceId, date: today },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );

    const newUsage = usage + 1;

    // 모든 클라이언트에 새 뒷담화 알림
    io.emit('new-gossip', {
      queueLength: gossipQueue.length,
      userUsage: newUsage
    });

    res.json({
      success: true,
      queuePosition: gossipQueue.length,
      userUsage: newUsage
    });

    console.log(`📝 새 뒷담화: "${content}" (큐 길이: ${gossipQueue.length})`);

    // 현재 표시중인 뒷담화가 없다면 바로 시작
    if (!activeGossip) {
      processNextGossip();
    }
  } catch (err) {
    console.error('뒷담화 생성 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 신고 접수 API
app.post('/api/report', async (req, res) => {
  try {
    const { content, reason, timestamp, deviceId, appVersion } = req.body;

    if (!content || !reason || !deviceId) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    const report = await Report.create({
      content,
      reason,
      timestamp,
      deviceId,
      appVersion
    });

    console.log(`🚨 신고 접수: "${content}" - 사유: ${reason}`);

    // 심각한 내용의 경우 자동 사용자 차단
    if (isSeriousViolation(content, reason)) {
      await BannedUser.findOneAndUpdate(
        { deviceId },
        { deviceId, bannedAt: new Date() },
        { upsert: true }
      );
      console.log(`🔨 자동 차단: ${deviceId} (심각한 위반)`);
    }

    res.json({ success: true, reportId: report._id });
  } catch (err) {
    console.error('신고 접수 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 심각한 위반 여부 판단
function isSeriousViolation(content, reason) {
  const seriousReasons = ['harassment', '괴롭힘/혐오', 'violence', '폭력적 내용', 'sexual', '성적인 내용'];
  const seriousWords = ['죽', '살인', '강간', '테러', '자살', '죽어', '죽일'];

  if (seriousReasons.some(serious => reason.includes(serious))) {
    return true;
  }

  for (const word of seriousWords) {
    if (content.includes(word)) {
      return true;
    }
  }

  return false;
}

// 사용량 확인 API
app.get('/api/usage/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    // 차단된 사용자 체크
    const isBanned = await BannedUser.exists({ deviceId });
    if (isBanned) {
      return res.status(403).json({ error: '이용이 제한된 사용자입니다.' });
    }

    const today = getTodayString();
    const usageDoc = await Usage.findOne({ deviceId, date: today });
    const usage = usageDoc ? usageDoc.count : 0;

    res.json({
      usage,
      remaining: 10 - usage,
      resetTime: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (err) {
    console.error('사용량 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 사용자 차단 API
app.post('/api/block', async (req, res) => {
  try {
    const { deviceId, targetDeviceId } = req.body;

    if (!deviceId || !targetDeviceId) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    if (deviceId === targetDeviceId) {
      return res.status(400).json({ error: '자기 자신을 차단할 수 없습니다.' });
    }

    await UserBlock.findOneAndUpdate(
      { deviceId, targetDeviceId },
      { deviceId, targetDeviceId, blockedAt: new Date() },
      { upsert: true }
    );

    console.log(`🚫 사용자 차단: ${deviceId} → ${targetDeviceId}`);

    res.json({ success: true });
  } catch (err) {
    console.error('사용자 차단 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 API - 신고 목록 조회
app.get('/api/admin/reports', async (req, res) => {
  try {
    const reports = await Report.find().sort({ reportedAt: -1 }).limit(50);
    const totalCount = await Report.countDocuments();
    const pendingCount = await Report.countDocuments({ status: 'pending' });
    const bannedUsersCount = await BannedUser.countDocuments();

    res.json({
      reports,
      totalCount,
      pendingCount,
      bannedUsersCount
    });
  } catch (err) {
    console.error('신고 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 다음 뒷담화 처리 함수
function processNextGossip() {
  if (gossipQueue.length === 0) {
    activeGossip = null;
    io.emit('gossip-display', { gossip: null, timeLeft: 0 });
    return;
  }

  activeGossip = gossipQueue.shift();

  console.log(`📢 표시 시작: "${activeGossip.content}"`);

  io.emit('gossip-display', {
    gossip: activeGossip,
    timeLeft: 10,
    queueLength: gossipQueue.length
  });

  let timeLeft = 10;
  const countdownInterval = setInterval(() => {
    timeLeft--;
    io.emit('countdown', { timeLeft, gossip: activeGossip });

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      console.log(`🗑️ 삭제됨: "${activeGossip.content}"`);

      setTimeout(() => {
        processNextGossip();
      }, 1000);
    }
  }, 1000);
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log(`🔗 클라이언트 연결: ${socket.id}`);

  socket.emit('current-state', {
    activeGossip,
    queueLength: gossipQueue.length
  });

  socket.on('disconnect', () => {
    console.log(`🔌 클라이언트 연결 해제: ${socket.id}`);
  });
});

// 오래된 사용량 데이터 정리 (2일 이상 된 것)
function cleanupOldData() {
  setInterval(async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const cutoffDate = yesterday.toISOString().split('T')[0];

      const usageResult = await Usage.deleteMany({ date: { $lt: cutoffDate } });
      if (usageResult.deletedCount > 0) {
        console.log(`🧹 오래된 사용량 데이터 ${usageResult.deletedCount}개 정리`);
      }

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const reportResult = await Report.deleteMany({ reportedAt: { $lt: weekAgo } });
      if (reportResult.deletedCount > 0) {
        console.log(`🧹 오래된 신고 기록 ${reportResult.deletedCount}개 정리`);
      }
    } catch (err) {
      console.error('데이터 정리 오류:', err);
    }
  }, 24 * 60 * 60 * 1000); // 24시간마다
}

// 서버 시작
server.listen(PORT, () => {
  console.log(`🚀 임귀당귀 서버가 포트 ${PORT}에서 실행중입니다!`);
  console.log(`🌍 http://localhost:${PORT} 에서 확인하세요`);
  console.log(`🛡️ 강화된 콘텐츠 필터링 및 신고 시스템 활성화`);
  console.log(`🗄️ MongoDB 기반 영구 저장소 사용중`);

  cleanupOldData();
});
