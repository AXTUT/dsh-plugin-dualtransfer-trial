import { spawn } from 'node:child_process';
import path from 'node:path';

export class ProjectError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message, details) {
  throw new ProjectError(code, message, details);
}

export function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@');
}

export function errorValue(error) {
  const value = {
    code: error instanceof ProjectError ? error.code : 'GIT_ERROR',
    message: redact(error?.message || String(error)).slice(0, 4096),
  };
  if (error instanceof ProjectError && error.details !== undefined) {
    value.details = JSON.parse(redact(JSON.stringify(error.details)));
  }
  return { error: value };
}

/** Bounded argv-only Git. Completion means child close AND both pipe EOFs. */
export function createGitRunner({ gitExecutable = 'git', timeoutMs = 30_000 } = {}) {
  let closed = false;
  const active = new Set();
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C' };
  // Drop repository/command overrides, but keep explicit system/global config-file selectors.
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|CONFIG.*)$/.test(key)
      && !/^GIT_CONFIG_(NOSYSTEM|GLOBAL|SYSTEM)$/.test(key)) delete env[key];
  }

  function run(cwd, args, { signal, maxOutputBytes = 262_144 } = {}) {
    if (closed) return Promise.reject(new ProjectError('CLOSED', 'Project service is closed.'));
    if (signal?.aborted) return Promise.reject(new ProjectError('ABORTED', 'Git operation was aborted.'));
    let finish;
    const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    const record = { done, stop: null };
    active.add(record);
    let child;
    let timer;
    let escalation;
    let reason;
    let spawnError;
    let childClosed = false;
    let stdoutEOF = false;
    let stderrEOF = false;
    let exitCode = null;
    let exitSignal = null;
    let windowsKillStarted = false;
    let bytes = 0;
    let truncated = false;
    const stdout = [];
    const stderr = [];
    const killers = [];

    function collect(target, chunk) {
      const room = Math.max(0, maxOutputBytes - bytes);
      if (chunk.length > room) truncated = true;
      if (room) target.push(chunk.subarray(0, room));
      bytes += Math.min(room, chunk.length);
    }
    function kill(force) {
      if (!child?.pid || childClosed) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else if (!windowsKillStarted) {
          // Kill the tree while its root still exists; killing only Git first can orphan ssh/hooks.
          windowsKillStarted = true;
          const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
          killers.push(new Promise((resolve) => {
            const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { child.kill('SIGKILL'); });
            killer.once('close', (code) => { if (code !== 0) child.kill('SIGKILL'); resolve(); });
          }));
        } else if (force) child.kill('SIGKILL');
      } catch { /* An already exited process is still joined below. */ }
    }
    function stop(code, message) {
      if (reason) return;
      reason = new ProjectError(code, message);
      kill(false);
      escalation = setTimeout(() => kill(true), 500);
    }
    record.stop = stop;
    const abort = () => stop('ABORTED', 'Git operation was aborted.');
    async function complete() {
      if (!childClosed || !stdoutEOF || !stderrEOF) return;
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      await Promise.all(killers);
      active.delete(record);
      if (reason) finish.reject(reason);
      else if (spawnError) finish.reject(new ProjectError('GIT_ERROR', `Git executable failed: ${spawnError.message}`, { reason: 'spawn', executable: gitExecutable }));
      else finish.resolve({ code: exitCode, signal: exitSignal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), truncated });
    }
    try {
      child = spawn(gitExecutable, ['--no-optional-locks', '-c', 'color.ui=false', '-c', 'core.quotepath=false', ...args], {
        cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => collect(stdout, chunk));
      child.stderr.on('data', (chunk) => collect(stderr, chunk));
      child.stdout.once('end', () => { stdoutEOF = true; void complete(); });
      child.stderr.once('end', () => { stderrEOF = true; void complete(); });
      child.stdout.once('error', (error) => { spawnError ||= error; });
      child.stderr.once('error', (error) => { spawnError ||= error; });
      child.once('error', (error) => { spawnError = error; });
      child.once('close', (code, signalName) => {
        childClosed = true;
        exitCode = code;
        exitSignal = signalName;
        void complete();
      });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop('GIT_ERROR', `Git command exceeded ${timeoutMs}ms; worktree and index were retained.`), timeoutMs);
      if (signal?.aborted) abort();
    } catch (error) {
      active.delete(record);
      finish.reject(new ProjectError('GIT_ERROR', `Git spawn failed: ${error.message}`));
    }
    return done;
  }

  async function close() {
    closed = true;
    const pending = [...active];
    for (const record of pending) record.stop('CLOSED', 'Project service closed during a Git operation.');
    await Promise.allSettled(pending.map((record) => record.done));
  }
  return { run, close };
}
