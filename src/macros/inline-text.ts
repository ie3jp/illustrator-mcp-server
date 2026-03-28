import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function inlineText(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

export function inlineTemplateText(
  path: string,
  replacements: Record<string, string> = {},
): string {
  let source = inlineText(path);

  for (const [key, value] of Object.entries(replacements)) {
    source = source.replaceAll(key, value);
  }

  return source;
}
