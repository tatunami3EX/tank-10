// TANK-10: Online Tunnel & Server Starter
// Runs game server + internet tunnel with zero character encoding issues
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.clear();
console.log('===============================================================');
console.log('   🎮 TANK-10 インターネット公開サーバー');
console.log('   Wi-Fiが違っても（4G/5G・外出先・友達）どこからでも遊べます！');
console.log('===============================================================\n');

// 1. Start Local Game Server
console.log('[1/2] ゲームサーバーを起動中 (http://localhost:3000)...');
require('./server.js');

// 2. Start SSH Tunnel to Pinggy using "qr@a.pinggy.io" (No password required!)
console.log('[2/2] インターネット公開URLを発行中 (Pinggy Tunnel)...');
console.log('      ※ 数秒お待ちください...\n');

const sshArgs = [
  '-p', '443',
  '-R0:localhost:3000',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  'qr@a.pinggy.io'
];

const ssh = spawn('ssh', sshArgs, { stdio: ['inherit', 'pipe', 'pipe'] });

let urlFound = false;

function handleOutput(data) {
  const str = data.toString();
  process.stdout.write(str);

  // Search for the generated https://*.a.pinggy.link URL
  const match = str.match(/https:\/\/[a-z0-9\-]+\.a\.pinggy\.link/i);
  if (match && !urlFound) {
    urlFound = true;
    const publicUrl = match[0];

    console.log('\n===============================================================');
    console.log('  🎉 インターネット公開URLが正常に発行されました！');
    console.log('  スマホ（4G/5G回線OK）や友達に以下のURLを送ってください：');
    console.log(`  👉  ${publicUrl}`);
    console.log('===============================================================\n');
  }
}

ssh.stdout.on('data', handleOutput);
ssh.stderr.on('data', handleOutput);

ssh.on('error', (err) => {
  console.error('\n[!] SSH起動エラー:', err.message);
  console.log('同じWi-Fiのスマホからは http://192.168.0.10:3000 で遊べます。');
});

ssh.on('close', (code) => {
  console.log(`\nトンネル接続が終了しました (Code: ${code})`);
});

// Handle termination gracefully
process.on('SIGINT', () => {
  if (ssh) ssh.kill();
  process.exit(0);
});
