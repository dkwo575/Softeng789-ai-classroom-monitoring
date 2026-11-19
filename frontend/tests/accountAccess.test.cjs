const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function bundle(file, external = []) {
  return buildSync({ entryPoints: [path.join(__dirname, '../src/features/account-access', file)],
    bundle: true, write: false, platform: 'node', format: 'cjs', loader: { '.css': 'empty' }, external }).outputFiles[0].text;
}
function load(code, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, TextEncoder,
    require: name => deps[name] ?? require(name) });
  return module.exports;
}
const model = load(bundle('accountLinkModel.ts'));
test('proofs are accepted only from one exact fragment, not queries or redirect payloads', () => {
  const token = 'a'.repeat(43);
  assert.equal(model.parseAccountLinkHash('#account-link=' + token), token);
  assert.equal(model.parseAccountLinkHash('?account-link=' + token), null);
  for (const suffix of ['', token + '&redirect=https://evil.test', '../secret', token + '%00']) {
    assert.equal(model.parseAccountLinkHash('#account-link=' + suffix), '');
  }
});
test('reset and registration share UTF-8 password bounds and confirmation policy', () => {
  assert.equal(model.passwordIssue('好'.repeat(24), '好'.repeat(24)), '');
  assert.match(model.passwordIssue('好'.repeat(25), '好'.repeat(25)), /72 UTF-8 bytes/);
  assert.match(model.passwordIssue('short', 'short'), /8 characters/);
  assert.match(model.passwordIssue('valid-password', 'different'), /do not match/);
});
test('email screening bounds input first and uses unambiguous address/domain separators', () => {
  for (const value of ['person@example.test', 'first.last+tag@sub.example.test', 'a'.repeat(242) + '@example.test']) {
    assert.equal(model.isAccountEmail(value), true, value);
  }
  for (const value of ['', 'missing-domain@', '@example.test', 'a@@example.test', 'a@example',
    'a@.test', 'a@example.', 'a@sub..example.test', 'a b@example.test', 'a@example.test\n',
    'a'.repeat(243) + '@example.test', 'a'.repeat(100000) + '@']) {
    assert.equal(model.isAccountEmail(value), false);
  }
});
test('account access sends proof in same-origin POST body, never in route or authorization header', async () => {
  const calls = [];
  const api = load(bundle('api.ts', ['../../lib/apiClient']), { '../../lib/apiClient': {
    request: async (route, options) => { calls.push({ route, options }); return { message: 'Accepted' }; }
  } });
  await api.inspectAccountLink('secret-proof'); await api.resetAccountPassword('secret-proof', 'secret-password');
  await api.requestAccountLink('person@example.test', 'PASSWORD_RESET');
  assert.deepEqual(calls.map(call => call.route), ['/api/auth/account-links/inspect',
    '/api/auth/account-links/reset-password', '/api/auth/account-links']);
  for (const call of calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.ok(!call.route.includes('secret'));
  }
  assert.equal(JSON.parse(calls[1].options.body).token, 'secret-proof');
});

