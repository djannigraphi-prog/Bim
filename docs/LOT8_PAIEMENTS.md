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

Qui paie : la **boutique** si `payments.fee_bearer` = « shop » (`bearer: subaccount`), **BIM** si « bim ». **Le client ne
paie rien de plus** : le prix n'est jamais modifié. Décision non prise : paiement en ligne fermé d'ici là.

## Blocages (décisions du fondateur)

1. **F4 avec Paystack en Côte d'Ivoire non confirmé** : l'API qui liste les banques (nécessaire aux sous-comptes) n'accepte
   que Ghana, Kenya, Nigeria et Afrique du Sud ; un sous-compte se règle sur un compte bancaire. Le code n'envoie jamais
   un paiement sans sous-compte de la boutique.
2. **Répartition des frais** (`payments.fee_bearer`).
3. **Ouverture d'un compte Paystack de test** (identifiants à créer par le fondateur) et autorisation de dépense.
