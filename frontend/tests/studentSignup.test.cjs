const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
function load(file, mocks = {}) {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../src/features/student-signup', file)], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: Object.keys(mocks), loader: { '.css': 'empty' } }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] ?? require(name), Intl, Date });
  return module.exports;
}
const model = load('profileFormModel.ts');
const adult = { dateOfBirth: '2000-01-01', schoolName: '', address: '', phone: '', contactEmail: '', guardian: null };
test('age policy uses Auckland dates and handles exact birthdays and leap-day anniversaries', () => {
  assert.equal(model.schoolDate(new Date('2026-11-18T12:00:00Z')), '2026-11-19');
  assert.equal(model.isMinor('2008-11-19', '2026-11-18'), true);
  assert.equal(model.isMinor('2008-11-19', '2026-11-19'), false);
  assert.equal(model.isMinor('2008-02-29', '2026-02-27'), true);
  assert.equal(model.isMinor('2008-02-29', '2026-02-28'), false);
});
test('signup requires DOB while legacy profiles can retain an unknown DOB', () => {
  assert.match(model.profileIssue({ ...adult, dateOfBirth: null }), /date of birth/);
  assert.equal(model.profileIssue({ ...adult, dateOfBirth: null }, false), '');
  for (const birth of ['2020-02-30', 'not-a-date', '2999-01-01'])
    assert.match(model.profileIssue({ ...adult, dateOfBirth: birth }), /valid date/);
});
test('guardian fields are required for minors and cannot reuse a student mailbox', () => {
  const minor = { ...adult, dateOfBirth: '2020-01-01' };
  assert.match(model.profileIssue(minor), /guardian/);
  const guardian = { name: 'Guardian', relationship: 'Parent', email: 'guardian@example.test', phone: '020000000' };
  assert.equal(model.profileIssue({ ...minor, guardian }), '');
  assert.match(model.profileIssue({ ...minor, guardian }, true, ' GUARDIAN@EXAMPLE.TEST '), /must differ/);
  assert.match(model.profileIssue({ ...minor, guardian, contactEmail: guardian.email }), /must differ/);
  assert.match(model.profileIssue({ ...minor, guardian: { ...guardian, phone: ' ' } }), /every guardian field/);
});
test('profile payload whitelist drops account privileges, confirmation timestamps and IDs', () => {
  const api = load('profileApi.ts', { '../../lib/apiClient': { request() {} } });
  const value = api.profileInput({ ...adult, id: 'someone', studentNumber: 'STU-1', version: 3, approvalStatus: 'APPROVED',
    guardian: { name: 'Guardian', relationship: 'Parent', email: 'g@example.test', phone: '020000000',
      revision: 'private', emailVerifiedAt: 'now', relationshipConfirmedAt: 'now' } });
  assert.deepEqual(Object.keys(value).sort(), ['address', 'contactEmail', 'dateOfBirth', 'guardian', 'phone', 'schoolName']);
  assert.deepEqual(Object.keys(value.guardian).sort(), ['email', 'name', 'phone', 'relationship']);
});
test('profile writes include optimistic version and verification uses authenticated POST bodies', async () => {
  const calls = [];
  const api = load('profileApi.ts', { '../../lib/apiClient': { request: async (url, options) => calls.push({ url, options }) } });
  await api.saveSelfProfile(7, adult);
  await api.requestContactVerification('GUARDIAN_VERIFICATION');
  assert.equal(calls[0].url, '/api/auth/signup/profile');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(JSON.parse(calls[0].options.body).version, 7);
  assert.equal(calls[1].url, '/api/auth/signup/verification');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { purpose: 'GUARDIAN_VERIFICATION' });
});

function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
test('guardian screen never confirms on inspection and submits only explicit permission once', async () => {
  const state = []; let cursor = 0; let sent = 0; let finish;
  const react = { ...require('react'),
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], next => { state[index] = next; }]; },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
  };
  const component = load('../account-access/ContactVerification.tsx', {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../../lib/apiClient': { apiMessage: error => error.message },
    './api': { confirmContact: async (token, permission, notice) => {
      sent++; assert.equal(token, 'private-proof'); assert.equal(permission, true);
      assert.equal(notice, 'guardian-signup-v1');
      return new Promise(resolve => { finish = resolve; });
    } },
  }).default;
  const render = () => { cursor = 0; return component({ token: 'private-proof',
    details: { purpose: 'GUARDIAN_VERIFICATION', role: 'STUDENT', email: null, studentName: 'Sample Student' } }); };
  let view = render();
  assert.equal(sent, 0);
  assert.equal(JSON.stringify(view).includes('private-proof'), false);
  assert.equal(nodes(view).find(node => node.type === 'button').props.disabled, true);
  await view.props.onSubmit({ preventDefault() {} });
  assert.equal(sent, 0);
  nodes(view).find(node => node.type === 'input').props.onChange({ target: { checked: true } });
  const submitted = render().props.onSubmit({ preventDefault() {} });
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(sent, 1);
  finish(); await submitted;
  assert.ok(nodes(render()).some(node => node.props?.role === 'status'));
});

