// Test-only resolver: maps relative "./x.js" imports (required by NodeNext in
// api/**) to the sibling "./x.ts" so strip-types unit tests can import them.
export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && specifier.endsWith('.js')) {
    try {
      return await nextResolve(specifier.slice(0, -3) + '.ts', context)
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context)
}
