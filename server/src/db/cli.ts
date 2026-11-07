import { closeDb, initDb } from './index.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const cmd = process.argv[2];
const database = await initDb();
try {
  if (cmd === 'migrate') {
    const ran = await migrate(database);
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
  } else if (cmd === 'seed') {
    await migrate(database);
    await seed(database, { force: true });
  } else {
    console.error('Usage: tsx src/db/cli.ts <migrate|seed>');
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