const reviewModel = load('signupReviewModel.ts');
const verifiedGuardian = { name: 'Guardian', relationship: 'Parent', email: 'g@example.test', phone: '020000000',
  emailVerifiedAt: 'now', signupConsentedAt: 'now', relationshipConfirmedAt: 'now', revision: 'rev' };
const selfProfile = { ...adult, signupChecksRequired: true, loginEmail: 's@example.test', guardian: verifiedGuardian };

test('approval readiness excludes each pending guardian step and preserves exempt accounts', () => {
  const manual = { attendanceMode: 'MANUAL' };
  for (const [field, expected] of [
    ['emailVerifiedAt', /email verification pending/],
    ['signupConsentedAt', /signup permission pending/],
    ['relationshipConfirmedAt', /relationship confirmation pending/],
  ]) {
    const profile = { ...selfProfile, guardian: { ...verifiedGuardian, [field]: null } };
    const status = reviewModel.signupReviewStatus(profile);
    assert.equal(status.ready, false);
    assert.match(status.label, expected);
    assert.equal(reviewModel.registrationReadiness(manual, status).ready, false);
    assert.equal(reviewModel.signupReviewStatus({ ...profile, signupChecksRequired: false }).ready, true);
  }
  assert.equal(reviewModel.signupReviewStatus({ ...selfProfile, guardian: null }).ready, true);
  assert.equal(reviewModel.signupReviewStatus({ ...selfProfile, dateOfBirth: '2020-01-01', guardian: null }).ready, false);
  assert.equal(reviewModel.signupReviewStatus({ ...selfProfile, loginEmail: ' G@EXAMPLE.TEST ' }).ready, false);
  assert.equal(reviewModel.signupReviewStatus(selfProfile).ready, true);
});

test('unknown guardian status and minor face registration cannot be counted as ready', () => {
  const face = { attendanceMode: 'FACE', faceReviewState: 'PENDING' };
  assert.equal(reviewModel.registrationReadiness(face).ready, false);
  assert.equal(reviewModel.registrationReadiness(face, reviewModel.unavailableSignup).ready, false);
  const minor = reviewModel.signupReviewStatus({ ...selfProfile, dateOfBirth: '2020-01-01' });
  assert.equal(minor.ready, true);
  assert.equal(reviewModel.registrationReadiness(face, minor).ready, false);
  assert.equal(reviewModel.registrationReadiness({ attendanceMode: 'MANUAL' }, minor).ready, true);
  assert.equal(reviewModel.registrationReadiness({ ...face, faceReviewState: 'EXPIRED' },
    reviewModel.signupReviewStatus(selfProfile)).ready, false);
});

test('minor DOB immediately opens checked guardian fields and keeps existing guardian input', () => {
  const Fields = load('ProfileFields.tsx', { 'react/jsx-runtime': require('react/jsx-runtime') }).default;
  let value = adult;
  const props = () => ({ value, onChange: next => { value = next; } });
  let view = Fields(props());
  nodes(view).find(node => node.type === 'input' && node.props.type === 'date').props.onChange({ target: { value: '2020-01-01' } });
  view = Fields(props());
  const toggle = nodes(view).find(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(toggle.props.checked, true);
  assert.equal(toggle.props.disabled, true);
  assert.ok(nodes(view).some(node => node.type === 'legend' && node.props.children === 'Parent or guardian'));
  assert.equal(nodes(view).some(node => node.type === 'button'), false);
  assert.equal(value.guardian.email, '');
  value = { ...value, guardian: { ...verifiedGuardian } };
  view = Fields(props());
  nodes(view).find(node => node.type === 'input' && node.props.type === 'date').props.onChange({ target: { value: '2021-01-01' } });
  assert.equal(value.guardian.email, verifiedGuardian.email);
  // Loaded legacy minor drafts with no guardian also show the fields without a second button.
  view = Fields({ value: { ...adult, dateOfBirth: '2020-01-01' }, onChange() {} });
  assert.ok(nodes(view).some(node => node.type === 'legend' && node.props.children === 'Parent or guardian'));
});

test('approved students without a guardian see no verified-guardian change warning', () => {
  const Fields = load('ProfileFields.tsx', { 'react/jsx-runtime': require('react/jsx-runtime') }).default;
  const render = guardian => JSON.stringify(Fields({ value: { ...adult, guardian }, guardianLocked: true, onChange() {} }));
  assert.equal(render(null).includes('Contact the school to change verified guardian details.'), false);
  assert.equal(render(verifiedGuardian).includes('Contact the school to change verified guardian details.'), true);
});

test('review dialog shows guardian pending reason and disables approval before an attempted write', () => {
  const react = { ...require('react'), useState: initial => [initial, () => {}], useEffect() {} };
  const pending = reviewModel.signupReviewStatus({ ...selfProfile, guardian: { ...verifiedGuardian, relationshipConfirmedAt: null } });
  const Review = load('../../components/auth/RegistrationReview.tsx', {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../../features/student-signup': { useSignupReviews: () => ({ student: pending }),
      registrationReadiness: reviewModel.registrationReadiness, checkingSignup: reviewModel.checkingSignup },
    '../Modal': () => null,
    '../../lib/apiClient': { request() { throw Error('Unexpected API call'); }, apiMessage: String },
  }).default;
  const view = Review({ student: { id: 'student', fullName: 'Student', requestedClasses: [], attendanceMode: 'MANUAL' },
    busy: false, error: '', onClose() {}, onApprove() { throw Error('Unexpected approval'); } });
  assert.ok(JSON.stringify(view).includes('Guardian relationship confirmation pending'));
  assert.equal(nodes(view.props.footer).find(node => node.type === 'button' && node.props.children === 'Approve registration').props.disabled, true);
});

