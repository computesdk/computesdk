import * as schema from "../schema";

import { reset, seed } from "drizzle-seed";

import { db } from "../index";

async function main() {
  console.log("Seeding started...");
  await reset(db, schema);
  await seed(db, { users: schema.users }).refine((f) => ({
    users: {
      columns: {
        age: f.number({ minValue: 0, maxValue: 100, precision: 1 }),
      },
    },
  }));
  console.log("Seeding done...");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
