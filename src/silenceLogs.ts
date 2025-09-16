// Side-effect module: silence console.* outputs when imported.
// This preserves direct writes to process.stdout (e.g. canonical fresh-mints stream)
// and prevents noisy console.log/console.error output across the project.
try{
  const noop = () => {};
  // Replace common console methods with no-ops
  console.log = noop as any;
  console.info = noop as any;
  console.warn = noop as any;
  console.error = noop as any;
}catch(e){}

export {};
