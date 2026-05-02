import * as schema from "../schema";

import { reset, seed } from "drizzle-seed";

import { db } from "../index";

async function main() {
  console.log("Seeding started...");
  await reset(db, schema);
  await seed(db, { user: schema.user, account: schema.account });
  console.log("Seeding done...");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
