import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import opsAuth from './api/ops-auth.js';
import { isLocalDevelopmentRequest } from './api/lib/ops-session.js';

const sessionSecret = 'local-ops-session-secret-with-more-than-32-bytes';

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request({ host = 'localhost:3000', origin = 'http://localhost:3000', password = 'anything' } = {}) {
  return { method: 'POST', headers: { host, origin }, body: { password } };
}

test('local bypass is available only in Vercel development on a loopback hostname', () => {
  assert.equal(isLocalDevelopmentRequest(request(), { VERCEL_ENV: 'development' }), true);
  assert.equal(isLocalDevelopmentRequest(request(), {}), true);
  assert.equal(isLocalDevelopmentRequest(request({ host: 'growtheko.com', origin: 'https://growtheko.com' }), { VERCEL_ENV: 'development' }), false);
  assert.equal(isLocalDevelopmentRequest(request(), { VERCEL_ENV: 'production' }), false);
  assert.equal(isLocalDevelopmentRequest(request(), { NODE_ENV: 'production' }), false);
});

test('localhost accepts any non-empty value and creates a non-Secure local session cookie', () => {
  const previous = { env: process.env.VERCEL_ENV, secret: process.env.GROWTHEKO_OPS_SESSION_SECRET };
  process.env.VERCEL_ENV = 'development';
  process.env.GROWTHEKO_OPS_SESSION_SECRET = sessionSecret;
  try {
    const res = response();
    opsAuth(request({ password: 'open' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.local_dev, true);
    assert.equal(res.body.redirect, '/ops');
    assert.match(res.headers['set-cookie'], /^growtheko_ops_session=/);
    assert.doesNotMatch(res.headers['set-cookie'], /; Secure(?:;|$)/);
  } finally {
    if (previous.env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous.env;
    if (previous.secret === undefined) delete process.env.GROWTHEKO_OPS_SESSION_SECRET; else process.env.GROWTHEKO_OPS_SESSION_SECRET = previous.secret;
  }
});

test('production still requires the configured password and emits a Secure cookie', () => {
  const previous = {
    env: process.env.VERCEL_ENV,
    secret: process.env.GROWTHEKO_OPS_SESSION_SECRET,
    password: process.env.GROWTHEKO_OPS_PASSWORD_HASH
  };
  process.env.VERCEL_ENV = 'production';
  process.env.GROWTHEKO_OPS_SESSION_SECRET = sessionSecret;
  process.env.GROWTHEKO_OPS_PASSWORD_HASH = createHash('sha256').update('correct').digest('hex');
  try {
    const denied = response();
    opsAuth(request({ host: 'growtheko.com', origin: 'https://growtheko.com', password: 'wrong' }), denied);
    assert.equal(denied.statusCode, 401);

    const allowed = response();
    opsAuth(request({ host: 'growtheko.com', origin: 'https://growtheko.com', password: 'correct' }), allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.redirect, '/ops');
    assert.match(allowed.headers['set-cookie'], /; Secure(?:;|$)/);
    assert.equal(allowed.body.local_dev, undefined);
  } finally {
    if (previous.env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous.env;
    if (previous.secret === undefined) delete process.env.GROWTHEKO_OPS_SESSION_SECRET; else process.env.GROWTHEKO_OPS_SESSION_SECRET = previous.secret;
    if (previous.password === undefined) delete process.env.GROWTHEKO_OPS_PASSWORD_HASH; else process.env.GROWTHEKO_OPS_PASSWORD_HASH = previous.password;
  }
});
