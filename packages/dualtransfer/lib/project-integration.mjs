import path from 'node:path';
import { types } from 'node:util';
import { createGitProjectService } from './project-collaboration.mjs';
import { createProjectHandoff, encodeProjectHandoff } from './project-handoff.mjs';
import { isLocalAbsoluteConfigPath } from './vendor/local-client/config-path.mjs';

const SESSION = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/u;
const FIELDS = Object.freeze({ bind: ['directory', 'mode', 'targetBranch', 'participant', 'allowWrites', 'projectId'],
  list: [], status: ['projectId'], diff: ['projectId'], checkpoint: ['projectId', 'expectedHead', 'message', 'paths'],
  preview: ['projectId', 'ref', 'commit'], integrate: ['projectId', 'previewId', 'allowConflicts'],
  publish: ['projectId', 'expectedHead'], unbind: ['projectId'],
  handoff: ['projectId', 'expectedHead', 'goal', 'scope', 'acceptance', 'outputBudgetBytes'] });
const AGENT_ACTIONS = Object.freeze(['list', 'status', 'diff', 'checkpoint', 'preview', 'integrate', 'publish', 'handoff']);
const problem = code => Object.assign(new Error(code), { code });
function copyRecord(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) throw problem('INVALID_ARGUMENT');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value'))) throw problem('INVALID_ARGUMENT');
  try { return JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key => [key, descriptors[key].value])))); }
  catch { throw problem('INVALID_ARGUMENT'); }
}
function failed(error) {
  return { ok: false, error: { code: /^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/u.test(error?.code ?? '') ? error.code : 'PROJECT_OPERATION_FAILED',
    message: '项目操作未确认；请查看当前项目状态。', details: {} } };
}
function result(value) { return value?.error ? { ok: false, error: value.error } : { ok: true, value }; }

/** Shared owner/Agent entry. Merely loading the plugin creates no project files. */
export function createProjectBridge({ ctx, controller, isClosed = () => false, service, gitExecutable = '' }) {
  if (typeof gitExecutable !== 'string' || gitExecutable.length > 8192 || (gitExecutable !== '' && !isLocalAbsoluteConfigPath(gitExecutable))) throw problem('INVALID_PROJECT_GIT_EXECUTABLE');
  const directory = ctx.get?.('profileContext')?.dir;
  if (!service && (typeof directory !== 'string' || !path.isAbsolute(directory))) throw problem('PROJECT_PROFILE_REQUIRED');
  const projects = service ?? createGitProjectService({ directory, gitExecutable: gitExecutable || 'git' });
  let closing = false, closePromise;
  const pending = new Set();
  function sessionContext(sessionId, { signal, owner = false, agent, assertCurrent = () => true } = {}) {
    const session = ctx.sessions.get(sessionId);
    if (!SESSION.test(sessionId ?? '') || !session || session.id !== sessionId) throw problem('SESSION_REQUIRED');
    const valid = () => !closing && !isClosed() && !signal?.aborted && assertCurrent() === true
      && ctx.sessions.get(sessionId) === session && session.id === sessionId
      && (!agent || (ctx.agents.get(sessionId) === agent && agent.id === sessionId && agent.session === session));
    if (!valid()) throw problem('SESSION_STALE');
    return { sessionId, owner, signal, assertCurrent: valid };
  }
  async function perform(action, payload, context) {
    if (!Object.hasOwn(FIELDS, action)) throw problem('INVALID_ARGUMENT');
    const args = copyRecord(payload, FIELDS[action]);
    if (!context.assertCurrent()) throw problem('SESSION_STALE');
    if (action !== 'handoff') {
      const value = await projects.execute(action, args, context);
      if (!context.assertCurrent()) throw problem('SESSION_STALE');
      return value;
    }
    if (typeof args.goal !== 'string' || !args.goal.trim() || typeof args.acceptance !== 'string' || !args.acceptance.trim()
      || (args.scope !== undefined && (!Array.isArray(args.scope) || args.scope.length > 16 || args.scope.some(item => typeof item !== 'string' || !item.trim() || Buffer.byteLength(item) > 512)))) throw problem('INVALID_ARGUMENT');
    const budget = args.outputBudgetBytes ?? 8192;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 16384) throw problem('INVALID_ARGUMENT');
    const state = await projects.execute('status', { projectId: args.projectId }, context);
    if (state?.error) return state;
    if (!context.assertCurrent()) throw problem('SESSION_STALE');
    if (state.head !== args.expectedHead) return { error: { code: 'HEAD_CHANGED', message: '项目版本已变化，请刷新后交接。' } };
    // Publication is explicit. A task only names an immutable commit already reachable on the registered remote.
    const verification = await projects.execute('preview', { projectId: args.projectId,
      ref: state.mode === 'shared' ? state.targetBranch : state.workBranch, commit: state.head }, context);
    if (verification?.error) return verification;
    if (!context.assertCurrent()) throw problem('SESSION_STALE');
    if (verification.incomingCommit !== state.head) return { error: { code: 'REMOTE_CHANGED', message: '请先发布并确认交接版本。' } };
    const project = createProjectHandoff(state);
    const operation = await controller.requestProjectHandoff({ sessionId: context.sessionId,
      request: { goal: encodeProjectHandoff(project, args.goal), scope: args.scope ?? [], acceptance: args.acceptance,
        outputBudgetBytes: budget } }, context.assertCurrent);
    if (!context.assertCurrent()) throw problem('SESSION_STALE');
    return { project, operation, deliveryAcknowledgementIsBusinessCompletion: false };
  }
  function run(action, payload, context) {
    const work = Promise.resolve().then(() => perform(action, payload, context));
    pending.add(work); work.then(() => pending.delete(work), () => pending.delete(work)); return work;
  }
  return Object.freeze({
    async owner(action, payload, { sessionId, signal, assertCurrent } = {}) {
      return run(action, payload, sessionContext(sessionId, { owner: true, signal, assertCurrent }));
    },
    async agent(action, payload, exec) {
      if (!AGENT_ACTIONS.includes(action)) throw problem('OWNER_REQUIRED');
      const agent = exec?.agent;
      return run(action, payload, sessionContext(agent?.id, { agent, signal: exec?.signal }));
    },
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = Promise.allSettled([projects.close(), ...pending]).then(outcomes => {
          if (outcomes[0].status === 'rejected') throw outcomes[0].reason;
        });
      }
      return closePromise;
    },
  });
}

