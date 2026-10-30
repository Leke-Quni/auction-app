-- Replace "name" with firstName, lastName and a unique username, keeping existing rows.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT, ADD COLUMN "username" TEXT;

UPDATE "User" SET
  "firstName" = COALESCE(NULLIF(split_part("name", ' ', 1), ''), 'User'),
  "lastName" = COALESCE(NULLIF(btrim(substr("name", length(split_part("name", ' ', 1)) + 1)), ''), 'User'),
  "username" = lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9_]', '_', 'g')) || '_' || right("id", 4);

ALTER TABLE "User" ALTER COLUMN "firstName" SET NOT NULL, ALTER COLUMN "lastName" SET NOT NULL, ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "name";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
