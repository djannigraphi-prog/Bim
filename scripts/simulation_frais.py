#!/usr/bin/env python3
"""
Simulation simple des frais supportés par BIM (décision F13), par mois.

Toutes les hypothèses sont des paramètres ci-dessous, à remplacer par les devis réels des prestataires.
Rappel des règles : BIM ne prélève aucune commission sur les pièces reçues (règle essentielle) ;
pièces achetées non retirables (F8) ; frais d'opérateur affichés à part à l'achat Mobile Money (S2)
et au retrait (S3) ; pas de prix différent selon le canal (S5 écarté).
Usage : python3 scripts/simulation_frais.py
"""

HYPOTHESES = {
    "part_achats_pieces_dans_app": 0.70,   # part des pièces achetées dans l'app (achat intégré Apple / Google)
    "commission_magasin": 0.15,            # 15 % (programmes petits développeurs) ; 0.30 au-delà des seuils
    "part_pieces_retirees": 0.60,          # part des pièces achetées qui finissent retirées par des créateurs
    "frais_mobile_money_achat": 0.02,      # payés par l'acheteur sur le site web (S2) -> 0 pour BIM
    "frais_retrait": 0.01,                 # payés par le créateur (S3) -> 0 pour BIM
    "prix_premium_utilisateur": 2000,
    "part_premium_dans_app": 0.70,
    "frais_mobile_money_abonnement": 0.02, # abonnement payé sur le site web : supposé absorbé par BIM
}

SCENARIOS = [
    # (nom, pièces achetées par mois en FCFA, abonnés Utilisateur Premium)
    ("Lancement", 2_000_000, 300),
    ("Croissance", 20_000_000, 3_000),
    ("Grande échelle", 200_000_000, 30_000),
    ("Déséquilibre : beaucoup de pièces, peu d'abonnés", 50_000_000, 3_000),
]


def simulate(volume_pieces: float, abonnes: int, h: dict) -> dict:
    achats_app = volume_pieces * h["part_achats_pieces_dans_app"]
    # BIM ne reçoit que (1 - commission) sur un achat intégré, mais une pièce reçue reste retirable à 1 FCFA.
    perte_commission_pieces = achats_app * h["commission_magasin"] * h["part_pieces_retirees"]
    # Le reste des pièces achetées dans l'app reste dû aux utilisateurs (solde) : engagement non couvert à 100 %.
    engagement_non_couvert = achats_app * h["commission_magasin"] * (1 - h["part_pieces_retirees"])
    brut_premium = abonnes * h["prix_premium_utilisateur"]
    net_premium = brut_premium * (
        h["part_premium_dans_app"] * (1 - h["commission_magasin"])
        + (1 - h["part_premium_dans_app"]) * (1 - h["frais_mobile_money_abonnement"])
    )
    return {
        "perte_pieces": perte_commission_pieces,
        "engagement_non_couvert": engagement_non_couvert,
        "net_premium": net_premium,
        "solde": net_premium - perte_commission_pieces,
    }


def seuil_pieces_par_abonne(h: dict) -> float:
    """Volume de pièces achetées par abonné et par mois au-delà duquel les commissions dépassent le revenu Premium."""
    net_par_abonne = simulate(0, 1, h)["net_premium"]
    cout_par_fcfa = h["part_achats_pieces_dans_app"] * h["commission_magasin"] * h["part_pieces_retirees"]
    return net_par_abonne / cout_par_fcfa


if __name__ == "__main__":
    for commission in (0.15, 0.30):
        h = {**HYPOTHESES, "commission_magasin": commission}
        print(f"\n=== Commission des magasins : {int(commission * 100)} % ===")
        print(f"{'Scénario':52} {'Pièces/mois':>14} {'Abonnés':>8} {'Revenu Premium net':>19} {'Coût pièces':>13} {'Solde':>13} {'Engagement non couvert':>23}")
        for nom, vol, ab in SCENARIOS:
            r = simulate(vol, ab, h)
            print(f"{nom:52} {vol:>14,.0f} {ab:>8,} {r['net_premium']:>19,.0f} {r['perte_pieces']:>13,.0f} {r['solde']:>13,.0f} {r['engagement_non_couvert']:>23,.0f}")
        print(f"Seuil : au-delà de {seuil_pieces_par_abonne(h):,.0f} FCFA de pièces achetées par abonné Premium et par mois, le solde devient négatif.")
