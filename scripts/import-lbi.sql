INSERT INTO annonces (
    slug, status, reference_agence,
    type_annonce, type_bien,
    code_postal, ville,
    prix,
    surface, surface_terrain,
    nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
    etage, nb_etages, ascenseur, cave, terrasse,
    parking, interphone, balcon,
    dpe_note, dpe_valeur, ges_note,
    titre, descriptif,
    contact_a_afficher, telephone_a_afficher, email_a_afficher,
    mandat_numero,
    date_creation, date_modification, source, created_at, updated_at
  ) VALUES (
    'mbvap160009824-13006-marseille', 'active', 'MBVAP160009824',
    'V', 'appartement',
    '13006', 'Marseille',
    620000,
    182, NULL,
    6, 4, 1, 2,
    '5', '5', 1, 1, 1,
    '1', 1, 1,
    'D', '222', 'E',
    'Castellane 13006 Marseille - Grand appartement bourgeois T6 ', '<br>EXCLUSIVITE - Appartement T6 avec balcon, 2 caves et 3 chambres de bonnes, place Castellane Marseille.<br>Situé angle rue d''Italie/Bd Baille dans le 6ème arrondissement de Marseille, ce spacieux appartement de 182,17 m2 Loi Carrez occupe le 5ème et dernier étage d''un immeuble bourgeois avec balcon filant de 8 m2, offrant une vue dégagée sur la ville et Notre-Dame de la Garde.<br>Ce bien se distingue par ses volumes importants et sa configuration adaptée à une vie de famille. L''entrée de 13 m2 distribue de larges pièces de réception: Un séjour de 32 m2 et une salle à manger de 23 m2, totalisant plus de 55 m2 d''espace de vie, une cuisine indépendante de 18 m2, quatre chambres spacieuses allant de 8 m2 à plus de 17 m2, deux salles d''eau, deux WC et deux espaces de rangement type dressing.Le cachet de l''ancien est préservé avec des sols en tomettes, des cheminées d''époque et une belle hauteur sous plafond. Les nombreuses ouvertures permettent une luminosité constante tout au long de la journée.<br>L''appartement dispose de nombreux espaces complémentaires totalisant une surface au sol de 182,42 m2. La vente inclut également :Trois chambres de service (environ 18 m2 au sol cumulés), deux caves en sous-sol pour un espace de stockage supplémentaire de près de 18 m2.Un balcon de 8,47 m2 accessible depuis les pièces de vie principales.<br>L''immeuble est idéalement placé à proximité immédiate de la place Castellane. Ce secteur central du 6ème arrondissement offre un accès privilégié à toutes les commodités : Transports : Connexion directe aux lignes de Métro M1 et M2, ainsi qu''au Tramway T3 à la station Castellane. Services : Écoles, collèges et lycées de renom à quelques minutes à pied. Commerces : Marché quotidien du Prado, nombreux commerces de bouche de la rue d''Italie et de la rue de Rome.<br>Ce bien représente une opportunité pour ceux qui recherchent de grands volumes et une localisation centrale dans l''un des quartiers les plus dynamiques de Marseille.<br> Mandat no6331 - honoraires à la charge du vendeur. Charges annuelles 3800EUR - Taxe foncière 2500EUR .<br> Copropriété de 10 lots principaux - pas de procédures à l''encontre du syndicat des copropriétaires.<br> DPE classe E - Montant estimé des dépenses annuelles d''énergie pour un usage standard : entre 4880EUR et 6690EUR par an; Prix moyens des énergies indexés au 01/01/2023 (abonnement compris). Les informations sur les risques auxquels ce bien est exposé sont disponibles sur le site Géorisques : www.georisques.gouv.fr<br> IMMOBILIERE PUJOL / Benoit MARIN-VICENTE 06 37 56 68 51<br>   <br> <br>  ',
    'Immobilière Pujol', '0491373839', 'carolinepujol@immobiliere-pujol.fr',
    '6331',
    '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z', 'lbi', '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z'
  )
  ON CONFLICT(slug) DO UPDATE SET
    status='active', reference_agence=excluded.reference_agence,
    type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
    code_postal=excluded.code_postal, ville=excluded.ville,
    prix=excluded.prix,
    surface=excluded.surface, surface_terrain=excluded.surface_terrain,
    nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
    nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
    etage=excluded.etage, nb_etages=excluded.nb_etages,
    ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
    parking=excluded.parking, interphone=excluded.interphone, balcon=excluded.balcon,
    dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur, ges_note=excluded.ges_note,
    titre=excluded.titre, descriptif=excluded.descriptif,
    contact_a_afficher=excluded.contact_a_afficher,
    telephone_a_afficher=excluded.telephone_a_afficher,
    email_a_afficher=excluded.email_a_afficher,
    mandat_numero=excluded.mandat_numero,
    date_modification=excluded.date_modification, source='lbi',
    date_fermeture=NULL, updated_at=excluded.updated_at;

