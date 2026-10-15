# Rythme des rappels, heures calmes et textes de Peni

Statut : **décisions du fondateur du 15/10/2026 (15 h 44) appliquées** dans le code (commit 86c6626) : rythme conservé, heures calmes en option B, textes v3. Les textes et les poses restent **provisoires** jusqu'à leur vérification sur de vrais téléphones (test T17). Le service des rappels reste fermé et les rappels restent désactivés par défaut pour chaque personne.

## 1. Rythme (validé, inchangé)

Pour chaque tâche prévue un jour donné, à l'heure locale de la personne (Abidjan par défaut) :

| Rappel | Quand | Condition |
| --- | --- | --- |
| 1 | À l'heure de la tâche | Rappels activés par la personne, jour prévu au programme, projet actif, pas de pause, tâche pas encore cochée |
| 2 | +1 h | Mêmes conditions : **la tâche n'est toujours pas cochée** |
| 3 | +2 h | Idem ; c'est le dernier rappel de la journée pour cette tâche |

Au plus **3 notifications par tâche et par jour**. Dès que la tâche est cochée, les rappels suivants disparaissent :
- **côté serveur**, chaque rappel est revérifié juste avant l'envoi ;
- **sur le téléphone**, les rappels sont recalculés environ 2 secondes après la coche dans l'app. Si la coche est faite sur un autre appareil, la correction n'arrive qu'à la prochaine ouverture de l'app.

Réglages correspondants (administration) : `notifications.reminder_offsets_minutes` = `[0, 60, 120]`.

## 2. Heures calmes 22 h – 6 h : option B (validée et appliquée)

Règle : le rappel **à l'heure choisie par la personne** part même pendant les heures calmes ; les relances +1 h et +2 h qui tombent dans les heures calmes sont **supprimées**, jamais reportées au matin.

Calcul réel du code (fonction `dueReminders`, tests `reminders.spec.ts`), heures calmes 22:00 – 06:00 :

| Heure de la tâche | Rappels envoyés | Relances supprimées |
| --- | --- | --- |
| 15:00 | 15:00, 16:00, 17:00 | — |
| 20:30 | 20:30, 21:30 | 22:30 |
| 21:30 | 21:30 | 22:30, 23:30 |
| 22:00 | **22:00** | 23:00, 00:00 |
| 23:30 | **23:30** | 00:30, 01:30 |
| 05:30 | **05:30**, 06:30, 07:30 | — |
| 06:00 | 06:00, 07:00, 08:00 | — |
| 15:00, cochée avant 15:00 | aucun | — |

Avant l'option B, les tâches de 22:00, 23:30 et 05:30 n'avaient aucun rappel à l'heure choisie.

### Risques vérifiés

| Risque | Protection | Preuve |
| --- | --- | --- |
| Report incorrect (relance décalée au matin) | Une relance dans les heures calmes est supprimée, jamais reportée | `reminders.spec.ts` : rien n'apparaît à 06:00 pour une tâche de 23:30 |
| Doublons | Clé unique « projet, tâche, jour, tentative » ; découpage minute par minute d'une nuit entière sans doublon | `reminders.spec.ts` (nuit 18:00 → 09:00) ; e2e : relancer la même minute ne crée et n'envoie rien de plus |
| Relance hors période autorisée (serveur) | Revérification juste avant l'envoi : une relance planifiée avant 22 h mais envoyée après (nouvel essai, heures calmes changées entre-temps) est bloquée | e2e `reminders.e2e-spec.ts` (relance bloquée « quiet ») |
| Rappel à l'heure choisie bloqué à tort | Exempté de la revérification des heures calmes | e2e (rappel initial envoyé alors que les heures calmes ont commencé) |
| **Relance hors période (téléphone)** | **Non couvert** : voir ci-dessous | Mesure prévue (T6, T7) |

**Point à trancher : retard des notifications programmées sur le téléphone.** Les rappels du téléphone sont non exacts (décision du 15/10). D'après la documentation d'Android, une alarme non exacte est délivrée dans l'heure qui suit l'heure prévue sur Android 12 et plus (davantage en veille profonde ou avec l'économiseur), et beaucoup plus tard possible sur Android 11 et moins. Une relance prévue à 21:30 peut donc s'afficher après 22:00. Options, sans coût, **non appliquées** :

| Option | Effet | Inconvénient |
| --- | --- | --- |
| P1 (recommandée) | Sur le téléphone, ne pas programmer une relance prévue moins d'une heure avant le début des heures calmes | Une relance de 21:00 à 21:59 disparaît sur le téléphone |
| P2 | Garder tel quel et mesurer le retard réel (T6, T7) avant de décider | Risque d'une relance après 22 h en attendant |
| P3 | Alarme exacte sur Android 11 et moins | Contraire à la décision « pas d'alarme exacte » en v1 |

Sources : [Android — planifier des alarmes](https://developer.android.com/develop/background-work/services/alarms) ; [flutter_local_notifications, ticket 2814](https://github.com/MaikuB/flutter_local_notifications/issues/2814).

Autres points vérifiés :
- **Retard maximal (serveur) :** un rappel envoyé par le serveur avec plus de 30 minutes de retard (panne) n'est pas envoyé.
- **Jours de pause :** aucun rappel.
- **Rappels désactivés par la personne :** aucun rappel. C'est la valeur par défaut.

## 3. Textes de Peni — version v3 (provisoire)

Principe validé le 15/10 : encourageant, bienveillant, jamais culpabilisant ; la tâche **au début** du texte (Android n'affiche qu'environ 40 caractères d'une notification repliée) ; pose joyeuse au lieu de la pose triste.

Pour respecter « la tâche au début », deux textes proposés ont été légèrement réordonnés (même contenu) :

| Rappel | Texte v3 appliqué | Pose | Texte proposé à 15 h 18 |
| --- | --- | --- | --- |
| 1 — à l'heure | « {tâche} : c'est l'heure ! 💪 Tu vas tout déchirer. » | joyeuse | « C'est l'heure ! {tâche} 💪 … » |
| 2 — +1 h | « {tâche} t'attend encore. Un petit pas aujourd'hui, c'est déjà gagné 🙂 » | pensive | identique |
| 3 — +2 h | « {tâche} : encore un peu de temps ! Et sinon, demain est une nouvelle chance 💛 » | joyeuse | « Encore un peu de temps pour {tâche} ! … » |

Exemple : « Séance · Abdos : c'est l'heure ! 💪 Tu vas tout déchirer. »

Les textes sont produits par l'API (`reminders.ts`, version `v3`) ; le centre de notifications suit (modèles `v2`). Pour les vérifier sur de vrais téléphones, les versions de test ont un bouton **« Les 3 textes de Peni »** (Paramètres → Rappels → Tests sur téléphone) : trois notifications à une minute d'écart, avec les vrais textes et les vraies poses. Un test de l'API garantit que cette copie est identique aux textes du serveur. Validation définitive : après le test T17 (`docs/TESTS_TELEPHONES.md`).
