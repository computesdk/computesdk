import { db } from '../index';
import { usersTable } from '../schema';

const users = [
  { name: 'Alice Chen', age: 28, email: 'alice@example.com' },
  { name: 'Bob Martinez', age: 34, email: 'bob@example.com' },
  { name: 'Carol Johnson', age: 22, email: 'carol@example.com' },
  { name: 'David Kim', age: 41, email: 'david@example.com' },
  { name: 'Eva Patel', age: 30, email: 'eva@example.com' },
];

async function seed() {
  console.log('Seeding users...');
  await db.insert(usersTable).values(users).onConflictDoNothing();
  console.log(`Inserted ${users.length} users.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
