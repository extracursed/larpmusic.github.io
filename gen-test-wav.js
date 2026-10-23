/* Временный генератор тестового WAV для проверки плеера */
const fs = require('fs');
const path = require('path');

const rate = 22050, secs = 4, freq = 440;
const n = rate * secs;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const env = Math.min(1, i / 1000, (n - i) / 1000);
  buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000 * env), 44 + i * 2);
}
fs.writeFileSync(path.join(__dirname, 'test-tone.wav'), buf);
console.log('written', buf.length, 'bytes');
