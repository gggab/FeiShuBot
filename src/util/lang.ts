/**
 * 用户消息语言判定与固定文案选择。
 * 面向用户的固定文案（状态/错误/提示，非 LLM 输出）按用户消息语言取中/英版本。
 * 粗粒度规则：含 CJK 统一表意文字 → 中文，否则英文；无需精确识别所有语言。
 */

export type Lang = 'zh' | 'en';

/** 判定用户消息的界面语言：含汉字（一-鿿）→ zh，否则 en。 */
export function detectLang(text: string): Lang {
  return /[一-鿿]/.test(text) ? 'zh' : 'en';
}

/** 按语言选择固定文案。 */
export function pick(lang: Lang, zh: string, en: string): string {
  return lang === 'zh' ? zh : en;
}