test('admin queue excludes guardian-pending rows from ready count and shows their reason', () => {
  const pending = [
    { id: 'pending', fullName: 'Pending', studentNumber: 'P1', universityEmail: 'p@example.test', requestedClasses: [], attendanceMode: 'MANUAL', createdAt: '' },
    { id: 'ready', fullName: 'Ready', studentNumber: 'R1', universityEmail: 'r@example.test', requestedClasses: [], attendanceMode: 'MANUAL', createdAt: '' },
  ];
  let stateIndex = 0;
  const react = { ...require('react'), useState(initial) {
    const index = stateIndex++;
    return [index === 1 ? pending : index === 3 ? false : typeof initial === 'function' ? initial() : initial, () => {}];
  }, useEffect() {}, useCallback: callback => callback, useMemo: compute => compute() };
  const statuses = {
    pending: reviewModel.signupReviewStatus({ ...selfProfile, guardian: { ...verifiedGuardian, relationshipConfirmedAt: null } }),
    ready: reviewModel.signupReviewStatus({ ...selfProfile, guardian: null }),
  };
  const mocks = { react, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../features/student-signup': { GuardianReview: 'GuardianReview', useSignupReviews: () => statuses,
      registrationReadiness: reviewModel.registrationReadiness, checkingSignup: reviewModel.checkingSignup },
    '../lib/apiClient': { apiMessage: String },
    '../lib/format': { avatarTone: () => '', formatDateTime: () => '', statusClass: () => '' },
    '../lib/studentApi': { listPendingStudents() {}, approveStudent() {}, rejectStudent() {} },
    '../lib/table': { sortRows: rows => rows, useSort: () => ({ sort: {}, toggle() {} }),
      usePagination: rows => ({ rows, pageCount: 1 }) },
    '../components/icons': { IconUserPlus: 'Icon' },
  };
  for (const name of ['Modal', 'Pager', 'PersonAvatar', 'SearchField', 'SelectMenu', 'SortableHeader', 'auth/RegistrationReview'])
    mocks['../components/' + name] = name;
  const Queue = load('../../pages/AdminRegistrations.tsx', mocks).default;
  const view = Queue();
  const ready = nodes(view).find(node => node.props?.className === 'registration-review-summary__ready');
  assert.equal(nodes(ready).find(node => node.type === 'strong').props.children, 1);
  const rows = nodes(view).filter(node => node.type === 'tr' && node.props.className);
  assert.equal(rows[0].props.className, 'registration-row');
  assert.ok(JSON.stringify(rows[0]).includes('Guardian relationship confirmation pending'));
  assert.equal(rows[1].props.className, 'registration-row registration-row--ready');
});

test('guardian status loading is bounded and stale results cannot restore old readiness', async () => {
  let snapshot; let effect; let cleanup; let previousKey;
  const requests = [];
  const react = { useState(initial) {
    snapshot ??= initial;
    return [snapshot, next => { snapshot = typeof next === 'function' ? next(snapshot) : next; }];
  }, useEffect(callback, [key]) {
    if (key !== previousKey) { previousKey = key; effect = callback; }
  } };
  const hook = load('useSignupReviews.ts', { react, './profileApi': {
    getSignupReview: id => new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
  } }).useSignupReviews;
  assert.equal(Object.keys(hook(['a', 'b', 'c', 'd', 'e'])).length, 0);
  cleanup = effect();
  assert.equal(requests.length, 4);
  requests[0].resolve(selfProfile);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 5);
  assert.equal(hook(['a', 'b', 'c', 'd', 'e']).a.ready, true);
  // An explicit refresh immediately drops the previously verified result.
  assert.equal(Object.keys(hook(['a'], 1)).length, 0);
  cleanup(); cleanup = effect();
  requests[1].resolve(selfProfile); // completion from the old queue must be ignored
  requests.at(-1).reject(Error('Unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  const current = hook(['a'], 1);
  assert.equal(current.a.ready, false);
  assert.match(current.a.label, /unavailable/);
  assert.equal(current.b, undefined);
  cleanup();
  requests.slice(2, 5).forEach(request => request.resolve(selfProfile));
});
