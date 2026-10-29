# ml/ — laboratoire pour améliorer l'estimation des ventes

Projet Python à côté du backend. Il sert à **comprendre, mesurer et
expérimenter** avant de toucher au code de prod. Il ne modifie jamais la
base : il en fait une copie locale en lecture seule, puis travaille dessus.

Références : [`ESTIMATION.md`](../ESTIMATION.md) (le modèle) et
[`DATA_DRIVEN_PROFILES.md`](../DATA_DRIVEN_PROFILES.md) (le matcher).

**Cible actuelle : le total seulement.** On n'évalue que les chiffres
« monde » (milestones `GLOBAL`, toutes plateformes) comparés au total affiché
(`estimatedToday` = PC + PS + Xbox). Une seule cible, une seule métrique :
c'est plus simple pour comparer des algorithmes. `backtest.py
--toutes-plateformes` réintègre les chiffres PC / PlayStation / Xbox.

## Démarrage

Depuis `ml/`, une seule fois :

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

Puis, dans l'ordre :

```bash
.venv/bin/python export_snapshot.py
```

```bash
.venv/bin/python count_milestones.py
```

```bash
.venv/bin/python check_parity.py
```

```bash
.venv/bin/python backtest.py
```

```bash
.venv/bin/python bench.py
```

Pour **voir et comprendre les résultats** (mini-UI dans le navigateur, chaque
chiffre y est expliqué) :

```bash
.venv/bin/streamlit run app.py
```

Pour expérimenter en Python :

```bash
.venv/bin/jupyter lab explorer.ipynb
```

| Fichier | Rôle |
| ------- | ---- |
| `db.py` | Connexion Postgres **lecture seule** (3 verrous). URL lue dans `backend/.env` ou `GST_DATABASE_URL`. |
| `export_snapshot.py` | Copie les tables utiles vers `data/<date>/*.parquet` (~13 Mo, ~10 s). `--followers-into data/<date>` ajoute seulement les followers Steam à un snapshot existant. |
| `snapshot.py` | Charge un snapshot ; définit les milestones « utilisables ». |
| `count_milestones.py` | Étape 0 : inventaire des étiquettes → `reports/step0_milestones.md`. |
| `baseline/` | Portage Python **fidèle** du modèle actuel : `constants`, `matcher`, `profile`, `estimator`. |
| `check_parity.py` | Vérifie que le portage redonne les chiffres de la prod → `reports/parity.md`. |
| `metrics.py` | Erreur en facteur ×, parts à ×1,5 / ×2, couverture, biais, intervalles de confiance. |
| `backtest.py` | Recalcule l'estimation à la date de chaque milestone → `reports/backtest.md` + `backtest_rows.parquet`. |
| `features.py` | Table d'apprentissage : une ligne par chiffre monde réel, features calculées à la date du chiffre ; définit le test final sous clé (hachage de l'id du jeu). |
| `bench.py` | Banc d'essai : validation croisée par jeu (réglages imbriqués), test dans le temps, ablation, modèles comparés à l'actuel → `reports/bench.md`. `--final` = test final, une seule fois. |
| `app.py` | Mini-UI Streamlit : « Commencer ici » (tout expliqué sur un exemple réel), vue d'ensemble, segments, estimé vs réel, un jeu décortiqué étape par étape avec les modèles appris (forêt, linéaire + interactions, boosting) sur la même frise, comparaison des modèles, qualité des données. |
| `learn_matcher.py` | Audit des 13 poids du matcher : les réapprend à partir des données (validation croisée par jeu + test dans le temps) et les compare aux poids actuels → `reports/matcher_weights.md`. |
| `labels.py` | Chiffres publiés suspects (incohérents dans le temps, partiels probables, écarts extrêmes) : écartés de l'ENTRAÎNEMENT des modèles seulement, la base n'est pas modifiée. |
| `playground.py` | Modèles appris prêts à jouer dans l'UI : 5 versions entraînées chacune sans un groupe de jeux (prédiction « honnête » d'un jeu jamais vu) + une version entraînée sur tous les jeux. |
| `explorer.ipynb` | Exploration guidée + un premier mini-modèle de ML appris sans tricher. |
| `frozen.py` | Relit les modèles figés depuis leurs fichiers JSON, sans scikit-learn (lecture de référence du backend). |
| `freeze.py` | Fige les deux finalistes dans `models/<snapshot>/` (à garder dans git, ne plus modifier) ; `--install` copie `ensemble.json` dans le backend. |
| `prospective_test.py` | Test neutre : juge les modèles figés sur les chiffres arrivés dans la base après le gel, à partir d'un snapshot rangé dans `data/neutral/<date>/`. |

`data/` et `reports/` sont ignorés par git : ils contiennent des données de prod.
`models/` est suivi par git : ce sont les modèles figés (aucune donnée de jeu
hors identifiants).

## Les principes de ML appliqués ici (version courte)

1. **Une baseline d'abord.** Avant d'améliorer un modèle, on mesure celui
   qui existe. C'est le chiffre à battre. Ici, la baseline est le modèle en
   prod, porté en Python.
2. **Vérifier qu'on mesure le bon modèle.** `check_parity.py` compare le
   portage à la prod méthode par méthode. Avec des entrées identiques, on
   obtient 99,3 à 100 % d'identité à l'unité près.
3. **Données figées et versionnées.** Toutes les expériences tournent sur
   un snapshot daté (`data/2026-10-27/`). Elles sont reproductibles et ne
   chargent pas la prod.
4. **Pas de fuite de données (*data leakage*).** Le modèle ne doit jamais
   voir la réponse :
   - **voyage dans le temps** : à la date d'un milestone, seuls les signaux
     capturés avant cette date sont visibles ;
   - **holdout** : l'ancre du jeu évalué est retirée du matcher. Sans ce
     retrait, l'erreur médiane passe de ×1,89 à ×1,74, une amélioration
     factice de 8 %.
5. **La bonne métrique.** Les ventes vont de 10 k à 100 M. On mesure donc
   l'erreur en **facteur** (×2 = deux fois trop, ou deux fois pas assez),
   pas en unités. Pour une fourchette, on mesure aussi la **couverture**
   (le réel tombe-t-il dedans ?).
6. **La bonne unité statistique.** Les milestones d'un même jeu ne sont pas
   indépendants : un jeu avec 60 chiffres pèserait 60 fois plus qu'un jeu
   avec un seul. On affiche donc aussi une version « chaque jeu pèse 1 », et
   les intervalles de confiance viennent d'un **bootstrap par jeu**.
7. **La qualité des étiquettes avant tout.** Labels à 0, doublons, chiffres
   estimés par un tiers (`isEstimate`) : on les mesure, on les isole et on
   les signale.
8. **L'analyse d'erreurs.** On découpe par segment et on lit les pires cas.
   C'est là qu'on trouve quoi corriger.
9. **Train / test.** Tout réglage appris sur des données doit être évalué
   sur d'autres données, ici d'autres **jeux**. Le notebook en donne un
   exemple complet (section 4).

## Résultats — snapshot du 2026-10-27

### Étape 0 : les étiquettes

4 885 milestones utilisables (non rejetés, hors engagement, datés) sur
1 030 jeux, dont 4 716 sur des jeux actifs et payants.

| Plateforme | Milestones | Jeux |
| ---------- | ---------: | ---: |
| GLOBAL | 3 398 | 761 |
| PC | 963 | 563 |
| PLAYSTATION | 370 | 146 |
| XBOX | 99 | 45 |
| SWITCH (non estimable) | 55 | 32 |

Par source : MEDIA 3 734 (dont 351 `isEstimate`), WIKIPEDIA 591,
STEAM_LEAK 350, OFFICIAL 186, PLAYSTATION_LEAK 20, ANNOUNCEMENT 4. Détail
complet par plateforme × source × isEstimate : `reports/step0_milestones.md`.

### Backtest — total seulement (la référence à battre)

Chiffres monde comparés au total affiché : 3 291 milestones `GLOBAL`
utilisables sur des jeux actifs et payants. On retire 2 chiffres à 0 et 764
doublons exacts, ce qui laisse 2 525 chiffres, dont **2 210 estimables** à
leur date (632 jeux).

| Périmètre | Facteur médian | ≤ ×1,5 | ≤ ×2 | Couverture [low, high] | Biais |
| --------- | -------------: | -----: | ---: | ---------------------: | ----: |
| Tous (par milestone) | **×1,84** (IC 90 % : 1,75–1,93) | **36 %** | **56 %** | **50 %** | ×0,79 (−21 %) |
| Réels seulement (`isEstimate = false`) | ×1,86 | 36 % | 55 % | 49 % | ×0,78 |
| Chaque jeu pèse 1 | ×1,98 | 32 % | 50 % | 43 % | ×0,67 |
| Sans holdout (fuite, pour comparaison) | ×1,73 | 38 % | 61 % | 50 % | ×0,74 |

Ce qui ressort de l'analyse d'erreurs :

- **Sous-estimation systématique.** Le vrai chiffre dépasse la fourchette
  dans 42 % des cas et tombe en dessous dans 8 %. L'écart se creuse pour les
  jeux de plus de 3 ans (biais ×0,67), les jeux à ≥ 10 M (×0,62) et les
  chiffres d'avant 2018 (×0,43).
- **Fourchettes trop étroites pour l'erreur réelle.** Elles ne contiennent
  le vrai chiffre qu'une fois sur deux.
- **La méthode « première semaine » aide beaucoup.** Avec reviews + pic de
  joueurs au lancement : ×1,76, couverture 57 %. Avec les reviews seules
  (jeux anciens, sans pic mesuré) : ×2,76, couverture 13 %, biais ×0,39.
- **Les notes console aident le total.** Quand elles existaient à la date,
  le biais disparaît (×0,97) et la couverture monte à 63 %. Sans elles (part
  console devinée depuis le PC) : biais ×0,74, couverture 45 %.
- **Données à nettoyer.** 764 doublons exacts parmi les chiffres monde (909
  toutes plateformes). Des chiffres rattachés au mauvais jeu ou à la
  mauvaise édition (GTA San Andreas, Horizon Zero Dawn Remastered crédité
  des 20 M de l'original). Des annonces du jour de sortie, alors que le PC
  n'a que quelques heures de reviews (Dead Rising 2, Skyrim).

### Ce que le backtest ne capture pas encore (fuites restantes)

Le holdout ne retire que l'ancre du jeu lui-même. D'autres informations
« du futur » restent visibles. Elles rendent le backtest un peu trop
optimiste :

- les ancres de `reference_profile` sont construites avec les données
  d'aujourd'hui, y compris des milestones d'autres jeux publiés après
  `reportedAt` ;
- `game_rank`, le temps de jeu médian, les tags Steam, le nombre de DLC et
  le track record du studio sont lus à leur valeur actuelle ;
- les poids du matcher ont été réglés à la main en regardant des données
  qui recoupent ce test (le leak Steam 2018) : le modèle n'arrive donc pas
  totalement « neuf » ;
- une autre édition du même jeu (remaster, GOTY) peut rester parmi les
  ancres.

## Banc d'essai : modèles appris

Lignes : 2 146 chiffres monde réels de 629 jeux. **133 jeux (461 chiffres)
sont sous clé** pour le test final, qui n'a pas encore été lancé. Le
développement porte sur les 496 autres jeux (1 685 chiffres).

Protocole :
- validation croisée par jeu en 5 groupes ;
- réglages des régressions choisis à l'intérieur des données d'entraînement ;
- arbres avec des réglages prudents fixés à l'avance, plus une version
  « réglée » qui choisit parmi 16 combinaisons, toujours à l'intérieur des
  données d'entraînement ;
- chaque jeu pèse autant ;
- fourchettes par prédiction conforme, visant 80 % de couverture.

`bench.py` enregistre ses résultats dans `reports/bench_result.pkl`, que
l'onglet « Comparer les modèles » relit. L'entraînement prend environ
10 minutes, dont l'essentiel pour le réglage du boosting.

| Modèle | Erreur typique (CV) | ≤ ×2 | Dans la fourchette | Test dans le temps (2025+, 175 jeux neufs) |
| ------ | ------------------: | ---: | -----------------: | -----------------------------------------: |
| Modèle actuel | ×1,90 | 54 % | 49 % | ×1,83 |
| Actuel recalibré (1 paramètre) | ×1,90 | 53 % | 80 % | ×2,01 |
| Linéaire (toutes les infos) | ×1,62 | 64 % | 81 % | ×1,68 |
| Linéaire (sans les voisins) | ×1,70 | 62 % | 81 % | ×1,68 |
| Linéaire + interactions | ×1,59 | 67 % | 80 % | ×1,60 |
| **Gradient boosting** | **×1,53** (IC 1,46–1,61) | **69 %** | 80 % | ×1,52 |
| Gradient boosting (réglé) | ×1,55 | 68 % | 79 % | ×1,51 |
| **Forêt aléatoire** | **×1,53** (IC 1,48–1,61) | **69 %** | 80 % | ×1,50 |
| Forêt aléatoire (réglée) | ×1,55 | 69 % | 81 % | ×1,47 |

**Verdict provisoire : gradient boosting, réglages par défaut.**

- Les modèles à arbres sont à égalité : en duel sur les mêmes chiffres, le
  boosting bat la forêt dans 56 % des tirages, et aucun ne bat les autres
  dans 9 tirages sur 10.
- Le réglage n'a rien apporté de mesurable (×1,53 → ×1,55 en validation
  croisée). Les réglages choisis changent d'un groupe à l'autre : beaucoup de
  combinaisons se valent, et nos valeurs par défaut étaient déjà bonnes.
- À précision égale, le boosting pèse 4 590 nœuds contre 84 238 pour la
  forêt : il est environ 18 fois plus simple à recopier dans le backend.

### Test final (lancé une fois, le 2026-10-28)

461 chiffres de 133 jeux jamais regardés. Le modèle a été choisi avant ce
test : gradient boosting (réglages par défaut).

| Modèle | Validation croisée | Dans le temps | **Test final** | Moyenne | Dans la fourchette (final) |
| ------ | -----------------: | ------------: | -------------: | ------: | -------------------------: |
| Modèle actuel | ×1,90 | ×1,83 | ×1,76 | ×1,83 | 48 % |
| Linéaire (toutes les infos) | ×1,62 | ×1,68 | ×1,59 | ×1,63 | 85 % |
| Linéaire + interactions | ×1,59 | ×1,60 | ×1,56 | ×1,58 | 86 % |
| Gradient boosting (choisi) | ×1,53 | ×1,52 | ×1,70 | ×1,58 | 81 % |
| Forêt aléatoire | ×1,53 | ×1,50 | ×1,60 | ×1,54 | 81 % |

Ce que le test final confirme :

- **Les fourchettes deviennent honnêtes.** Le vrai chiffre y tombe environ
  8 fois sur 10 avec un modèle appris, contre 5 fois sur 10 aujourd'hui.
- **La tendance à sous-estimer disparaît** : −24 % pour le modèle actuel,
  de −2 % à −9 % pour les modèles appris.

Ce qu'il ne confirme pas :

- **La supériorité du boosting.** Sur ces jeux, il ne bat l'actuel que dans
  65 % des tirages (×1,70 contre ×1,76).
- **Le classement entre modèles appris.** Le linéaire + interactions, que le
  boosting battait en validation croisée (90 % des tirages), le bat sur le
  test final (95 %). Avec ~500 jeux, les écarts entre modèles appris restent
  dans la marge de hasard. Le boosting est le plus variable d'un groupe de
  jeux à l'autre.

Le test final est maintenant « utilisé ». Pour départager à nouveau des
modèles sans tricher, il faudra un test neuf : les chiffres publiés après
ce snapshot.

Ce qu'on en retient :

- **Les arbres (gradient boosting, forêt aléatoire) sont les plus précis**,
  à égalité, en validation croisée comme dans le temps.
- **Leur gain vient surtout des vieux jeux.** Pour les jeux de plus de
  3 ans, l'erreur passe de ×2,05 (actuel) et ×1,83 (linéaire) à ×1,47
  (boosting). Le lien entre reviews et ventes y dépend de l'âge et de
  l'époque : une formule unique le rate, les arbres l'apprennent.
- **Le gain ne vient pas d'une fuite.** Sans les informations tirées des
  jeux voisins, le linéaire garde son résultat dans le temps (×1,68).
  Pour le boosting, retirer ces informations ne coûte que ×1,53 → ×1,57.
- **Recalibrer ne suffit pas**, et se dégrade sur 2025+ : c'est un
  changement de contexte entre l'entraînement et la réalité.
- **Ablation (boosting).** En retirant une famille d'informations,
  l'erreur passe de ×1,53 à :
  - ×2,06 sans les signaux (reviews, joueurs, notes) ;
  - ×1,61 sans le temps ;
  - ×1,57 sans les voisins ;
  - ×1,51 sans les infos du jeu, qui n'aident donc pas.

  Pour le linéaire, les tags Steam n'aident pas non plus.
- **Effets appris par le linéaire**, toutes choses égales par ailleurs :
  - deux fois plus de reviews → ×1,2 ;
  - épisode annuel → ×3,7 ;
  - chaque année de sortie plus récente → ×0,94.

## Banc d'essai v3 : nettoyage, nouvelles informations, modèles combinés (28/10)

Changements :
- **Test final rendu au développement.** Il a servi : les 629 jeux sont
  maintenant en validation croisée. Le prochain test neutre sera fait des
  chiffres publiés après le snapshot.
- **62 chiffres suspects (2,9 %) écartés de l'entraînement** (`labels.py`),
  sans toucher à la base. Les modèles sont jugés sur tous les chiffres et
  sur les chiffres nettoyés.
- **Nouvelles informations** : vitesse des reviews (à 30 et 90 jours, rythme
  des 90 derniers jours), followers Steam (43 % des chiffres, collectés
  depuis 2024), sortie PC différée (3 %).
- **Modèles combinés** : « Forêt + voisins » (correction par les erreurs sur
  les 15 jeux les plus similaires, force 0,5 fixée à l'avance) et
  « Moyenne forêt + linéaire ».
- Les versions « réglées » des arbres sont retirées (aucun gain, 10 min de
  calcul).

| Modèle | Tous les chiffres | Chiffres nettoyés | Dans le temps (2025+, 215 jeux neufs) |
| ------ | ----------------: | ----------------: | ------------------------------------: |
| Modèle actuel | ×1,86 | ×1,83 | ×1,75 |
| Linéaire + interactions | ×1,58 | ×1,56 | ×1,61 |
| Gradient boosting | ×1,56 | ×1,54 | ×1,52 |
| Forêt aléatoire | ×1,54 | ×1,53 | ×1,48 |
| Forêt + voisins | ×1,51 | ×1,49 | **×1,46** |
| **Moyenne forêt + linéaire** | **×1,49** | **×1,48** | ×1,51 |

Ce que chaque changement apporte, mesuré séparément sur les mêmes groupes :

| Changement | Effet sur l'erreur typique |
| ---------- | -------------------------- |
| Nettoyage des chiffres | quasi nul (de −0,01 à +0,01) : les modèles étaient déjà robustes à ces erreurs |
| Nouvelles informations | petit, seulement pour les modèles combinés (−0,01 à −0,02) ; rien pour la forêt et le linéaire seuls |
| Combinaison de modèles | le plus net : −0,03 à −0,04 par rapport à la forêt seule |

**Verdict actuel : « Moyenne forêt + linéaire ».**
- Elle bat la forêt (98 % des tirages), le boosting (99 %) et le
  linéaire (100 %).
- Elle est à égalité avec « Forêt + voisins » (71 %), qui fait un peu mieux
  dans le temps.
- À égalité, on retient la moyenne : elle ne s'appuie pas davantage sur la
  similarité du site, qu'il reste à challenger.

On atteint un plateau autour de ×1,5 : le gros saut venait du passage de la
formule aux modèles appris.

## Audit du matcher (similarité du site)

Le matcher est le maillon dont tout dépend (le site, et 3 informations des
modèles appris). On l'a remis en question.

- **Le principe marche.** Les 15 jeux les plus similaires donnent ×1,86,
  contre ×2,12 avec la moyenne de tous les jeux de référence et ×2,14 avec
  15 jeux au hasard. Il fait mieux dans 100 % des tirages.
- **Les jeux « similaires » se comportent vraiment pareil.** Leurs erreurs
  prédisent celles d'un modèle qui n'utilise pas le matcher : ×1,55, contre
  ×1,65 pour la moyenne et ×1,64 pour le hasard.
- **Les poids réappris ne font pas mieux que les poids actuels**
  (`learn_matcher.py`, 135 jeux de poids essayés) :
  - en validation croisée, ×1,878 contre ×1,860 ;
  - dans le temps, ×1,801 contre ×1,747 ;
  - les poids choisis changent d'un groupe de jeux à l'autre : avec
    ~630 jeux, les données ne savent pas désigner de meilleurs poids ;
  - retirer un critère change l'erreur de ±0,05 au plus, et des poids égaux
    font pire (×1,93).

  Les poids actuels sont donc sur un « plateau » raisonnable : on les garde.
- **Pas encore audité** : la qualité des jeux de référence
  (`reference_profile`) eux-mêmes.

## Gel des finalistes et test neutre (29/10)

`freeze.py` a figé « Moyenne forêt + linéaire » et « Forêt + voisins »,
entraînés sur les 2 084 chiffres propres de 621 jeux (snapshot du 27/10).
La relecture des fichiers redonne les prédictions de scikit-learn (écart
max 1e-7 en log). Le backend relit le même fichier en TypeScript : la parité
a été vérifiée sur 495 cas (features à 3e-8 près, forêt identique, linéaire
à 3e-10), et ses requêtes SQL relisent les mêmes signaux que Python (491/492,
le dernier écart venant d'un relevé ajouté après le snapshot).

Premier test neutre (snapshot du 29/10, 11 chiffres arrivés depuis le gel) :
×1,20 pour le modèle choisi contre ×2,04 pour le site. Trop peu de chiffres
pour conclure (le script le signale sous 30) : à relancer tous les mois avec

```bash
.venv/bin/python export_snapshot.py --out data/neutral/$(date +%F)
```

```bash
.venv/bin/python prospective_test.py
```

## Limite découverte : le modèle n'a jamais vu de petit jeu

Avant la mise en ligne, on a fait estimer les 6 360 jeux du catalogue
(snapshot du 29/10). Sur les jeux à peu de reviews, le modèle appris donne des
chiffres absurdes :

| Reviews Steam | Jeux | Modèle appris ÷ site (médiane) |
| ------------- | ---: | -----------------------------: |
| 1 – 100       |  170 | ×172 |
| 100 – 1 000   | 1 428 | ×39 |
| 1 000 – 10 000 | 2 910 | ×7,4 |
| 10 000 – 100 000 | 1 288 | ×2,5 |
| 100 000 et +  |  221 | ×1,5 |

Exemple : « Sorcery! Part 4 », 133 reviews, estimé à ~970 000 ventes.

**Pourquoi : biais de sélection.** Un jeu publie un chiffre de ventes quand
il se vend bien. Dans les données d'entraînement :
- 95 % des chiffres dépassent 300 000 ventes ;
- les 69 chiffres de jeux à moins de 1 000 reviews Steam sont des succès
  console (89 à 100 % sortis sur PlayStation), vendus ~1 million.

Le modèle a donc appris « peu de reviews Steam = gros succès console », ce qui
est faux pour un petit jeu PC. Les arbres ne savent pas descendre sous les
plus petites valeurs qu'ils ont vues.

Le banc d'essai et le test neutre ne pouvaient pas le voir : ils ne jugent que
des jeux qui publient leurs chiffres. Même en limitant le modèle aux jeux que
le site estime déjà à plus de 300 000 ventes, il pousse le chiffre ×2,1 en
médiane, contre ×1,3 sur les jeux testés : un écart qu'on ne peut pas vérifier.

### Décision : le modèle seulement là où il a été testé

Le site affiche le modèle appris seulement si les deux conditions sont
vraies : le site estime déjà le jeu à 300 000 ventes ou plus, et le jeu a au
moins 1 000 reviews Steam. Ailleurs, rien ne change. La seconde condition
écarte les jeux console sans page Steam, que le modèle mettait à 10 millions
et plus (il n'en a vu que 5).

- Catalogue du 29/10 : 2 017 jeux sur 6 360 passent au modèle appris, avec
  une hausse médiane de ×1,69 par rapport au site (×3,7 pour 1 jeu sur 10).
- Sur les chiffres connus (validation croisée), cette règle donne ×1,55,
  contre ×1,86 pour le site seul et ×1,50 pour le modèle partout.

Règle dans le backend : `mlEstimateApplies`
(`backend/src/estimation/ml/ml-estimate.service.ts`).

## Banc d'essai v2 : la courbe qui descend et le lancement (29/10)

`bench_v2.py`, snapshot du 29/10 (avec le nettoyage des chiffres), mêmes
2 146 chiffres pour tous les modèles → `reports/bench_v2.md`.

- **La courbe qui descend** venait surtout des informations « du moment »
  (joueurs connectés, reviews récentes, ancienneté du relevé, followers) :
  le modèle v1 baisse de plus de 5 % au moins une fois pour 36 % des jeux.
  - Sans ces informations (v2) : 10 % des jeux.
  - **« Jamais en baisse »** (à une date, le plus haut chiffre déjà donné par
    le modèle pour ce jeu) : 0 %, sans rien perdre en précision (×1,51,
    72 % à ×2, couverture 80 %, comme la v1).
- **Le lancement** : les nouvelles informations (rang dans les ventes
  Steam, followers le jour de la sortie, prix, reviews par jour) ne
  changent rien (×1,57 → ×1,58 sur les chiffres publiés 0 à 3 jours après
  la sortie). La plupart des chiffres « de lancement » très au-dessus des
  modèles sont des erreurs de données : chiffre daté du jour de sortie mais
  publié bien plus tard, chiffre de la série rattaché à une réédition, date
  de première sortie fausse, joueurs d'un free-to-play
  (`reports/launch_suspects.csv`).

Verdict : garder le modèle v1, ajouter « jamais en baisse », nettoyer les
chiffres de lancement suspects, puis réentraîner.

**En prod (29/10)** : « jamais en baisse dès J+3 ». Pas d'estimation ML
avant 3 jours après la sortie PC (le site garde son chiffre), puis le plus
haut chiffre déjà donné aux dates J+3, J+7, … où le jeu avait au moins
1 000 reviews Steam. Au banc : ×1,52 (contre ×1,51), l'écart venant des
chiffres publiés dans les 3 premiers jours, laissés au site. Référence
Python : `predict_never_down` dans `frozen.py` ; le backend donne le même
chiffre sur 264 cas (lecture seule).

## Prochaines étapes

1. **Des étiquettes pour les petits jeux.** Sans elles, aucun modèle appris
   ne peut être jugé sur l'ensemble du catalogue. La fuite Steam de 2018 en
   base ne couvre que 350 gros jeux (570 000 joueurs et plus), mais le
   fichier complet est dans le dépôt : `scripts/steam_players_2018.csv`,
   13 281 jeux, 4 161 joueurs en médiane. Ce sont des joueurs PC en
   juillet 2018, pas des ventes monde : à traiter comme une étiquette PC.
2. **Juger le catalogue entier, pas seulement les jeux qui publient** :
   ajouter au banc un contrôle « modèle ÷ site par taille de jeu », pour
   repérer ce biais avant toute mise en ligne.
3. **Relancer le test neutre** chaque mois sur les modèles figés.
