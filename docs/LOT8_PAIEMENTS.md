# Lot 8 — Paiements en ligne (état au 17/10/2026)

Étude détaillée et sourcée : document « Étude paiements Mobile Money — Paystack et CinetPay ». Ce fichier résume ce que
le code fait réellement et ce qui reste à confirmer. **Aucun paiement réel n'est possible** : prestataire désactivé par
défaut (`PAYMENT_PROVIDER=none`), réglage `payments.online_enabled` = false, aucune clé de production acceptée.

## Ce qui est développé

| Élément | État |
| --- | --- |
| Interface commune des prestataires (`apps/api/src/modules/orders/online/provider.ts`) | Fait |
| Paystack (`paystack.provider.ts`) : initialisation (`/transaction/initialize`, XOF × 100, canal `mobile_money`, `subaccount` de la boutique, `bearer`), vérification (`/transaction/verify`), notifications signées (`x-paystack-signature`, HMAC SHA512), remboursements (`/refund`) | Fait, **testé contre un faux serveur seulement** |
| Simulateur (tests automatisés, interdit en production) | Fait |
| Ouverture : prestataire configuré + `payments.online_enabled` décidé + décision sur les frais (`payments.fee_bearer`) + compte actif de la boutique (F4) | Fait |
| Contrôles : signature, revérification serveur, montant, devise, compte bénéficiaire, anti-rejeu, expiration (`payments.intent_expiry_minutes`, 30 min, provisoire) | Fait |
| La confirmation du prestataire n'est jamais la décision de la boutique (commande « terminée » seulement après elle) | Fait |
| Remboursement par l'équipe BIM (permission `payments.refund`), motif, montant borné, suivi par notification signée ; jamais automatique (A8) | Fait |
| Administration « Paiements en ligne » : suivi journalisé, comptes des boutiques, remboursements | Fait |
| App : « Payer en ligne » (page du prestataire), « Vérifier mon paiement », opérateurs réellement pris en charge | Fait |

## Types de tests

| Type | État |
| --- | --- |
| Tests automatisés avec simulateur et faux serveur Paystack | Exécutés, réussis (CI) |
| Tests dans l'environnement de test de Paystack | **Non exécutés** : aucune clé de test (compte à ouvrir par le fondateur) ; le réseau de l'environnement de développement ne joint pas l'API Paystack |
| Paiements réellement effectués | **Aucun** |

## Opérateurs (Paystack)

| Opérateur | Pris en charge par Paystack | Disponible en CI | Accessible au compte envisagé | Testable | Paiement direct à la boutique |
| --- | --- | --- | --- | --- | --- |
| Orange Money | Oui (doc officielle) | À confirmer (bêta annoncée en 2023) | À confirmer (compte « Registered ») | Un numéro de test publié | À confirmer (sous-comptes) |
| MTN MoMo | Oui (doc officielle) | À confirmer | À confirmer | Aucun numéro de test publié | À confirmer |
| Wave | Oui (doc officielle) | À confirmer | À confirmer | Aucun numéro de test publié | À confirmer |
| Moov Money | **Non** | — | — | — | — |

L'app ne montre que les opérateurs annoncés par le prestataire, et seulement quand le paiement en ligne est ouvert.

## Frais (Paystack, Mobile Money)

