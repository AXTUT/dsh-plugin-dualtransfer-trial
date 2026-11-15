import { types } from 'node:util';

export const PROJECT_HANDOFF_PREFIX = 'DTPROJECT/1\n';
const FIELDS = ['protocol', 'projectId', 'mode', 'remote', 'targetBranch', 'workBranch', 'baseCommit', 'commit'];
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})(?![\s\S])/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}(?![\s\S])/u;
function invalid() { throw Object.assign(new Error('PROJECT_HANDOFF_INVALID'), { code: 'PROJECT_HANDOFF_INVALID' }); }
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== FIELDS.length || FIELDS.some(key => !Object.hasOwn(descriptors[key] ?? {}, 'value'))) invalid();
  return Object.fromEntries(FIELDS.map(key => [key, descriptors[key].value]));
}
function bounded(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/u.test(value); }
export function validateProjectHandoff(value) {
  const card = plain(value);
  if (card.protocol !== 'dualtransfer.project/1' || !ID.test(card.projectId ?? '') || !['parallel', 'shared'].includes(card.mode)
    || !bounded(card.remote, 1024) || !bounded(card.targetBranch, 255) || !bounded(card.workBranch, 255)
    || !COMMIT.test(card.baseCommit ?? '') || !COMMIT.test(card.commit ?? '')) invalid();
  // A shared project carries a repository identity, never credentials or a local path instruction.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^/@]*@/iu.test(card.remote)) invalid();
  return Object.freeze(card);
}
export function createProjectHandoff(status) {
  return validateProjectHandoff({ protocol: 'dualtransfer.project/1', projectId: status.projectId, mode: status.mode,
    remote: status.remote, targetBranch: status.targetBranch, workBranch: status.workBranch,
    baseCommit: status.baseCommit, commit: status.head });
}
export function encodeProjectHandoff(card, goal) {
  if (typeof goal !== 'string' || !goal.trim() || !goal.isWellFormed() || Buffer.byteLength(goal) > 8192) invalid();
  const value = PROJECT_HANDOFF_PREFIX + JSON.stringify(validateProjectHandoff(card)) + '\n\n' + goal;
  if (Buffer.byteLength(value) > 12 * 1024) invalid();
  return value;
}
export function decodeProjectHandoff(goal) {
  if (typeof goal !== 'string' || !goal.startsWith(PROJECT_HANDOFF_PREFIX) || Buffer.byteLength(goal) > 12 * 1024) return null;
  const end = goal.indexOf('\n\n', PROJECT_HANDOFF_PREFIX.length);
  if (end < 0) return null;
  try {
    const source = goal.slice(PROJECT_HANDOFF_PREFIX.length, end), card = validateProjectHandoff(JSON.parse(source));
    // Canonical encoding also rules out duplicate keys and ambiguous whitespace in the card.
    if (JSON.stringify(card) !== source) return null;
    const text = goal.slice(end + 2);
    if (!text.trim() || !text.isWellFormed()) return null;
    return Object.freeze({ project: card, goal: text });
  } catch { return null; }
}