DELETE FROM annonces_photos WHERE annonce_id = (SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_820fb7971ba3ac85fd8965cec467ab74.jpg', 0, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_5b88c303f816ce454a568cb5e176ae82.png', 1, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_fd568f71837325e9879b0ab431e82a36.png', 2, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_39507fbcfa9c164afb5734962950c9ca.png', 3, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_ab58154090a14fcba04932d282ef95b5.jpg', 4, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_f43cddce1926ce0cc1bed4910c1cae18.png', 5, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_2e808d1ce58f466cf5a57bfb7f84348a.png', 6, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_ab8bb14572d0f8236ebe5e39f66ac510.png', 7, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_72f58dd024faaa666de183374a9e1d07.png', 8, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_768792b07104d7b5f1214d34eb4a2941.jpg', 9, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_c8e6e4fe859a71bc709866309cd70560.png', 10, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_45986fb118432459969aba96b2e33b8a.jpg', 11, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_fc71e713b2833793ed52e5819eeaa0d7.png', 12, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_44fd6f4f806339ba80631d7d5af139ab.jpg', 13, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_cdf16147e0ac3ce6adbd3859c161d76c.png', 14, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009824-13006-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/d55896dd9be9e70516c8d9174d685668/photo_c0976e230d758eb8a6d62c4d39912a04.jpg', 15, 'r2');

INSERT INTO annonces (
    slug, status, reference_agence,
    type_annonce, type_bien,
    code_postal, ville,
    prix,
    surface, surface_terrain,
    nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
    etage, nb_etages, ascenseur, cave, terrasse,
    parking, interphone, balcon,
    dpe_note, dpe_valeur, ges_note,
    titre, descriptif,
    contact_a_afficher, telephone_a_afficher, email_a_afficher,
    mandat_numero,
    date_creation, date_modification, source, created_at, updated_at
  ) VALUES (
    'mbvap160009826-13004-marseille', 'active', 'MBVAP160009826',
    'V', 'appartement',
    '13004', 'Marseille',
    230000,
    75, NULL,
    3, 2, 1, 1,
    '2', '7', 1, 0, 0,
    '1', 1, 1,
    'D', '155', 'D',
    'Blancarde 13004 Marseille  - Appartement T3 avec balcons, ca', ' EXCLUSIVITE - Appartement de Type 3 climatisé de 75 m2 avec balcons, cave et garage - 139 bd de la Blancarde Marseille 13004<br><br>Situé au coeur du quartier de la Blancarde dans le 4ème arrondissement de Marseille, cet appartement de 75,52 m2 Loi Carrez situé au 2eme étage offre un agencement fonctionnel et une luminosité naturelle constante grâce à sa double exposition.<br>L''entrée de près de 6 m2 mène à une pièce de vie spacieuse de plus de 20 m2, ouvrant sur un premier balcon exposée plein sud. La cuisine indépendante de 10 m2 est aménagée et donne accès à un second balcon de 10 m2 située au calme. L''espace nuit se compose de deux chambres confortables de plus de 11 m2 chacune, d''une salle de bain et de WC séparés. Un dégagement avec placards et un dressing complètent le bien pour optimiser le rangement.<br>Le logement est équipé d''une climatisation réversible de type split installée récemment. Les menuiseries sont en PVC avec double vitrage, assurant une isolation thermique et acoustique efficace. L''appartement bénéficie d''un classement énergétique performant en catégorie C. En complément, le bien est vendu avec une cave en sous-sol et un garage privatif fermé situé au rez-de-chaussée de l''immeuble.<br>La situation géographique sur le Boulevard de la Blancarde permet un accès immédiat à toutes les commodités. Les commerces de proximité (boulangeries, pharmacies, supermarchés) ainsi que les structures scolaires se trouvent à quelques minutes de marche.<br>Le secteur est particulièrement bien desservi par les transports en commun : Tramway et Bus : Arrêts à proximité immédiate au pied de la résidence. Métro et Train : La gare de Marseille-Blancarde (TGV, TER, Métro M1) est accessible rapidement à pied, facilitant les déplacements vers le centre-ville, les pôles universitaires ou l''extérieur de la ville.<br> Mandat no6344 - honoraires à la charge du vendeur. Charges annuelles 1900EUR - Taxe foncière 1787EUR .<br> Copropriété de 15 lots principaux - pas de procédures à l''encontre du syndicat des copropriétaires.<br> DPE classe C - Montant estimé des dépenses annuelles d''énergie pour un usage standard : entre 1170EUR et 1680EUR par an; Prix moyens des énergies indexés au 01/01/2023 (abonnement compris).<br> Les informations sur les risques auxquels ce bien est exposé sont disponibles sur le site Géorisques -ww.georisques.gouv.fr<br> IMMOBILIERE PUJOL / Benoit MARIN-VICENTE 06 37 56 68 51<br><br>  ',
    'Immobilière Pujol', '0491373839', 'carolinepujol@immobiliere-pujol.fr',
    '6344',
    '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z', 'lbi', '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z'
  )
  ON CONFLICT(slug) DO UPDATE SET
    status='active', reference_agence=excluded.reference_agence,
    type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
    code_postal=excluded.code_postal, ville=excluded.ville,
    prix=excluded.prix,
    surface=excluded.surface, surface_terrain=excluded.surface_terrain,
    nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
    nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
    etage=excluded.etage, nb_etages=excluded.nb_etages,
    ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
    parking=excluded.parking, interphone=excluded.interphone, balcon=excluded.balcon,
    dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur, ges_note=excluded.ges_note,
    titre=excluded.titre, descriptif=excluded.descriptif,
    contact_a_afficher=excluded.contact_a_afficher,
    telephone_a_afficher=excluded.telephone_a_afficher,
    email_a_afficher=excluded.email_a_afficher,
    mandat_numero=excluded.mandat_numero,
    date_modification=excluded.date_modification, source='lbi',
    date_fermeture=NULL, updated_at=excluded.updated_at;

