# Auction App

A multi-seller timed-auction web app (Turborepo: Next.js, NestJS, Prisma/Postgres, Redis, Typesense). The full agreed design is imported below. Read it before doing anything.

@docs/DESIGN.md

## Working rules
- Follow the slice order in the design (section 8). Don't start a slice before the previous one is done.
- Don't add features marked out of scope, and don't deviate from the design without asking the owner. Update `docs/DESIGN.md` when a decision from section 7 is made.
- Match the style and conventions of the surrounding code. Keep changes minimal.
- Run the relevant tests after changes and report failures honestly.
- Never commit, push, or delete files unless asked.
