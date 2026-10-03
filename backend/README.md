# Backend

API NestJS du Game Sales Tracker : ingestion, estimation, admin.

Le guide d’installation (Docker, dump, variables) est le `README.md` à la racine. L’estimation est décrite dans `ESTIMATION.md`, le schéma et les modules dans `ARCHITECTURE.md`.

## Lancer

```bash
cp .env.example .env
npm install
npm run start:dev
```

L’API écoute sur http://localhost:3001/api. Au boot, les migrations en attente sont appliquées sur `DATABASE_URL_DIRECT` (ou `DATABASE_URL`).

## Commandes

```bash
npm run start:dev
npm run build
npm run migration:show
npm run migration:run
npm run migration:generate -- src/db/migrations/<MeaningfulName>
```

Scripts métier (`package.json`) : `backfill:steam-metadata`, `rebuild:reference-profiles`, `validate:matcher-holdout`, `diagnose:grouping`, `import:leak-2018`. Les lancer depuis `backend/`.

Toute modification de `src/entities/` qui change le schéma passe par une migration enregistrée dans `src/db/migrations/index.ts`. Voir `.cursor/rules/typeorm-migrations.mdc`.

## Où lire le code

| Sujet | Chemin |
| ----- | ------ |
| Routes publiques | `src/games/games.controller.ts` |
| Ingestion | `src/ingestion/` |
| Estimation | `src/estimation/estimation.service.ts` |
| Matcher | `src/reference-profiles/` |
| Crons | `src/scheduler/cron.controller.ts` |
| Constantes du modèle | `src/games/sales-modeling.constants.ts` |
