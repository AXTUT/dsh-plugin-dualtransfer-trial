import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitRunner, ProjectError, fail, errorValue } from './project-git.mjs';

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_FILES = 200;
const MAX_DIFF = 65_536;
const ACTIONS = new Set(['bind', 'list', 'status', 'diff', 'checkpoint', 'preview', 'integrate', 'publish', 'unbind']);

function text(value, name, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_ARGUMENT', `${name} must be a nonempty string (maximum ${max} characters).`);
  return value;
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function requireHead(value) {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) fail('INVALID_ARGUMENT', 'expectedHead must be a full Git commit object ID.');
  return value.toLowerCase();
}
function porcelain(raw) {
  const entries = raw.split('\0');
  const changes = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const item = { path: entry.slice(3), index: entry[0], worktree: entry[1] };
    if (/[RC]/.test(entry.slice(0, 2))) item.originalPath = entries[++i];
    changes.push(item);
  }
  return changes;
}
function nameStatus(raw) {
  const values = raw.split('\0');
  const changes = [];
  for (let i = 0; i < values.length && values[i]; i++) {
    const status = values[i];
    if (/^[RC]/.test(status)) changes.push({ status, originalPath: values[++i], path: values[++i] });
    else changes.push({ status, path: values[++i] });
  }
  return changes;
}

async function normalizeRemote(raw, root) {
  text(raw, 'origin', 4096);
  let remote = raw.trim();
  if (remote.startsWith('-') || remote.includes('::')) fail('INVALID_ARGUMENT', 'origin uses an unsupported Git transport.');
  const scp = !path.win32.isAbsolute(remote) && /^([^/@:]+@)?([^/:]+):(.+)$/.exec(remote);
  if (scp && !remote.includes('://')) remote = `ssh://${scp[1] || ''}${scp[2]}/${scp[3]}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    const absolute = await fs.realpath(path.resolve(root, remote));
    return pathToFileURL(absolute).href;
  }
  let url;
  try { url = new URL(remote); } catch { fail('INVALID_ARGUMENT', 'origin URL is malformed.'); }
  if (!['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(url.protocol)) fail('INVALID_ARGUMENT', 'origin transport is unsupported.');
  if (url.password || url.search || url.hash || (url.username && url.protocol !== 'ssh:')) fail('INVALID_ARGUMENT', 'origin URL must not contain a password, token, query, or fragment. Use the existing Git credential/SSH configuration.');
  if (url.protocol === 'file:') {
    if (url.username || (url.hostname && url.hostname !== 'localhost')) fail('INVALID_ARGUMENT', 'origin file URL must identify a local repository.');
    return pathToFileURL(await fs.realpath(fileURLToPath(url))).href;
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname === 'github.com' && !url.port && ['https:', 'ssh:'].includes(url.protocol)) {
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
    return `https://github.com${url.pathname.toLowerCase()}`;
  }
  return url.href;
}

/**
 * Local Git version collaboration, never a two-machine live filesystem.
 * directory is the plugin data root; no file is created until explicit bind.
 * Expected failures return { error: { code, message, details? } }, not exceptions.
 */
