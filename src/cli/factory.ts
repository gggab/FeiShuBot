/**
 * 按配置创建 CliRunner（默认 claude）。
 * Create the configured CliRunner. 设计对齐 docs/handlers.md §6。
 */

import { config } from '../config';
import { CliRunner } from './runner';
import { ClaudeCliRunner } from './claude';
import { CodexCliRunner } from './codex';

export function getCliRunner(): CliRunner {
  switch (config.cli.provider) {
    case 'claude':
      return new ClaudeCliRunner();
    case 'codex':
      return new CodexCliRunner();
    default:
      throw new Error(`未知 CLI_PROVIDER: ${config.cli.provider}`);
  }
}
