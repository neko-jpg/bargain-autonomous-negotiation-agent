import { ActorAuthError, attachActorCookie, createActor, getActor } from '../../src/lib/auth/actor';

export function runActorAuthTests(): boolean {
  console.log('\n--- 🪪 Running Actor Authentication Boundary Tests ---');
  let passed = true;

  const response = new Response(null);
  attachActorCookie(response, 'user-test-123');
  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';', 1)[0];
  const authenticated = getActor(new Request('http://localhost', { headers: { cookie } }));
  if (authenticated?.id === 'user-test-123') {
    console.log('✅ [PASS] Signed actor cookies round-trip successfully');
  } else {
    console.error('❌ [FAIL] Signed actor cookie could not be verified');
    passed = false;
  }

  const [cookieName, cookieValue] = cookie.split('=');
  const tamperedValue = `${cookieValue.slice(0, -1)}${cookieValue.endsWith('a') ? 'b' : 'a'}`;
  const tampered = `${cookieName}=${tamperedValue}`;
  try {
    getActor(new Request('http://localhost', { headers: { cookie: tampered } }));
    console.error('❌ [FAIL] Tampered actor cookie was accepted');
    passed = false;
  } catch (error) {
    if (error instanceof ActorAuthError && error.code === 'INVALID_ACTOR') {
      console.log('✅ [PASS] Tampered actor cookies are rejected');
    } else {
      console.error('❌ [FAIL] Tampered actor cookie returned an unexpected error');
      passed = false;
    }
  }

  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousBargainEnv = env.BARGAIN_ENV;
  const previousDemoHeaders = env.BARGAIN_ENABLE_DEMO_HEADERS;
  const previousSecret = env.BARGAIN_SESSION_SECRET;
  env.NODE_ENV = 'production';
  env.BARGAIN_ENV = 'production';
  env.BARGAIN_ENABLE_DEMO_HEADERS = 'false';
  delete env.BARGAIN_SESSION_SECRET;
  try {
    createActor(new Request('http://localhost'));
    console.error('❌ [FAIL] Production actor creation succeeded without a session secret');
    passed = false;
  } catch (error) {
    if (error instanceof ActorAuthError && error.code === 'AUTH_NOT_CONFIGURED') {
      console.log('✅ [PASS] Production auth fails closed without a session secret');
    } else {
      console.error('❌ [FAIL] Missing production auth secret returned an unexpected error');
      passed = false;
    }
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
    if (previousBargainEnv === undefined) delete env.BARGAIN_ENV;
    else env.BARGAIN_ENV = previousBargainEnv;
    if (previousDemoHeaders === undefined) delete env.BARGAIN_ENABLE_DEMO_HEADERS;
    else env.BARGAIN_ENABLE_DEMO_HEADERS = previousDemoHeaders;
    if (previousSecret === undefined) delete env.BARGAIN_SESSION_SECRET;
    else env.BARGAIN_SESSION_SECRET = previousSecret;
  }

  env.NODE_ENV = 'production';
  env.BARGAIN_ENV = 'local';
  env.BARGAIN_ENABLE_DEMO_HEADERS = 'false';
  env.BARGAIN_SESSION_SECRET = 'local-test-session-secret-that-is-long-enough';
  const previewActor = createActor(new Request('http://localhost', {
    headers: { 'x-bargain-user-id': 'demo-user-1', 'x-bargain-party-role': 'seller' },
  })).actor;
  if (previewActor.id.startsWith('user-') && previewActor.role === 'buyer') {
    console.log('✅ [PASS] Explicit local mode overrides preview NODE_ENV and ignores demo headers by default');
  } else {
    console.error('❌ [FAIL] Local Worker preview inherited production auth or trusted demo headers');
    passed = false;
  }

  env.NODE_ENV = 'development';
  env.BARGAIN_ENABLE_DEMO_HEADERS = 'true';
  const demoActor = getActor(new Request('http://localhost', {
    headers: { 'x-bargain-user-id': 'demo-user-1', 'x-bargain-party-role': 'seller' },
  }));
  if (demoActor?.id === 'demo-user-1' && demoActor.role === 'seller') {
    console.log('✅ [PASS] Demo headers require an explicit non-production opt-in');
  } else {
    console.error('❌ [FAIL] Explicit demo header opt-in did not work in local mode');
    passed = false;
  }

  if (previousNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = previousNodeEnv;
  if (previousBargainEnv === undefined) delete env.BARGAIN_ENV;
  else env.BARGAIN_ENV = previousBargainEnv;
  if (previousDemoHeaders === undefined) delete env.BARGAIN_ENABLE_DEMO_HEADERS;
  else env.BARGAIN_ENABLE_DEMO_HEADERS = previousDemoHeaders;
  if (previousSecret === undefined) delete env.BARGAIN_SESSION_SECRET;
  else env.BARGAIN_SESSION_SECRET = previousSecret;

  return passed;
}