export function createGitProjectService({ directory, gitExecutable = 'git' } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('directory is required');
  const stateDirectory = path.resolve(directory, 'dualtransfer-projects-v1');
  const registryPath = path.join(stateDirectory, 'registry.json');
  const runner = createGitRunner({ gitExecutable });
  const previews = new Map();
  const operations = new Set();
  let registry;
  let closed = false;
  let tail = Promise.resolve();
  let closing;

  async function load() {
    if (registry) return;
    try {
      const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) fail('GIT_ERROR', 'Project registry has an unsupported format; it was left unchanged.');
      registry = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') registry = { version: 1, projects: [] };
      else throw error;
    }
  }
  function live(context) {
    if (closed) fail('CLOSED', 'Project service is closed.');
    if (context.signal?.aborted) fail('ABORTED', 'Project operation was aborted.');
  }
  async function current(context) {
    live(context);
    if (context.assertCurrent) {
      try {
        if (await context.assertCurrent() === false) fail('SESSION_STALE', 'The originating local session is no longer current.');
      } catch (error) {
        if (error instanceof ProjectError && error.code === 'SESSION_STALE') throw error;
        fail('SESSION_STALE', 'The originating local session is no longer current.');
      }
    }
    live(context);
  }
  async function writable(row, context) {
    if (row && !row.allowWrites) fail('WRITE_DISABLED', 'This local session has not been granted project write access.');
    await current(context);
  }
  async function save(context) {
    await current(context);
    const temporary = path.join(stateDirectory, `registry-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await current(context);
    await fs.rename(temporary, registryPath);
  }
  async function git(cwd, args, context, { codes = [0], maxOutputBytes, allowTruncated = false } = {}) {
    live(context);
    const result = await runner.run(cwd, args, { signal: context.signal, maxOutputBytes });
    if (!codes.includes(result.code)) fail('GIT_ERROR', result.stderr.trim() || result.stdout.trim() || 'Git command failed.', {
      command: args[0], exitCode: result.code, signal: result.signal, truncated: result.truncated,
    });
    if (result.truncated && !allowTruncated) fail('GIT_ERROR', 'Git metadata output exceeded the limit; no partial metadata was used.', { command: args[0], reason: 'output_limit' });
    return result;
  }
  async function writeGit(row, cwd, args, context, options) {
    await writable(row, context);
    return git(cwd, args, context, options);
  }
  function project(projectId, context, requireReady = true) {
    text(projectId, 'projectId', 128);
    const row = registry.projects.find((item) => item.sessionId === context.sessionId && item.projectId === projectId && item.active !== false);
    if (!row) fail('PROJECT_NOT_FOUND', 'Project is not bound to this local session.');
    if (requireReady && row.state !== 'ready') fail('GIT_ERROR', 'Project binding did not finish. Retained files were not recreated or removed.', { projectId, worktree: row.worktree, state: row.state, lastFailure: row.lastFailure });
    return row;
  }
  function descriptor(row) {
    return {
      projectId: row.projectId, mode: row.mode, remote: row.remote, root: row.root,
      targetBranch: row.targetBranch, participant: row.participant,
      workBranch: row.workBranch, worktree: row.worktree, head: row.head,
      baseCommit: row.baseCommit, allowWrites: row.allowWrites, createdAt: row.createdAt,
    };
  }
  async function checkOrigin(row, context) {
    const fetch = (await git(row.root, ['remote', 'get-url', '--all', 'origin'], context)).stdout.trim();
    const push = (await git(row.root, ['remote', 'get-url', '--push', '--all', 'origin'], context)).stdout.trim();
    if (await normalizeRemote(fetch, row.root) !== row.remote || await normalizeRemote(push, row.root) !== row.remote) fail('REMOTE_CHANGED', 'Registered origin changed. Bind a new local project mapping before using this remote.');
  }
  async function snapshot(row, context) {
    await checkOrigin(row, context);
    const root = (await git(row.worktree, ['rev-parse', '--show-toplevel'], context)).stdout.trim();
    if (await fs.realpath(root) !== await fs.realpath(row.worktree)) fail('GIT_ERROR', 'The registered collaboration worktree no longer matches its path.');
    const branch = await git(row.worktree, ['symbolic-ref', '--quiet', 'HEAD'], context, { codes: [0, 1] });
    if (branch.stdout.trim() !== `refs/heads/${row.workBranch}`) fail('GIT_ERROR', 'The collaboration worktree branch changed; its files were left unchanged.');
    const head = (await git(row.worktree, ['rev-parse', '--verify', 'HEAD^{commit}'], context)).stdout.trim();
    const raw = (await git(row.worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], context)).stdout;
    const allChanges = porcelain(raw);
    const mergeHead = await git(row.worktree, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], context, { codes: [0, 1] });
    const conflicts = allChanges.filter((item) => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(item.index + item.worktree)).map((item) => item.path);
    return {
      ...descriptor(row), head, changes: allChanges.slice(0, MAX_FILES), dirty: allChanges.length > 0,
      truncated: allChanges.length > MAX_FILES,
      merge: { inProgress: mergeHead.code === 0, conflicts: conflicts.slice(0, MAX_FILES) },
    };
  }
  async function validateBranch(root, branch, context) {
    text(branch, 'branch', 200);
    if (branch.startsWith('refs/') || branch.startsWith('-') || branch === 'HEAD') fail('INVALID_ARGUMENT', 'Use a short branch name, not a revision expression.');
    const result = await git(root, ['check-ref-format', '--branch', branch], context, { codes: [0, 128, 129, 1] });
    if (result.code !== 0 || result.stdout.trim() !== branch) fail('INVALID_ARGUMENT', 'Branch name is not valid.');
    return branch;
  }
  async function fetched(row, ref, context) {
    const short = ref?.startsWith('refs/heads/') ? ref.slice(11) : (ref || row.targetBranch);
    await validateBranch(row.root, short, context);
    const destination = `refs/dualtransfer/${row.bindingId}/fetch-${randomUUID()}`;
    await writeGit(row, row.root, ['fetch', '--no-tags', 'origin', `refs/heads/${short}:${destination}`], context);
    const commit = (await git(row.root, ['rev-parse', '--verify', `${destination}^{commit}`], context)).stdout.trim();
    return { ref: `refs/heads/${short}`, commit };
  }
  async function bind(payload, context) {
    if (context.owner !== true) fail('OWNER_REQUIRED', 'Only the local owner browser can bind a project.');
    await current(context);
    text(payload.directory, 'directory', 4096);
    if (!['parallel', 'shared'].includes(payload.mode)) fail('INVALID_ARGUMENT', 'mode must be parallel or shared.');
    if (typeof payload.allowWrites !== 'boolean') fail('INVALID_ARGUMENT', 'allowWrites must be an explicit boolean.');
    const participant = text(payload.participant, 'participant', 80);
    const selected = await fs.realpath(path.resolve(payload.directory));
    const bare = (await git(selected, ['rev-parse', '--is-bare-repository'], context)).stdout.trim();
    if (bare !== 'false') fail('INVALID_ARGUMENT', 'Select an existing non-bare Git working repository.');
    const root = await fs.realpath((await git(selected, ['rev-parse', '--show-toplevel'], context)).stdout.trim());
    await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], context);
    const targetBranch = await validateBranch(root, payload.targetBranch, context);
    const origin = (await git(root, ['remote', 'get-url', '--all', 'origin'], context)).stdout.trim();
    const remote = await normalizeRemote(origin, root);
    const pushOrigin = (await git(root, ['remote', 'get-url', '--push', '--all', 'origin'], context)).stdout.trim();
    if (await normalizeRemote(pushOrigin, root) !== remote) fail('REMOTE_CHANGED', 'origin fetch and push targets differ.');
    const projectId = payload.projectId === undefined ? createHash('sha256').update(`${remote}\n${targetBranch}`).digest('hex').slice(0, 24) : text(payload.projectId, 'projectId', 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(projectId)) fail('INVALID_ARGUMENT', 'projectId must contain only letters, digits, dot, underscore, and hyphen.');
    const duplicate = registry.projects.find((item) => item.sessionId === context.sessionId && item.projectId === projectId && item.active !== false);
    if (duplicate) fail('ALREADY_BOUND', 'This project is already bound to the local session; its worktree was retained.', { projectId, worktree: duplicate.worktree });
    const bindingId = randomUUID();
    const slug = participant.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'participant';
    const workBranch = `dualtransfer/${slug}/${bindingId}`;
    const worktree = path.join(stateDirectory, 'worktrees', bindingId);
    // bind is owner-authorized even when subsequent Agent write access is disabled.
    const provisional = { bindingId, root, remote, targetBranch, allowWrites: true };
    const incoming = await fetched(provisional, targetBranch, context);
    const row = {
      ...provisional, sessionId: context.sessionId, projectId, mode: payload.mode, participant,
      workBranch, worktree, baseCommit: incoming.commit, head: incoming.commit,
      allowWrites: payload.allowWrites, createdAt: new Date().toISOString(), state: 'creating', active: true,
    };
    await current(context);
    await fs.mkdir(path.join(stateDirectory, 'worktrees'), { recursive: true, mode: 0o700 });
    registry.projects.push(row);
    await save(context);
    try {
      await writeGit(null, root, ['worktree', 'add', '-b', workBranch, worktree, incoming.commit], context);
      row.state = 'ready';
      await save(context);
      return await snapshot(row, context);
    } catch (error) {
      row.lastFailure = errorValue(error).error;
      // The creating record remains durable if cancellation prevents saving again.
      try { await save(context); } catch { /* Return the original failure, not a cleanup failure. */ }
      throw new ProjectError(error.code || 'GIT_ERROR', error.message, { ...(error.details || {}), projectId, worktree, retained: true });
    }
  }
  async function validatePaths(row, paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES) fail('INVALID_ARGUMENT', `paths must contain 1-${MAX_FILES} explicit relative file paths.`);
    const result = [];
    const root = await fs.realpath(row.worktree);
    for (const item of paths) {
      text(item, 'path', 4096);
      const segments = item.split('/');
      if (path.isAbsolute(item) || path.win32.isAbsolute(item) || item.includes('\\') || segments.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) fail('INVALID_ARGUMENT', 'Every checkpoint path must be an explicit relative file within the collaboration worktree.', { path: item });
      const absolute = path.resolve(root, item);
      if (!inside(root, absolute)) fail('INVALID_ARGUMENT', 'Checkpoint path leaves the collaboration worktree.', { path: item });
      let stat;
      try { stat = await fs.lstat(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat?.isDirectory()) fail('INVALID_ARGUMENT', 'Checkpoint paths must identify files, not directories.', { path: item });
      // A final symlink is a Git file; a symlink in its parents must stay in-tree.
      let parent = path.dirname(absolute);
      while (true) {
        try {
          if (!inside(root, await fs.realpath(parent))) fail('INVALID_ARGUMENT', 'Checkpoint path traverses an out-of-tree directory.', { path: item });
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          parent = path.dirname(parent);
        }
      }
      if (!result.includes(item)) result.push(item);
    }
    return result;
  }
  async function checkpoint(row, payload, context) {
    await writable(row, context);
    const expected = requireHead(payload.expectedHead);
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 4096 || payload.message.includes('\0')) fail('INVALID_ARGUMENT', 'message must be a nonempty commit message of at most 4096 characters.');
    const paths = await validatePaths(row, payload.paths);
    const before = await snapshot(row, context);
    if (before.head !== expected) fail('HEAD_CHANGED', 'HEAD changed; refresh status before checkpoint.', { head: before.head });
    if (before.merge.inProgress) {
      const staged = (await git(row.worktree, ['diff', '--cached', '--name-only', '-z'], context)).stdout.split('\0').filter(Boolean);
      const missing = [...new Set(staged.filter((file) => !paths.includes(file)))];
      if (missing.length) fail('INVALID_ARGUMENT', 'A merge commit includes all staged changes. Explicitly select every staged merge path before checkpoint; index and HEAD were left unchanged.', { reason: 'merge_paths_missing', paths: missing });
    }
    await writeGit(row, row.worktree, ['--literal-pathspecs', 'add', '--', ...paths], context);
    const head = (await git(row.worktree, ['rev-parse', 'HEAD'], context)).stdout.trim();
    if (head !== expected) fail('HEAD_CHANGED', 'HEAD changed after staging; staged files were retained.', { head });
    const args = before.merge.inProgress ? ['commit', '-m', payload.message] : ['--literal-pathspecs', 'commit', '--only', '-m', payload.message, '--', ...paths];
    await writeGit(row, row.worktree, args, context);
    const result = await snapshot(row, context);
    row.head = result.head;
    previews.delete(row.bindingId);
    await save(context);
    return { ...result, committed: true };
  }
  async function diff(row, context) {
    const state = await snapshot(row, context);
    const result = await git(row.worktree, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'], context, { maxOutputBytes: MAX_DIFF, allowTruncated: true });
    return { projectId: row.projectId, head: state.head, changes: state.changes, diff: result.stdout, truncated: state.truncated || result.truncated, merge: state.merge };
  }
  async function preview(row, payload, context) {
    await writable(row, context);
    if (payload.ref !== undefined) {
      text(payload.ref, 'ref', 211);
      if (payload.ref.startsWith('origin/')) fail('INVALID_ARGUMENT', 'Use a short remote branch or refs/heads/*, not an origin/* tracking alias.');
    }
    if (payload.commit !== undefined && (typeof payload.commit !== 'string' || !OBJECT_ID.test(payload.commit))) fail('INVALID_ARGUMENT', 'commit must be a full Git commit object ID.');
    const state = await snapshot(row, context);
    const remote = await fetched(row, payload.ref, context);
    const incomingCommit = payload.commit?.toLowerCase() || remote.commit;
    if (payload.commit) {
      const belongs = await git(row.worktree, ['merge-base', '--is-ancestor', incomingCommit, remote.commit], context, { codes: [0, 1, 128] });
      if (belongs.code !== 0) fail('INVALID_ARGUMENT', 'The requested commit is not reachable from the fetched origin ref.', { reason: 'commit_not_in_ref', ref: remote.ref });
    }
    const files = await git(row.worktree, ['diff', '--name-status', '-z', state.head, incomingCommit, '--'], context);
    const changes = nameStatus(files.stdout);
    const difference = await git(row.worktree, ['diff', '--no-ext-diff', '--no-textconv', '--binary', state.head, incomingCommit, '--'], context, { maxOutputBytes: MAX_DIFF, allowTruncated: true });
    await writable(row, context);
    const merge = await git(row.worktree, ['merge-tree', '--write-tree', '--name-only', '-z', state.head, incomingCommit], context, { codes: [0, 1, 128, 129] });
    if ([128, 129].includes(merge.code)) {
      if (/unknown option|unrecognized option|usage:/i.test(merge.stderr)) fail('GIT_UNSUPPORTED', 'Project preview requires Git 2.38 or newer with merge-tree --write-tree.');
      fail('GIT_ERROR', merge.stderr.trim() || 'Git merge preview failed.');
    }
    const fields = merge.stdout.split('\0');
    const conflicts = [];
    if (merge.code === 1) {
      for (let i = 1; i < fields.length && fields[i]; i++) conflicts.push(fields[i]);
    }
    const dirty = state.dirty || state.merge.inProgress;
    const previewId = dirty ? null : randomUUID();
    const result = {
      projectId: row.projectId, previewId, head: state.head, incomingCommit, ref: remote.ref,
      changes: changes.slice(0, MAX_FILES), diff: difference.stdout, conflicts: conflicts.slice(0, MAX_FILES), dirty,
      truncated: difference.truncated || changes.length > MAX_FILES || conflicts.length > MAX_FILES,
    };
    previews.delete(row.bindingId);
    if (previewId) previews.set(row.bindingId, { ...result, fetchedCommit: remote.commit });
    return result;
  }
  async function integrate(row, payload, context) {
    await writable(row, context);
    const previous = previews.get(row.bindingId);
    if (!previous || previous.previewId !== payload.previewId) fail('PREVIEW_STALE', 'Preview is missing or expired; preview this project again.');
    if (payload.allowConflicts !== undefined && typeof payload.allowConflicts !== 'boolean') fail('INVALID_ARGUMENT', 'allowConflicts must be a boolean.');
    const before = await snapshot(row, context);
    if (before.head !== previous.head) fail('PREVIEW_STALE', 'Local HEAD changed since preview; preview again.', { head: before.head });
    if (before.dirty || before.merge.inProgress) fail('WORKTREE_DIRTY', 'Collaboration worktree changed since preview; checkpoint or resolve it first.');
    if (previous.conflicts.length && payload.allowConflicts !== true) fail('CONFLICTS', 'Preview found conflicts; the worktree was left unchanged.', { previewId: previous.previewId, conflicts: previous.conflicts });
    const args = ['merge', '--no-edit', '--no-autostash'];
    if (previous.conflicts.length) args.push('--no-commit');
    args.push(previous.incomingCommit);
    const merged = await writeGit(row, row.worktree, args, context, { codes: [0, 1] });
    const result = await snapshot(row, context);
    if (merged.code !== 0 && !result.merge.inProgress) fail('GIT_ERROR', merged.stderr.trim() || merged.stdout.trim() || 'Git merge failed; worktree and index were retained.');
    previews.delete(row.bindingId);
    row.head = result.head;
    await save(context);
    return { ...result, integrated: merged.code === 0 && !result.merge.inProgress };
  }
  async function publish(row, payload, context) {
    await writable(row, context);
    const expected = requireHead(payload.expectedHead);
    const state = await snapshot(row, context);
    if (state.head !== expected) fail('HEAD_CHANGED', 'HEAD changed; refresh status before publishing.', { head: state.head });
    if (state.merge.inProgress) fail('WORKTREE_DIRTY', 'Complete the in-progress merge before publishing.');
    const branch = row.mode === 'shared' ? row.targetBranch : row.workBranch;
    const pushed = await writeGit(row, row.root, ['push', '--porcelain', '--no-follow-tags', '--no-mirror', 'origin', `${expected}:refs/heads/${branch}`], context, { codes: [0, 1, 128] });
    if (pushed.code !== 0) {
      if (/non-fast-forward|fetch first|stale info|failed to update ref|cannot lock ref|\[rejected\]/i.test(pushed.stdout + pushed.stderr)) fail('REMOTE_CHANGED', 'The remote branch advanced; fetch/preview and integrate again before publishing.', { retry: 'preview', branch });
      fail('GIT_ERROR', pushed.stderr.trim() || pushed.stdout.trim() || 'Git push failed.');
    }
    return { projectId: row.projectId, head: expected, remote: row.remote, branch, published: true };
  }
  async function dispatch(action, payload, context) {
    live(context);
    if (!ACTIONS.has(action)) fail('INVALID_ARGUMENT', 'Unknown project action.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('INVALID_ARGUMENT', 'payload must be an object.');
    if (typeof context.sessionId !== 'string' || !context.sessionId || context.sessionId.length > 256) fail('SESSION_REQUIRED', 'A local sessionId is required.');
    if (action === 'unbind' && context.owner !== true) fail('OWNER_REQUIRED', 'Only the local owner browser can unbind a project.');
    await load();
    if (action === 'bind') return bind(payload, context);
    if (action === 'list') {
      const results = [];
      for (const row of registry.projects.filter((item) => item.sessionId === context.sessionId && item.active !== false)) {
        try {
          if (row.state !== 'ready') fail('GIT_ERROR', 'Binding was interrupted; retained files were not recreated or removed.', { state: row.state, lastFailure: row.lastFailure });
          results.push(await snapshot(row, context));
        } catch (error) {
          if (['CLOSED', 'ABORTED'].includes(error.code)) throw error;
          results.push({ ...descriptor(row), ...errorValue(error) });
        }
      }
      return results;
    }
    const row = project(payload.projectId, context, action !== 'unbind');
    if (action === 'status') return snapshot(row, context);
    if (action === 'diff') return diff(row, context);
    if (action === 'checkpoint') return checkpoint(row, payload, context);
    if (action === 'preview') return preview(row, payload, context);
    if (action === 'integrate') return integrate(row, payload, context);
    if (action === 'publish') return publish(row, payload, context);
    if (context.owner !== true) fail('OWNER_REQUIRED', 'Only the local owner browser can unbind a project.');
    await current(context);
    row.active = false;
    try { await save(context); } catch (error) { row.active = true; throw error; }
    previews.delete(row.bindingId);
    return { projectId: row.projectId, unbound: true, retained: true, worktree: row.worktree };
  }
  function execute(action, payload = {}, context = {}) {
    if (closed) return Promise.resolve(errorValue(new ProjectError('CLOSED', 'Project service is closed.')));
    const operation = tail.then(() => dispatch(action, payload, context)).catch(errorValue);
    operations.add(operation);
    tail = operation;
    void operation.finally(() => operations.delete(operation));
    return operation;
  }
  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      await runner.close();
      await Promise.allSettled([...operations]);
      previews.clear();
    })();
    return closing;
  }
  return { execute, close };
}
