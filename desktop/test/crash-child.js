'use strict';
// Runs a Manager in its own process so the test can kill it mid-download.
const { Manager } = require('../src/engine/manager');
const [dataDir, dir, url] = process.argv.slice(2);
(async () => {
  const m = new Manager({ dataDir, settings: { downloadDir: dir, connections: 4 }, taskOpts: { minSegment: 64 * 1024 }, persistMs: 100, tickMs: 50 });
  await m.load();
  if (url) m.add({ url });
  m.on('completed', async () => { await m.shutdown(); process.send && process.send('done'); process.exit(0); });
  m.start();
})();
