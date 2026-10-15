# Lot 2 — Étude des rappels : notifications d'abord, coûts et décisions à valider

Rédigé le 15/10/2026, à la demande du fondateur : étudier d'abord une solution fiable par notifications, présenter contraintes et coûts **avant toute activation en production**. Rien de ce qui suit n'est développé ni activé. Statuts : **recommandé** (à valider) · **décidé** (validé par le fondateur).

## 1. Cadre décidé (15/10/2026)

- **Lancement en Côte d'Ivoire** (heure d'Abidjan, UTC+0, sans heure d'été), avec une architecture prête pour d'autres pays : au lot 2, chaque personne aura un fuseau horaire enregistré (par défaut `Africa/Abidjan`) et le calcul du « jour » sera fait par personne. Aujourd'hui, ce calcul est centralisé dans une seule fonction (`today()`), ce qui limite la modification.
- **Notifications d'abord** ; les alarmes exactes ne seront envisagées que si les mesures montrent que les notifications ne suffisent pas.

## 2. Solution recommandée : notification envoyée par le serveur

| Élément | Choix recommandé | Pourquoi |
| --- | --- | --- |
| Envoi | Firebase Cloud Messaging (Android, et iOS via APNs), message de type « notification », priorité haute | Affiché par le système même si l'app est fermée ; pas besoin que l'app tourne en arrière-plan. |
| Planification | Côté serveur, file de tâches dans PostgreSQL (pg-boss, déjà retenu dans l'analyse), recalculée depuis le journal des événements du projet (T-023) | Indépendant du téléphone (changement d'appareil, app désinstallée puis réinstallée) ; une tâche cochée entre-temps n'est pas rappelée (vérification au moment de l'envoi). |
| Rythme (E4) | À l'heure de la tâche, puis +1 h, puis +2 h tant qu'elle n'est pas cochée ; réglable dans l'administration | Correspond aux maquettes 27 et 28 (« rappel 15:00 · 16:00 · alarme 17:00 »), sans alarme exacte. |
| Secours hors connexion | Notification locale programmée par l'app en mode **non exact** (pas de permission spéciale), annulée si le rappel serveur est arrivé ou si la tâche est cochée | Couvre une coupure de données au moment du rappel ; le système peut la décaler de quelques minutes. |
| Texte | Modèles de messages dans la voix de Peni, produits à l'envoi (règle R1 de `DEPENDANCES_LOTS_2_3.md`) | Prêt pour la personnalisation par Peni au lot 3, sans dépendre de l'IA. |
| Mesure de fiabilité | Accusé d'ouverture dans l'app + taux de rappels envoyés / reçus par modèle de téléphone (sans contenu personnel) | Permet de décider sur des chiffres réels si une alarme exacte est nécessaire. |

## 3. Contraintes techniques (vérifiées)

- **Android 13 et plus** : la permission d'afficher des notifications est demandée à la personne. Si elle refuse, aucun rappel n'apparaît. L'app doit la demander au bon moment (après la création du premier projet) et l'indiquer clairement dans les réglages.
- **Alarmes exactes (Android 14)** : la permission `SCHEDULE_EXACT_ALARM` n'est plus accordée par défaut aux apps nouvellement installées ; la personne doit l'activer dans les réglages du téléphone. La permission automatique `USE_EXACT_ALARM` est réservée par Google Play aux applications de réveil ou d'agenda : BIM n'y est probablement pas éligible. Source : documentation Android (« Schedule exact alarms are denied by default »). D'où le choix « notifications d'abord ».
- **Économie d'énergie des fabricants** : les téléphones très répandus en Côte d'Ivoire (Tecno, Infinix, itel, et d'autres marques) limitent fortement les apps en arrière-plan. Les notifications FCM de type « notification » sont affichées par les services Google et résistent mieux que tout traitement en arrière-plan dans l'app ; c'est à vérifier sur de vrais téléphones (voir 6).
- **Téléphones sans services Google** (certains Huawei récents) : pas de FCM. Pour eux, seule la notification locale de secours fonctionne. Part de ces téléphones à mesurer avant de prévoir une autre voie.
- **iOS** : notifications via APNs (gratuit), compte Apple Developer nécessaire (déjà prévu pour publier l'app) ; pas de vraie alarme pour une app comme BIM sans API spécifique (à réévaluer si besoin).
- **Heures calmes** : pas de rappel la nuit (proposition : 22 h – 6 h, réglable par la personne).

## 4. Coûts estimés (à confirmer avant activation)

| Poste | Coût | Remarque |
| --- | --- | --- |
| Firebase Cloud Messaging | 0 | Produit gratuit dans les formules de Firebase (« No-cost »). Projet Firebase à créer au nom de l'entreprise. |
| APNs (iOS) | 0 | Compte Apple Developer : 99 USD/an, déjà nécessaire pour publier l'app. |
| File de tâches (pg-boss) | 0 en plus | Utilise la base PostgreSQL déjà prévue ; quelques Mo de données. |
| Processus « worker » — **option A** (recommandée au lancement) | 0 en plus | Le worker tourne dans le même service que l'API (tant que le volume reste faible). |
| Processus « worker » — **option B** | environ 7 à 10 USD/mois | Tâche séparée ECS Fargate 0,25 vCPU / 0,5 Go, 24 h/24. Tarif public us-east-1 : 7,2 USD/mois (ARM) à 9,0 USD/mois (x86) ; Paris (eu-west-3) un peu plus cher, à confirmer avec le calculateur AWS. |
| SMS pour les rappels | non prévu | Les SMS restent réservés aux codes de vérification (coût par message). |
| Journaux (CloudWatch) | quelques USD/mois | Selon le volume ; à inclure dans le budget d'hébergement global. |

Aucune dépense n'est engagée : création du projet Firebase, hébergement AWS et activation en production attendent ton accord explicite.

## 5. Décisions qui demandent ton accord avant le développement complet du lot 2

1. **Option du worker** : A (dans l'API, 0 en plus) au lancement, puis B si le volume l'exige — recommandé.
2. **Création du projet Firebase** au nom de l'entreprise (gratuit) — nécessaire pour tester sur de vrais téléphones.
3. **Rythme des rappels** : heure de la tâche, +1 h, +2 h (réglable) ; et **heures calmes** 22 h – 6 h.
4. **Moment de la demande d'autorisation des notifications** : après la création du premier projet, avec une explication de Peni.
5. **Pas d'alarme exacte en version 1** ; décision réexaminée après mesure de fiabilité sur de vrais téléphones.

## 6. Vérifications prévues avant activation

- Test sur 3 à 5 téléphones courants en Côte d'Ivoire (dont Tecno / Infinix / itel), app fermée, écran éteint, données coupées puis rétablies.
- Mesure du délai réel entre l'heure prévue et l'affichage.
- Tests automatiques : planification, annulation à la case cochée, pause, heures calmes, fuseau horaire.

Sources : [Android 14 — exact alarms denied by default](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) · [Firebase — tarifs (FCM « No-cost »)](https://firebase.google.com/pricing/?hl=fr) · [Tarifs Fargate (us-east-1)](https://www.vantage.sh/blog/fargate-pricing).
