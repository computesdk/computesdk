import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
config({ path: '.env.local' });


const db = drizzle(process.env.DATABASE_URL!);

export { db }