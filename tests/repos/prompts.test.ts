import { describe, it, expect } from 'vitest';
import { buildRoutingReadPrompt } from '../../src/repos/prompts';
import { buildBugfixPrompt } from '../../src/handlers/bugfix-naming';

describe('buildRoutingReadPrompt', () => {
  const prompt = buildRoutingReadPrompt('How is employee login implemented?');

  it('原样携带用户问题（保留原语言）', () => {
    expect(prompt).toContain('How is employee login implemented?');
  });

  it('包含双语的语言要求（全部输出跟随 Question 语言）', () => {
    expect(prompt).toContain('语言要求 / Language requirement');
    expect(prompt).toContain('MUST be written in the language of the Question below');
  });
});

describe('buildBugfixPrompt', () => {
  const prompt = buildBugfixPrompt('Login button crashes on click');

  it('原样携带问题描述（保留原语言）', () => {
    expect(prompt).toContain('Login button crashes on click');
  });

  it('包含双语的语言要求（全部输出跟随 Problem 语言）', () => {
    expect(prompt).toContain('语言要求 / Language requirement');
    expect(prompt).toContain('MUST be written in the language of the Problem below');
  });
});