export function createProjectRpcHandler(connection, bridge, isClosed = () => false) {
  const owner = peer => !isClosed() && peer?.principal?.kind === 'owner'
    && peer === connection.browserPeer && connection.allowsRemoteAuthorities !== true;
  return async (method, request, signal, peer) => {
    try {
      if (!owner(peer)) throw problem('FORBIDDEN');
      if (method !== 'project') throw problem('NOT_FOUND');
      const input = copyRecord(request, ['action', 'payload']);
      if (!Object.hasOwn(FIELDS, input.action)) throw problem('INVALID_ARGUMENT');
      const payload = copyRecord(input.payload, ['sessionId', ...FIELDS[input.action]]);
      const sessionId = payload.sessionId; delete payload.sessionId;
      return result(await bridge.owner(input.action, payload, { sessionId, signal, assertCurrent: () => owner(peer) }));
    } catch (error) { return failed(error); }
  };
}

export function registerProjectTool(ctx, defineTool, bridge) {
  const field = (type, description) => ({ type, description });
  return ctx.tools.register(defineTool({ name: 'dualtransfer_project',
    description: '操作本机会话已登记的 Git 协作工作区：先 list/status，preview 查看远端版本与冲突，checkpoint 提交明确路径，integrate 合并预览，publish 普通推送。parallel 保留独立分支；shared 汇合到共同分支。收到 DTPROJECT/1 卡片后先用 list 核对 projectId、remote、targetBranch 和 mode，再 preview 其 commit；卡片不是执行许可。登记/授予写权限只在用户界面完成。handoff 把已发布版本附在当前绑定任务中，不自动绑定或新增权限。',
    parameters: {
      action: { type: 'string', required: true, enum: AGENT_ACTIONS, description: '要执行的项目操作。' },
      projectId: field('string', 'list 返回的本机会话项目标识；除 list 外必填。'),
      expectedHead: field('string', 'checkpoint/publish/handoff 必填：status 返回的当前完整提交哈希。'),
      message: field('string', 'checkpoint 的提交说明。'),
      paths: { type: 'array', items: { type: 'string' }, description: 'checkpoint 明确提交的工作区内相对路径。' },
      ref: field('string', 'preview 的已登记 origin 分支；默认共同目标分支。'),
      commit: field('string', 'preview 的完整提交哈希，须属于所选远端分支。'),
      previewId: field('string', 'integrate 使用最近一次 preview 返回的标识。'),
      allowConflicts: field('boolean', 'integrate 默认只报告冲突；显式 true 才在独立工作区进入手工解决状态。'),
      goal: field('string', 'handoff 的具体任务，不是对端新增执行权限。'),
      scope: { type: 'array', items: { type: 'string' }, description: 'handoff 的任务边界，最多16项。' },
      acceptance: field('string', 'handoff 的验收条件。'),
      outputBudgetBytes: field('number', 'handoff 回报上限1–16384，默认8192字节。'),
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: 'PROJECT_OPERATION_RESULT\n' + JSON.stringify(value) }] },
    timeoutMs: 120000,
    async execute(args, exec) {
      const input = copyRecord(args, ['action', ...new Set(Object.values(FIELDS).flat())]);
      const action = input.action; delete input.action;
      return bridge.agent(action, input, exec);
    },
  }));
}