function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  const children = [element.props?.children].flat(Infinity);
  return [element, ...children.flatMap(nodes)];
}
function formHarness(send, availability = { capabilities: { accountEmail: true, assistedActivation: true }, error: '', retry() {} }) {
  const state = []; let cursor = 0;
  const react = {
    ...require('react'),
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => { state[i] = value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; }
  };
  const component = load(bundle('AccountLinkRequestForm.tsx', ['react', 'react/jsx-runtime', './api', '../../lib/apiClient', '../../lib/workflowCapabilities']), {
    react, './api': { requestAccountLink: send }, '../../lib/apiClient': { apiMessage: failure => failure.message },
    '../../lib/workflowCapabilities': { useWorkflowCapabilities: () => availability },
  }).default;
  const props = { purpose: 'PASSWORD_RESET', onBack() {} };
  const render = () => { cursor = 0; return component(props); };
  return { render, props, enter(value) { nodes(render()).find(node => node.type === 'input' && node.props.type === 'email')
    .props.onChange({ target: { value } }); } };
}
test('request form prevents double submission and does not reveal whether an account exists', async () => {
  let resolve; let calls = 0;
  const h = formHarness(() => { calls++; return new Promise(done => { resolve = done; }); });
  h.enter('person@example.test');
  const first = h.render().props.onSubmit({ preventDefault() {} });
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.ok(nodes(h.render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled);
  resolve({ message: 'If this address is eligible, check your inbox.' }); await first;
  assert.ok(nodes(h.render()).some(node => node.type === 'output'));
});
test('disabled mail is an explicit failure, preserves the address and offers a retry', async () => {
  const h = formHarness(async () => { throw new Error('Account email is not configured yet; no email was sent.'); });
  h.enter('person@example.test'); await h.render().props.onSubmit({ preventDefault() {} });
  const view = nodes(h.render());
  assert.ok(view.some(node => node.props?.role === 'alert'));
  assert.ok(!view.some(node => node.type === 'output'));
  assert.equal(view.find(node => node.type === 'input').props.value, 'person@example.test');
  assert.equal(view.find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false);
});

test('unconfigured mail has no send action and cannot submit a recovery request', async () => {
  let calls = 0;
  const h = formHarness(async () => { calls++; }, { capabilities: { accountEmail: false, assistedActivation: true }, error: '' });
  const view = nodes(h.render());
  assert.equal(view.some(node => node.type === 'input' && node.props.type === 'email'), false);
  assert.equal(view.some(node => node.type === 'button' && node.props.type === 'submit'), false);
  assert(JSON.stringify(view).includes('Password recovery by email is not available'));
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(calls, 0);
});

test('local staff activation explains the administrator route without an unusable email form', () => {
  const h = formHarness(() => assert.fail('No mail should be requested'), {
    capabilities: { accountEmail: false, assistedActivation: true }, error: '',
  });
  h.props.purpose = 'STAFF_ACTIVATION';
  const view = nodes(h.render());
  assert(JSON.stringify(view).includes('single-use activation link'));
  assert.equal(view.some(node => node.props?.type === 'email'), false);
});

test('failed capability lookup offers retry without enabling an unverified mail workflow', () => {
  let retries = 0;
  const h = formHarness(() => assert.fail('No mail should be requested'), {
    capabilities: null, error: 'Server unavailable', retry() { retries++; },
  });
  const view = nodes(h.render());
  assert(view.some(node => node.props?.role === 'alert'));
  view.find(node => node.type === 'button' && node.props.children === 'Check again').props.onClick();
  assert.equal(retries, 1);
  assert.equal(view.some(node => node.props?.type === 'email'), false);
});

function capabilityHarness() {
  const state = [], effects = [], queued = [], calls = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((value, n) => value !== old.deps[n])) queued.push(() => {
        old?.cleanup?.(); effects[i] = { deps, cleanup: effect() };
      });
    },
  };
  const { useWorkflowCapabilities } = load(bundle('../../lib/workflowCapabilities.ts', ['react', './apiClient']), {
    react, './apiClient': { apiMessage: error => error.message,
      request: route => new Promise((resolve, reject) => calls.push({ route, resolve, reject })) },
  });
  return { calls, render() { cursor = 0; const value = useWorkflowCapabilities(); queued.splice(0).forEach(fn => fn()); return value; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}

test('workflow availability is a read-only lookup with no assumed mail readiness', async () => {
  const h = capabilityHarness();
  assert.equal(h.render().capabilities, null);
  assert.deepEqual(h.calls.map(call => call.route), ['/api/auth/capabilities']);
  h.calls[0].resolve({ accountEmail: false, assistedActivation: true, invoiceEmail: false, reportEmail: false });
  await Promise.resolve();
  assert.equal(h.render().capabilities.accountEmail, false);
  assert.equal(h.calls.length, 1);
  h.unmount();
});

test('availability failures fail closed and retry only on request', async () => {
  const h = capabilityHarness(); h.render();
  h.calls[0].reject(new Error('Offline'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.render().capabilities, null);
  assert.equal(h.render().error, 'Offline');
  assert.equal(h.calls.length, 1);
  h.render().retry(); h.render();
  assert.equal(h.calls.length, 2);
  h.unmount();
  h.calls[1].resolve({ accountEmail: true }); await Promise.resolve();
  assert.equal(h.render().capabilities, null);
});

function accountPage({ details = null, loading = false, done = false } = {}) {
  let cursor = 0;
  const values = [details, loading, '', false, done, '', '', false];
  const react = {
    ...require('react'),
    useState: initial => [values[cursor++] ?? initial, () => {}],
    useRef: initial => ({ current: initial }),
    useEffect() {},
  };
  const component = load(bundle('../../pages/AccountAccessPage.tsx', [
    'react', 'react/jsx-runtime', './AuthPage', '../components/PasswordField',
    '../lib/apiClient', '../features/account-access/api',
  ]), {
    react, './AuthPage': () => null, '../components/PasswordField': () => null,
    '../lib/apiClient': { apiMessage: error => error.message }, '../features/account-access/api': {},
  }).default;
  return nodes(component({ token: 'test-proof', auth: {} }));
}

test('password reset uses an explicit submit button and navigation never submits the form', () => {
  const details = { purpose: 'PASSWORD_RESET', email: 'person@example.test' };
  const resetButtons = accountPage({ details }).filter(node => node.type === 'button');
  assert.equal(resetButtons.length, 2);
  assert.equal(resetButtons[0].props.type, 'submit');
  assert.equal(resetButtons[1].props.type, 'button');
  const doneButtons = accountPage({ details, done: true }).filter(node => node.type === 'button');
  assert.equal(doneButtons.length, 1);
  assert.equal(doneButtons[0].props.type, 'button');
});

test('link inspection and request confirmation use semantic status output with phrasing content', async () => {
  assert.equal(accountPage({ loading: true }).some(node => node.type === 'output'), true);
  const h = formHarness(async () => ({ message: 'If eligible, check your inbox.' }));
  h.enter('person@example.test');
  await h.render().props.onSubmit({ preventDefault() {} });
  const output = nodes(h.render()).find(node => node.type === 'output');
  assert.equal(output.props.children, 'If eligible, check your inbox.');
  assert.equal(nodes(output).some(node => ['h3', 'p', 'div', 'section'].includes(node.type)), false);
});

function registrationPage(initialMode = 'register', registrationOptions) {
  const state = []; let cursor = 0; const submitted = [];
  const effects = []; let mounted = false;
  const react = { ...require('react'), useEffect(fn) { if (registrationOptions && !mounted) effects.push(fn); },
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; } };
  const component = load(bundle('../../pages/AuthPage.tsx', [
    'react', 'react/jsx-runtime', '../components/auth/LoginForm', '../components/auth/RegisterForm',
    '../components/auth/StudentFaceRegistrationStep', '../lib/apiClient', '../lib/classAdminApi',
    '../lib/faceEnrollment', '../features/account-access', '../features/student-signup',
  ]), {
    react, '../components/auth/LoginForm': 'LoginForm', '../components/auth/RegisterForm': 'RegisterForm',
    '../components/auth/StudentFaceRegistrationStep': 'FaceStep',
    '../lib/apiClient': { request: async () => registrationOptions },
    '../lib/classAdminApi': { listPublicClasses: async () => [] },
    '../lib/faceEnrollment': { hasRequiredEnrollmentCaptures: captures => captures.length === 7 },
    '../features/account-access': { AccountLinkRequestForm: 'LinkRequest', StudentSignupForm: 'RegisterForm',
      ContactVerification: 'ContactVerification', passwordIssue: model.passwordIssue },
    '../features/student-signup': {
      emptyProfile: () => ({ dateOfBirth: null, schoolName: '', address: '', phone: '', contactEmail: '', guardian: null }),
      ...load(bundle('../student-signup/profileFormModel.ts')),
    },
  }).default;
  const auth = { clearError() {}, error: '', busy: false,
    async registerStudent(payload, captures) { submitted.push({ payload, captures }); return true; } };
  return { render() {
    cursor = 0; const element = component({ auth, initialMode });
    mounted = true; effects.splice(0).forEach(fn => fn());
    return element;
  }, submitted };
}

function fillFaceRegistration(h) {
  const details = h.render().props;
  details.onFullNameChange('New Student'); details.onStudentNumberChange('NEW-001');
  details.onProfileChange({ dateOfBirth: '2000-01-01', schoolName: 'School', address: '', phone: '', contactEmail: '', guardian: null });
  details.onEmailChange('new@example.test'); details.onPasswordChange('strong-password');
  details.onConfirmPasswordChange('strong-password'); details.onClassSelectionChange(['class-1']);
  details.onAttendanceModeChange('FACE');
}

test('face registration stays blocked while the feature is unavailable', async () => {
  const h = registrationPage();
  fillFaceRegistration(h);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 0);
  assert.equal(h.render().type, 'RegisterForm');
  assert.match(h.render().props.errorMessage, /Face registration is unavailable/);
});

