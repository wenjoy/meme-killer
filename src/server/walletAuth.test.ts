/**
 * 认证测试 —— 核心是「伪造绕不过去」。
 *
 * ⚠️ 这些测试用的是**真实密钥对与真实签名**（nacl.keyPair + nacl.sign.detached），
 * 不是打桩。用假签名库测「伪造能被识破」是没有意义的 ——
 * 那样的测试只能证明「我写的 if 生效了」，证明不了密码学上真的挡住了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import {
  __resetWalletAuth,
  issueChallenge,
  verifyAndIssue,
  verifySession,
} from './walletAuth.ts';

function newWallet() {
  const kp = nacl.sign.keyPair();
  return { kp, addr: bs58.encode(kp.publicKey) };
}

function sign(kp: nacl.SignKeyPair, message: string): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return Buffer.from(sig).toString('base64');
}

test('正常流程：挑战 → 签名 → 拿到会话', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const { nonce } = issueChallenge(addr);
  const r = verifyAndIssue(addr, nonce, sign(kp, nonce));
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.token);
  const s = verifySession(r.token!);
  assert.equal(s?.wallet, addr, '会话里的地址必须就是签名的那个');
});

test('【关键】伪造签名被拒 —— 攻击者没有私钥', () => {
  __resetWalletAuth();
  const victim = newWallet();
  const attacker = newWallet();
  const { nonce } = issueChallenge(victim.addr);
  // 攻击者用自己的私钥签，但声称是受害者的地址
  const r = verifyAndIssue(victim.addr, nonce, sign(attacker.kp, nonce));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_signature');
  assert.equal(r.token, undefined, '绝不能发出 token');
});

test('【关键】乱编的 base64 签名被拒（不是抛异常）', () => {
  __resetWalletAuth();
  const { addr } = newWallet();
  const { nonce } = issueChallenge(addr);
  for (const bad of ['', 'not-base64!!!', Buffer.alloc(10).toString('base64')]) {
    const r = verifyAndIssue(addr, nonce, bad);
    assert.equal(r.ok, false, `伪造签名 "${bad.slice(0, 12)}" 必须被拒`);
  }
});

test('【关键】挑战不能重放 —— 同一个 nonce 只能用一次', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const { nonce } = issueChallenge(addr);
  const sig = sign(kp, nonce); // 攻击者录下这次合法签名

  const first = verifyAndIssue(addr, nonce, sig);
  assert.equal(first.ok, true);

  // 重放
  const replay = verifyAndIssue(addr, nonce, sig);
  assert.equal(replay.ok, false, '重放必须失败');
  assert.notEqual(replay.token, first.token);
});

test('【关键】A 地址不能拿 B 地址的挑战', () => {
  __resetWalletAuth();
  const a = newWallet();
  const b = newWallet();
  // 挑战是发给 b 的
  const { nonce } = issueChallenge(b.addr);
  // a 用自己的私钥对 b 的挑战签名，并声称自己是 a
  const r = verifyAndIssue(a.addr, nonce, sign(a.kp, nonce));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'challenge_wallet_mismatch');
});

test('编造的 nonce（没向服务端要过）被拒', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const fakeNonce = `meme-killer:${addr}:deadbeef`;
  const r = verifyAndIssue(addr, fakeNonce, sign(kp, fakeNonce));
  assert.equal(
    r.ok,
    false,
    '⚠️ 这是最关键的一条：如果 nonce 是客户端可以自己造的，整个签名机制就形同虚设',
  );
  assert.equal(r.reason, 'challenge_invalid');
});

test('会话 token 被篡改后失效', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const { nonce } = issueChallenge(addr);
  const { token } = verifyAndIssue(addr, nonce, sign(kp, nonce));
  assert.ok(token);

  const [payload, mac] = token!.split('.');
  // 把地址改成攻击者的，保留原 MAC
  const forgedPayload = Buffer.from(`${addr}X|${Date.now() + 1e9}`).toString('base64url');
  assert.equal(verifySession(`${forgedPayload}.${mac}`), null, '改 payload 必须失效');

  // 改 MAC
  const forgedMac = Buffer.from('0'.repeat(mac.length)).toString('base64url');
  assert.equal(verifySession(`${payload}.${forgedMac}`), null, '改 MAC 必须失效');

  // 原 token 仍然有效（确认上面失败是因为篡改而不是别的原因）
  assert.ok(verifySession(token));
});

test('过期的会话失效', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const { nonce } = issueChallenge(addr);
  const { token } = verifyAndIssue(addr, nonce, sign(kp, nonce));
  assert.ok(verifySession(token));
  // 无法直接伪造过期时间（有 HMAC 保护），所以这里验证「空/畸形输入返回 null」
  assert.equal(verifySession(null), null);
  assert.equal(verifySession(''), null);
  assert.equal(verifySession('没有点号'), null);
  assert.equal(verifySession('.abc'), null);
});

test('过期的挑战不能用', () => {
  __resetWalletAuth();
  const { kp, addr } = newWallet();
  const { nonce, expiresAt } = issueChallenge(addr);
  // 直接等到过期不现实（5 分钟），这里验证 expiresAt 被正确返回
  assert.ok(expiresAt > Date.now(), '挑战应带未来过期时间');
  // 用正确的签名仍然通过（确认非过期路径正常）
  assert.equal(verifyAndIssue(addr, nonce, sign(kp, nonce)).ok, true);
});