Commission confirmée : **1,95 % HT**, sans frais fixe indiqué ([tarifs CI](https://support.paystack.com/en/articles/2130306)).
TVA : tarifs « hors TVA », taux **à confirmer** (18 % supposé ci-dessous). Frais d'ouverture, mensuels, de reversement,
délais de règlement et plafonds : **à confirmer auprès du prestataire**. Commission non rendue en cas de remboursement
(confirmé). Pas de conversion (XOF → XOF).

| Paiement | Commission HT | Avec TVA 18 % (à confirmer) |
| --- | --- | --- |
| 5 000 F | 97,5 F | 115 F |
| 10 000 F | 195 F | 230 F |
| 20 000 F | 390 F | 460 F |
| 50 000 F | 975 F | 1 151 F |

Qui paie (décision **L8-02**, définitive) : **la boutique** supporte les frais du prestataire (`bearer: subaccount`,
seule valeur acceptée). **BIM ne prélève aucune commission** (`transaction_charge: 0`, part du compte principal du
sous-compte `percentage_charge` = 0, contrôlée avant l'enregistrement du compte). **Le client paie le prix affiché.**

| Paiement | Le client paie | La boutique reçoit (HT, TVA à confirmer) | BIM reçoit |
| --- | --- | --- | --- |
| 5 000 F | 5 000 F | 4 902,5 F (4 885 F avec TVA 18 %) | 0 F |
| 10 000 F | 10 000 F | 9 805 F (9 770 F) | 0 F |
| 20 000 F | 20 000 F | 19 610 F (19 540 F) | 0 F |
| 50 000 F | 50 000 F | 49 025 F (48 849 F) | 0 F |

Ce que dit la documentation officielle (consultée le 17/10/2026) :
- `bearer` : « Who bears Paystack charges? `account` or `subaccount` (defaults to `account`) » — **confirmé** : avec
  `subaccount`, les frais sont retenus sur la part de la boutique.
- `percentage_charge` (sous-compte, obligatoire) : « The percentage the main account receives from each payment made to
  the subaccount » — BIM doit le fixer à **0** à la création de chaque sous-compte ; le code refuse sinon.
- `transaction_charge` : la référence de l'initialisation dit « the amount specified goes to the main account », une
  autre section dit « a flat fee to charge the subaccount » : **contradiction de la documentation** ; la valeur 0 envoyée
  par BIM ne fait aucun prélèvement dans les deux lectures, mais son acceptation est **à vérifier en environnement de test**.
- Arrondis et TVA réellement appliqués : **à vérifier en environnement de test**, puis à publier aux boutiques.

**Avant toute activation** : publier les frais aux boutiques (réglage `payments.shop_fee_terms`, texte affiché dans
l'espace boutique, « Paiement en ligne : frais et conditions ») ; sans lui, le paiement en ligne reste fermé.

## Blocages restants

1. **Paiement direct à la boutique (F4, obligatoire)** non confirmé en Côte d'Ivoire : l'API qui liste les banques
   (nécessaire aux sous-comptes) n'accepte que Ghana, Kenya, Nigeria et Afrique du Sud selon sa documentation ; **un
   sous-compte exige un compte bancaire** (`bank_code`, `account_number` obligatoires) : **chaque boutique aurait besoin
   d'un compte bancaire** (professionnel ou non : à confirmer par Paystack) ; aucun versement direct sur un compte Mobile
   Money n'est documenté. Le code n'envoie jamais un paiement sans sous-compte de la boutique ; aucun transit par BIM.
   Vérification : la sonde ci-dessous répond aux points techniques dès qu'une clé de test existe ; les points
   contractuels sont à demander à Paystack (question à poser ci-dessous).
2. **Frais publiés aux boutiques** (`payments.shop_fee_terms`) après vérification en environnement de test.

## Compte Paystack de test (procédure, sans dépense)

1. Inscription : <https://paystack.com/signup> (formulaire `dashboard.paystack.com/#/signup`) — nom de l'entreprise,
   nom complet, e-mail, **pays** (choisir Côte d'Ivoire), mot de passe, puis « Create my account ». Le compte est créé
   immédiatement **en mode test** ; aucun document n'est demandé pour le mode test (les documents — RCCM, numéro
   fiscal, pièces — ne sont demandés que pour passer en production, **non autorisé**).
2. Clés de test : Dashboard → **Settings → API Keys & Webhooks** → « API Configuration - Test Mode » → *Test Secret Key*
   (`sk_test_…`, révélée avec l'icône œil et le mot de passe). Ne jamais copier les clés du « Live Mode ».
3. Où la placer (jamais dans Git, jamais dans un message) : GitHub → dépôt → **Settings → Secrets and variables →
   Actions → New repository secret**, nom `PAYSTACK_TEST_SECRET_KEY`. Pour un poste de développement : fichier
   `apps/api/.env` (non versionné) sous `PAYSTACK_SECRET_KEY`. Staging/production : AWS Secrets Manager (non créé).
4. Lancer la sonde : GitHub → **Actions → « Sonde Paystack (test) » → Run workflow**. Elle refuse toute clé qui n'est pas
   `sk_test_…`, n'affiche jamais la clé, ne valide aucun paiement et rend un tableau : banques de Côte d'Ivoire (sous-
   comptes), opérateurs Mobile Money en XOF, accès à l'API des sous-comptes, transaction de test XOF initialisée et
   vérifiée.
5. Webhook (plus tard, environnement de staging seulement) : même page, champ « Test Webhook URL » →
   `https://<staging>/v1/payments/webhooks/paystack`.

Question à poser à Paystack (écrit, gratuit) : « En Côte d'Ivoire, peut-on créer des sous-comptes (split payments) pour
des marchands tiers, avec règlement direct sur leur compte (bancaire ou Mobile Money), `percentage_charge` = 0 et
`bearer = subaccount` ? Quelles pièces chaque marchand doit-il fournir ? Quels frais (TVA, reversement, délais) ? »
