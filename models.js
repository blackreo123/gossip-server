const mongoose = require('mongoose');

// 일일 사용량
const usageSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  date: { type: String, required: true }, // "YYYY-MM-DD"
  count: { type: Number, default: 0 }
});
usageSchema.index({ deviceId: 1, date: 1 }, { unique: true });

// 신고
const reportSchema = new mongoose.Schema({
  content: { type: String, required: true },
  reason: { type: String, required: true },
  timestamp: String,
  deviceId: { type: String, required: true },
  appVersion: String,
  reportedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});

// 차단된 사용자 (관리자 차단)
const bannedUserSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  bannedAt: { type: Date, default: Date.now }
});

// 개인별 차단
const userBlockSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  targetDeviceId: { type: String, required: true },
  blockedAt: { type: Date, default: Date.now }
});
userBlockSchema.index({ deviceId: 1, targetDeviceId: 1 }, { unique: true });

module.exports = {
  Usage: mongoose.model('Usage', usageSchema),
  Report: mongoose.model('Report', reportSchema),
  BannedUser: mongoose.model('BannedUser', bannedUserSchema),
  UserBlock: mongoose.model('UserBlock', userBlockSchema)
};
