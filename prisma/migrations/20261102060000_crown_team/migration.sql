-- ver_140: Keeper of Words becomes one crown for the whole team. The Glossary is one list
-- for everyone, so it was handed out once in every umbrella at the same time.

-- 1. One team crown, taken from the oldest held umbrella copy (the next count settles it).
INSERT INTO "Crown" ("id", "groupId", "key", "label", "userId", "since", "counts", "updatedAt")
SELECT 'team_words', 'team', 'words', 'Keeper of Words', c."userId", c."since", c."counts", NOW()
FROM "Crown" c
WHERE c."key" = 'words' AND c."groupId" <> 'team' AND c."userId" IS NOT NULL
ORDER BY c."since" ASC
LIMIT 1
ON CONFLICT DO NOTHING;

-- 2. The team holder already knew they held it, so no new note for them.
UPDATE "User" u
SET "crownsSeen" = array_append(array_remove(u."crownsSeen", 'team_words'), 'team_words')
FROM "Crown" t
WHERE t."id" = 'team_words' AND t."userId" = u."id";

-- 3. Whoever wore an umbrella copy: the team holder now wears the team crown, anyone else
--    gets back the title they wore before.
UPDATE "User" u
SET "gameTitle" = 'crown|team|words|Keeper of Words|Whole team'
FROM "Crown" t
WHERE t."id" = 'team_words' AND t."userId" = u."id" AND u."gameTitle" LIKE 'crown|%|words|%';

UPDATE "User"
SET "gameTitle" = "gameTitleBefore", "gameTitleBefore" = NULL
WHERE "gameTitle" LIKE 'crown|%|words|%' AND "gameTitle" NOT LIKE 'crown|team|words|%';

-- 4. Drop the umbrella copies, and forget them in everyone's seen list.
UPDATE "User"
SET "crownsSeen" = ARRAY(
  SELECT s FROM unnest("crownsSeen") AS s
  WHERE s NOT IN (SELECT "id" FROM "Crown" WHERE "key" = 'words' AND "groupId" <> 'team')
)
WHERE "crownsSeen" && ARRAY(SELECT "id" FROM "Crown" WHERE "key" = 'words' AND "groupId" <> 'team');

DELETE FROM "Crown" WHERE "key" = 'words' AND "groupId" <> 'team';
