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
