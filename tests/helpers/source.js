// Run the actual no-bundler modules/components with injected browser services.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as identity from '../../js/lib/source-identity.js';
import * as validation from '../../js/lib/source-validation.js';
import { mark } from '../../js/lib/perf-mark.js';
export const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
export function evaluate(body, scope, result) {
  scope.mark ??= mark;
  for (const [key, value] of Object.entries({ ...identity, ...validation })) if (!(key in scope)) scope[key] = value;
  return runInNewContext(body.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\n' + result, scope);
}
export function component(path, name) {
  const text = source(path);
  const start = text.indexOf('function ' + name + '(');
  return text.slice(start, text.indexOf('\n}', start) + 2);
}
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
