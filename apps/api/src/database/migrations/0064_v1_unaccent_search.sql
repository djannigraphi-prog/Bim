-- V1 : recherche de personnes et du BimShop sans tenir compte des accents (« kone » trouve « Koné »).
-- Extension fournie avec PostgreSQL (contrib) et « de confiance » depuis PostgreSQL 13 : installable par le propriétaire de la base.
CREATE EXTENSION IF NOT EXISTS unaccent;
