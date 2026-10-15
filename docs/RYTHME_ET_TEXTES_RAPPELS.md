# Rythme des rappels, heures calmes et textes de Peni — proposition à valider

Statut : **proposition**. Le fonctionnement n'est pas modifié ; les valeurs actuelles restent « en attente » dans l'administration et le service des rappels reste fermé.

## 1. Rythme proposé (celui que le code applique déjà)

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

## 2. Heures calmes 22 h – 6 h : comportement actuel, vérifié

Calcul réel du code actuel (fonction `dueReminders`, exécutée le 15/10/2026 sur ces cas), heures calmes 22:00 – 06:00 :

| Heure de la tâche | Rappels envoyés | Rappels supprimés par les heures calmes |
| --- | --- | --- |
| 15:00 | 15:00, 16:00, 17:00 | — |
| 20:30 | 20:30, 21:30 | 22:30 |
| 21:30 | 21:30 | 22:30, 23:30 |
| 22:00 | **aucun** | 22:00, 23:00, 00:00 |
| 23:30 | **aucun** | 23:30, 00:30, 01:30 |
| 05:30 | 06:30, 07:30 | 05:30 |
| 06:00 | 06:00, 07:00, 08:00 | — |
| 15:00, cochée avant 15:00 | aucun | — |

Un rappel tombé dans les heures calmes est **supprimé**, pas reporté au matin. La personne peut choisir ses propres heures calmes dans l'écran Rappels.

**Conséquence à trancher** : une tâche que la personne a elle-même placée pendant les heures calmes (par exemple des étirements à 22 h 30) **n'a aucun rappel**, même pas à l'heure choisie.

| Option | Comportement | Avantage | Inconvénient |
| --- | --- | --- | --- |
| A (actuelle) | Tout rappel pendant les heures calmes est supprimé | Aucune notification la nuit | Une tâche du soir tardif n'est jamais rappelée |
| **B (recommandée)** | Le rappel **à l'heure choisie par la personne** est envoyé même pendant les heures calmes ; les relances +1 h et +2 h (« non urgentes ») ne le sont pas | Respecte le choix de la personne, et la nuit reste calme pour les relances | Une notification possible la nuit, seulement si la personne a choisi cette heure |
| C | Reporter les rappels supprimés à 6 h | — | Rappel inutile le lendemain matin ; non recommandé |

L'option B demande une petite modification du calcul, avec ses tests. Elle ne sera faite qu'après ton choix.

Autres points vérifiés :
- **Retard maximal :** un rappel envoyé par le serveur avec plus de 30 minutes de retard (panne) n'est pas envoyé.
- **Téléphone :** les rappels sont non exacts, et Android peut les décaler de quelques minutes. Le retard réel sera mesuré sur téléphones (tests T3 à T7).
- **Jours de pause :** aucun rappel.
- **Rappels désactivés par la personne :** aucun rappel. C'est la valeur par défaut.

## 3. Textes de Peni — proposition définitive

Principes : encourageant, bienveillant, motivant, jamais culpabilisant ni insistant ; la tâche est nommée au début, car Android n'affiche que les 40 premiers caractères environ d'une notification repliée ; pas de donnée de santé.

| Rappel | Texte proposé | Pose de Peni | Texte actuel (v2) |
| --- | --- | --- | --- |
| 1 — à l'heure | « C'est l'heure ! {tâche} 💪 Tu vas tout déchirer. » | joyeuse | identique (repris de la maquette) |
| 2 — +1 h | « {tâche} t'attend encore. Un petit pas aujourd'hui, c'est déjà gagné 🙂 » | pensive | « Vas-y, ça ne prend qu'une minute… {tâche} t'attend 🥺 » (« une minute » peut être faux, « 🥺 » insiste) |
| 3 — +2 h | « Encore un peu de temps pour {tâche} ! Et sinon, demain est une nouvelle chance 💛 » | joyeuse | « {tâche} n'est pas encore cochée. Il est encore temps, je crois en toi ! » (pose triste) |

La pose « triste » de la maquette pour le dernier rappel est remplacée par la pose joyeuse, car un visage triste peut être perçu comme un reproche. Ce choix t'appartient.

Exemple réel avec une tâche de programme :
- « C'est l'heure ! Séance · Abdos 💪 Tu vas tout déchirer. »
- « Séance · Abdos t'attend encore. Un petit pas aujourd'hui, c'est déjà gagné 🙂 »
- « Encore un peu de temps pour Séance · Abdos ! Et sinon, demain est une nouvelle chance 💛 »

Une fois validés, ces textes deviendront la version v3 des modèles (`reminders.ts`), avec leurs tests ; le rappel d'essai et le centre de notifications suivront automatiquement.

## 4. Ce que je te demande de valider

1. Le rythme : à l'heure, puis +1 h, puis +2 h si la tâche n'est pas cochée.
2. Les heures calmes 22 h – 6 h, et l'option **A** ou **B** pour les tâches placées pendant les heures calmes.
3. Les trois textes et les poses de Peni (ou tes corrections).
