import { reset, seed } from 'drizzle-seed'

import { db } from '../index';
import { users } from '../schema';

async function main() {
  console.log('Seeding started...');
  await reset(db, { users })
  await seed(db, { users })
  console.log('Seeding done...');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