test('face registration requires the capture step, current consent and all seven captures', async () => {
  const h = registrationPage('register', { faceEnabled: true, noticeVersion: 'test-notice' });
  fillFaceRegistration(h);
  await Promise.resolve();
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.render().type, 'FaceStep');
  assert.equal(h.submitted.length, 0);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 0);
  assert.match(h.render().props.errorMessage, /Confirm consent/);
  h.render().props.onConsentChange(true);
  h.render().props.onCapturesChange(Array(6).fill('capture'));
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 0);
  h.render().props.onCapturesChange(Array(7).fill('capture'));
  h.render().props.onConsentChange(false);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 0);
  assert.equal(h.render().props.captures.length, 0);
  h.render().props.onConsentChange(true);
  h.render().props.onCapturesChange(Array(7).fill('capture'));
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].payload.attendanceMode, 'FACE');
  assert.equal(h.submitted[0].payload.consentGiven, true);
  assert.equal(h.submitted[0].payload.adultConfirmed, true);
  assert.equal(h.submitted[0].payload.noticeVersion, 'test-notice');
  assert.equal(h.submitted[0].captures.length, 7);
});

test('student registration opens the original form directly while staff activation still verifies email', () => {
  const h = registrationPage();
  assert.equal(h.render().type, 'RegisterForm');
  assert.equal(h.render().props.verifiedEmail, false);
  h.render().props.onSwitchRole('teacher');
  assert.equal(h.render().type, 'LinkRequest');
  assert.equal(h.render().props.purpose, 'STAFF_ACTIVATION');
  h.render().props.onPurposeChange('STUDENT_REGISTRATION');
  assert.equal(h.render().type, 'RegisterForm');
});

