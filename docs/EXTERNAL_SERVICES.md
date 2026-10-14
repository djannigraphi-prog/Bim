# Services externes

Chaque service est appelé derrière une interface interne, pour pouvoir en changer sans toucher aux modules métier. Les tarifs sont des ordres de grandeur à confirmer par devis (détail : `docs/ANALYSE.md`, sections 6.2, 6.4 et 10).

| Besoin | Interface | Candidats | État |
| --- | --- | --- | --- |
| SMS (codes, alertes) | `DeliveryService` | Orange SMS API, agrégateur local, Twilio | **À choisir** (lot 2) ; console en développement |
| E-mails | `DeliveryService` | Amazon SES | À configurer (lot 2) |
| Notifications push | à créer | Firebase Cloud Messaging (+ APNs) | Lot 2 |
| Connexion Google / Apple / Facebook | à créer | SDK officiels + vérification serveur | Préparé, désactivé |
| Vérification d'identité et du visage | `KycProvider` (à créer) | Smile ID, Sumsub, Onfido | Lot 5 |
| Mobile Money (achats physiques, projets) | `PaymentProvider` (à créer) | CinetPay, Hub2, PayDunya, Wave Business | Lot 8 (après F1-F6) |
| Achats intégrés (pièces, abonnements) | à créer | Apple In-App Purchase, Google Play Billing | Lot 8 (après F6) |
| Lives et appels | `RealtimeMediaProvider` (à créer) | LiveKit, Agora, ZEGOCLOUD, Amazon IVS | Lots 10-11 |
| Vidéos courtes | à créer | MediaConvert + CloudFront, Mux, Cloudflare Stream | Lot 11 |
| Cartes et itinéraires | à créer | Google Maps Platform, Mapbox | Lot 7 |
| Peni (IA) | `LlmProvider` (à créer) | API d'un modèle de langage | Lot 3 |
| Suivi des erreurs | — | Sentry, CloudWatch | Lot 2 |

Comptes à ouvrir par le fondateur (au nom de l'entreprise) : AWS, Apple Developer (99 USD/an), Google Play Console, Firebase, agrégateur de paiement, prestataire de vérification d'identité, fournisseur SMS.
