# Sauvegarde et restauration

## Production (RDS)

- Sauvegardes automatiques quotidiennes, conservées 14 jours, avec restauration à la minute près (PITR).
- Instantané manuel avant chaque migration risquée et avant chaque version majeure.
- Copie hebdomadaire chiffrée d'un instantané vers une seconde région.

Restauration (exemple) : créer une nouvelle instance depuis un point dans le temps, vérifier, puis basculer `DATABASE_URL` de l'API sur la nouvelle instance. **Ne jamais restaurer par-dessus la base en service.**

## Développement et staging

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > bim_$(date +%Y%m%d_%H%M).dump
createdb bim_restore && pg_restore --no-owner --dbname=postgres://bim:bim@localhost:5432/bim_restore bim_AAAAMMJJ_HHMM.dump
```

## Exercice de restauration

Une fois par mois : restaurer la sauvegarde de production dans un environnement isolé, appliquer les migrations, lancer `/health` et les tests de lecture, consigner la durée et le résultat dans `PROJECT_STATUS.md`. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

Les fichiers (S3, à partir du lot 4) : versionnage activé et réplication inter-région pour les fichiers privés (documents d'identité, photos avant/après).
