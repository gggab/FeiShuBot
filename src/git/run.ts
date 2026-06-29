/**
 * git 命令执行助手（参数数组传递，不拼 shell）。
 * Run a git command and return stdout; throws with stderr on non-zero exit.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const pexecFile = promisify(execFile);

export async function git(args: string[], cwd: string, timeoutMs = 120000): Promise<string> {
  try {
    const { stdout } = await pexecFile('git', args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || '').toString().trim().slice(0, 600);
    throw new Error(`git ${args.join(' ')} 失败: ${detail}`);
  }
}
