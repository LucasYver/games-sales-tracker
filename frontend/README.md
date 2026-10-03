# Frontend

UI Next.js 16 (App Router) du Game Sales Tracker. L’installation est dans le `README.md` à la racine.

```bash
npm install
npm run dev
```

http://localhost:3000. Sans `.env`, l’API appelée est `http://localhost:3001/api`. Surcharge : `NEXT_PUBLIC_API_URL`. URL publique du site : `NEXT_PUBLIC_SITE_URL`.

## Routes

| Route | Rôle |
| ----- | ---- |
| `/[locale]` | Catalogue (`fr`, `en`, `next-intl`) |
| `/[locale]/ranking` | Classement |
| `/[locale]/game/[slug]` | Fiche : estimation, historiques, prix |
| `/admin` | Back-office, hors i18n, cookie `ADMIN_TOKEN` |

Les textes visibles passent par `messages/`. Ne pas écrire de français en dur dans les composants.

Next.js 16 de ce dépôt ne correspond pas forcément à la doc générale du framework. Lire `AGENTS.md` avant de changer une API Next.
