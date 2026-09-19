import { connectDB } from "./db/mongo";

async function main() {
  const db = await connectDB();

  console.log("✅ Database:", db.databaseName);
}

main().catch((error) => {
  console.error("❌ Error:", error);
});