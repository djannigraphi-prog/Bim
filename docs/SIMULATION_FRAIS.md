# Simulation des frais (décision F13) — à valider avant tout paiement réel

Script reproductible : `python3 scripts/simulation_frais.py` (hypothèses modifiables en tête du fichier).
Les taux sont des **hypothèses** tirées d'un comparatif publié en août 2026 et des règles Apple / Google ; ils doivent être remplacés par les devis des prestataires.

## Hypothèses (par mois)

- 70 % des pièces et des abonnements sont achetés **dans l'app** (achat intégré, obligatoire selon F6) ; 30 % sur le **site web** en Mobile Money (F7).
- Commission des magasins : 15 % (programmes petits développeurs) ou 30 %.
- 60 % des pièces achetées finissent **retirées** par des créateurs (F8 : seules les pièces reçues sont retirables).
- Frais Mobile Money à l'achat payés par l'acheteur (S2) et frais de retrait payés par le créateur (S3) : 0 pour BIM.
- Frais Mobile Money sur un abonnement payé sur le site : 2 %, absorbés par BIM.
- Publicité, hébergement, vérification d'identité et SMS **non comptés** (inconnus à ce stade).

## Résultats

Le point clé : un achat intégré ne rapporte à BIM que 85 % (ou 70 %) de son prix, alors qu'une pièce reçue reste retirable à 1 FCFA. Sans commission BIM, **cet écart est payé par BIM**, sur ses revenus d'abonnement.

| Scénario | Pièces achetées / mois | Abonnés Premium | Revenu Premium net | Coût des pièces pour BIM | Solde (commission 15 %) | Solde (commission 30 %) |
| --- | --- | --- | --- | --- | --- | --- |
| Lancement | 2 000 000 F | 300 | 533 400 F | 126 000 F | **+407 400 F** | +218 400 F |
| Croissance | 20 000 000 F | 3 000 | 5 334 000 F | 1 260 000 F | **+4 074 000 F** | +2 184 000 F |
| Grande échelle | 200 000 000 F | 30 000 | 53 340 000 F | 12 600 000 F | **+40 740 000 F** | +21 840 000 F |
| Beaucoup de pièces, peu d'abonnés | 50 000 000 F | 3 000 | 5 334 000 F | 3 150 000 F | **+2 184 000 F** | **−1 596 000 F** |

**Seuil** : le modèle reste positif tant que les pièces achetées ne dépassent pas environ **28 000 F par abonné Premium et par mois** (commission 15 %) ou **12 400 F** (commission 30 %).

Engagement à surveiller : les pièces achetées dans l'app et **pas encore retirées** restent dues aux créateurs. Au scénario « Croissance », la part non couverte de cet engagement atteint environ 840 000 F par mois (1 680 000 F à 30 %).

## Ce que cela implique (à décider par le fondateur, rien n'est programmé)

1. Le modèle « 0 % de commission » tient si les abonnements Premium restent importants par rapport au volume de pièces.
2. Le site web en Mobile Money (F7) réduit fortement le coût, car il évite la commission des magasins.
3. S1 (BIM absorbe certains frais) n'est soutenable qu'avec un tableau de bord du ratio « pièces / abonnés » et des alertes.
4. À vérifier : devise et paliers de prix des magasins en Côte d'Ivoire, éligibilité de BIM aux taux de 15 %, et traitement juridique des fonds détenus en attente de retrait (point C5 de `DECISIONS.md`).