test('password recovery still requests a verified email link', () => {
  const h = registrationPage('login');
  h.render().props.onForgotPassword();
  assert.equal(h.render().type, 'LinkRequest');
  assert.equal(h.render().props.purpose, 'PASSWORD_RESET');
});

test('direct manual registration retains details and class choice without requiring face photos', async () => {
  const h = registrationPage();
  const details = h.render().props;
  details.onFullNameChange('New Student'); details.onStudentNumberChange('NEW-001');
  details.onProfileChange({ dateOfBirth: '2000-01-01', schoolName: 'School', address: '', phone: '', contactEmail: '', guardian: null });
  details.onEmailChange('new@example.test'); details.onPasswordChange('strong-password');
  details.onConfirmPasswordChange('strong-password'); details.onClassSelectionChange(['class-1']);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.render().type, 'RegisterForm');
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].payload.universityEmail, 'new@example.test');
  assert.deepEqual([...h.submitted[0].payload.classOfferingIds], ['class-1']);
  assert.equal(h.submitted[0].payload.consentGiven, false);
  assert.equal(h.submitted[0].payload.emailProof, undefined);
  assert.equal(h.submitted[0].captures.length, 0);
});

test('student signup preserves the supplied ID until automatic issuance is separately enabled', async () => {
  const h = registrationPage();
  fillFaceRegistration(h);
  h.render().props.onAttendanceModeChange('MANUAL');
  h.render().props.onStudentNumberChange('FORGED-ID');
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.submitted[0].payload.studentNumber, 'FORGED-ID');
  assert.equal(h.submitted[0].payload.profile.dateOfBirth, '2000-01-01');
});
test('minor signup requires guardian details and cannot enter the adult face pilot', async () => {
  const h = registrationPage('register', { faceEnabled: true, noticeVersion: 'test-notice' });
  fillFaceRegistration(h);
  const base = { dateOfBirth: '2020-01-01', schoolName: '', address: '', phone: '', contactEmail: '' };
  h.render().props.onProfileChange({ ...base, guardian: null });
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.match(h.render().props.errorMessage, /guardian/);
  h.render().props.onProfileChange({ ...base, guardian: { name: 'Guardian', relationship: 'Parent', email: 'guardian@example.test', phone: '020000000' } });
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.match(h.render().props.errorMessage, /adult volunteer pilot/);
  assert.equal(h.submitted.length, 0);
});
test('guardian verification uses an explicit POST with independent signup permission', async () => {
  const calls = [];
  const api = load(bundle('api.ts', ['../../lib/apiClient']), { '../../lib/apiClient': {
    request: async (path, options) => calls.push({ path, options }),
  } });
  await api.confirmContact('proof', true, 'guardian-signup-v1');
  assert.equal(calls[0].path, '/api/auth/account-links/confirm-contact');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { token: 'proof', signupPermission: true, noticeVersion: 'guardian-signup-v1' });
});