DELETE FROM annonces_photos WHERE annonce_id = (SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_85dc4d7946b0b70ec6b89d77800e148c.jpg', 0, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_776dbad7f5b4fc4795efcc2ec02e29ce.jpg', 1, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_4b497d3980fd471a671b847b03f750ed.jpg', 2, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_a6356f746f1b8a0cbe30f4277711c2af.jpg', 3, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_19d1709889a08d00fe3c93ed4ee3c1a9.jpg', 4, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_97362ff74d7f130180c68c5384902954.jpg', 5, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_248ec1966098a8a23dade1c623ebdce9.jpg', 6, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_b92823584079076c2fb89a10559fbfb4.jpg', 7, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_968084c7aedde800234515eec6dfcba9.jpg', 8, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_e02803070946000322ae207e9a3f1824.jpg', 9, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvap160009826-13004-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/f8125e6822f20cd047d74a838af4020e/photo_6ca2f5a0dfebcaf8c1001040d98e97d6.jpg', 10, 'r2');

INSERT INTO annonces (
    slug, status, reference_agence,
    type_annonce, type_bien,
    code_postal, ville,
    prix,
    surface, surface_terrain,
    nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
    etage, nb_etages, ascenseur, cave, terrasse,
    parking, interphone, balcon,
    dpe_note, dpe_valeur, ges_note,
    titre, descriptif,
    contact_a_afficher, telephone_a_afficher, email_a_afficher,
    mandat_numero,
    date_creation, date_modification, source, created_at, updated_at
  ) VALUES (
    'mbvma160009827-13011-marseille', 'active', 'MBVMA160009827',
    'V', 'maison/villa',
    '13011', 'Marseille',
    360000,
    101, NULL,
    4, 3, NULL, 1,
    NULL, '3', 0, 0, 0,
    NULL, 0, 0,
    'C', '119', 'A',
    'LA POMME - MAISON DE VILLE AVEC TERRASSES', ' EXCLUSIVITE - Avenue Emmanuel Allard 13011 Marseille,Quartier La Pomme, maison individuelle de 100 m2 avec deux terrasses<br><br>Cette habitation ancienne a bénéficié de rénovations successives alliant le charme de l''ancien, comme les poutres apparentes, à un confort moderne.Elle s''organise comme suit:<br>Rez-de-chaussée : L''entrée s''ouvre sur une pièce de vie de 36.67 m2 comprenant un séjour équipé d''un insert à bois.  La cuisine indépendante de 13.86 m2 est entièrement aménagée avec de nombreux rangements et donne un accès direct à une première terrasse privative de 22.51 m2, idéale pour les repas en extérieur.<br>Premier étage : L''espace nuit se compose de deux chambres confortables de 12.68 m2 et 8.95 m2. Ce niveau dispose également d''un dégagement, d''une salle d''eau de 6.48 m2 et d''un WC indépendant. Une seconde terrasse de 13.95 m2 complète cet étage.<br>Deuxième étage : Les combles ont été aménagés en une mezzanine de 13.11 m2, offrant un espace supplémentaire pouvant servir de bureau, de salle de jeux ou de troisième chambre d''appoint.<br>Le bien est classé en catégorie C pour sa performance énergétique, ce qui est remarquable pour une construction de cette époque. Le confort thermique est assuré par une pompe à chaleur air/air (climatisation réversible) installée en 2017 et un insert bois performant. L''eau chaude est produite par deux ballons électriques récents (100L et 50L). L''isolation de la toiture a été réalisée entre 2006 et 2012, et les menuiseries sont majoritairement en PVC double vitrage.<br> <br>Le quartier de La Pomme est reconnu pour sa facilité d''accès et sa proximité immédiate avec l''une des plus grandes zones commerciales de Marseille.<br>transports : Accès rapide aux axes autoroutiers (A50) vers Marseille centre ou Aubagne. Plusieurs lignes de bus desservent le secteur. Commodités : Écoles, collèges et tous les commerces de proximité sont accessibles rapidement.<br> Mandat no6335 - honoraires à la charge du vendeur - Taxe foncière 1600EUR . DPE classe C - Montant estimé des dépenses annuelles d''énergie pour un usage standard : entre 930EUR et 1320EUR par an; Prix moyens des énergies indexés au 01/01/2023 (abonnement compris).Les informations sur les risques auxquels ce bien est exposé sont disponibles sur le site Géorisques : www.georisques.gouv.fr<br> MMOBILIERE PUJOL / Benoit Marin-Vicente 06 37 56 68 51<br> <br>  ',
    'Immobilière Pujol', '0491373839', 'carolinepujol@immobiliere-pujol.fr',
    NULL,
    '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z', 'lbi', '2026-05-07T06:05:32.021Z', '2026-05-07T06:05:32.021Z'
  )
  ON CONFLICT(slug) DO UPDATE SET
    status='active', reference_agence=excluded.reference_agence,
    type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
    code_postal=excluded.code_postal, ville=excluded.ville,
    prix=excluded.prix,
    surface=excluded.surface, surface_terrain=excluded.surface_terrain,
    nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
    nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
    etage=excluded.etage, nb_etages=excluded.nb_etages,
    ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
    parking=excluded.parking, interphone=excluded.interphone, balcon=excluded.balcon,
    dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur, ges_note=excluded.ges_note,
    titre=excluded.titre, descriptif=excluded.descriptif,
    contact_a_afficher=excluded.contact_a_afficher,
    telephone_a_afficher=excluded.telephone_a_afficher,
    email_a_afficher=excluded.email_a_afficher,
    mandat_numero=excluded.mandat_numero,
    date_modification=excluded.date_modification, source='lbi',
    date_fermeture=NULL, updated_at=excluded.updated_at;

DELETE FROM annonces_photos WHERE annonce_id = (SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_bc15a5069d4c4da58c9f1525e301201e.jpg', 0, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_676457f6716c49f8b88f3daa00c3e20b.jpg', 1, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_ed60c57aae8ed1daafd28ae8d55158ef.jpg', 2, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_4b46fd1155e5a380c3ac2f75a0268006.jpg', 3, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_76886654118ceee0c26755d30a4448f6.jpg', 4, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_c501515d4572374b881fd9e7de0421f9.jpg', 5, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_a7a2b35758b687943535f91572b9750e.jpg', 6, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_509e8984c8387d360922733b4f0dfb1b.jpg', 7, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_eef72ebf1ce3945dfaf635ca1aec81c6.jpg', 8, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_c94a2d0c73210c6590bf26275bbcce16.jpg', 9, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_a6c4a7d4de66a1fec08d2f28701844e5.jpg', 10, 'r2');
INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = 'mbvma160009827-13011-marseille'), 'https://immopujol.staticlbi.com/wa/images/biens/1/dc00e57c22815a4aca4154329cd68d38/photo_5214f88ce0f22e79b52ea0f1aff110d1.jpg', 11, 'r2');