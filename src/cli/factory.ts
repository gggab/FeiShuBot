/**
 * 按配置创建 CliRunner（默认 claude）。
 * Create the configured CliRunner. 设计对齐 docs/handlers.md §6。
 */

import { config } from '../config';
import { CliRunner } from './runner';
import { ClaudeCliRunner } from './claude';

export function getCliRunner(): CliRunner {
  switch (config.cli.provider) {
    case 'claude':
      return new ClaudeCliRunner();
    case 'codex':
      throw new Error('codex CLI 适配尚未实现（当前仅支持 claude）');
    default:
      throw new Error(`未知 CLI_PROVIDER: ${config.cli.provider}`);
  }
}
