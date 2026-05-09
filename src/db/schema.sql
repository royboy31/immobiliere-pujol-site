-- D1 Schema for Immobiliere Pujol annonces
-- Database: pujol-annonces

-- Main annonces table
CREATE TABLE IF NOT EXISTS annonces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  permalink TEXT,

  -- Status: 'active', 'closed'
  status TEXT NOT NULL DEFAULT 'closed',

  -- Identity / References
  wp_id INTEGER,                     -- Original WordPress post ID
  reference_agence TEXT,             -- Neotim/agency reference (e.g., "226", "897neot")
  ubiflow_annonce_id TEXT,           -- Ubiflow XML annonce id attribute
  ubiflow_reference TEXT,            -- Ubiflow XML reference field

  -- Classification
  type_annonce TEXT,                  -- 'L' (location) or 'V' (vente)
  type_bien TEXT,                     -- Apartment, house, commercial, etc.
  termine TEXT,                       -- 'Terminé' or 'Ouverte'

  -- Location
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  quartier TEXT,
  arrondissement TEXT,
  latitude REAL,
  longitude REAL,

  -- Pricing
  prix REAL,                          -- Sale price or rent
  loyer_cc REAL,                      -- Rent including charges
  loyer_ht REAL,                      -- Rent excluding charges
  charges REAL,
  honoraires TEXT,
  honoraires_etat_des_lieux REAL,
  garantie TEXT,
  depot_garantie REAL,

  -- Property details
  surface REAL,
  surface_terrain REAL,
  nb_pieces INTEGER,
  nb_chambres INTEGER,
  nb_salles_bain INTEGER,
  nb_salles_eau INTEGER,
  nb_wc INTEGER,
  etage TEXT,
  nb_etages TEXT,

  -- Features
  meuble INTEGER DEFAULT 0,           -- Boolean: 0/1
  ascenseur INTEGER DEFAULT 0,
  cave INTEGER DEFAULT 0,
  parking TEXT,
  garage TEXT,
  terrasse INTEGER DEFAULT 0,
  balcon TEXT,
  piscine INTEGER DEFAULT 0,
  digicode INTEGER DEFAULT 0,
  interphone INTEGER DEFAULT 0,
  gardien INTEGER DEFAULT 0,
  coup_de_coeur INTEGER DEFAULT 0,

  -- Energy
  dpe_note TEXT,                      -- A-G or 'ns'
  dpe_valeur TEXT,
  ges_note TEXT,                      -- A-G or 'NS'
  ges_valeur TEXT,
  type_chauffage TEXT,

  -- Content
  titre TEXT,
  libelle TEXT,
  descriptif TEXT,                    -- HTML description
  date_disponibilite TEXT,

  -- Contact
  contact_a_afficher TEXT,
  telephone_a_afficher TEXT,
  email_a_afficher TEXT,

  -- Mandat
  mandat_numero TEXT,
  mandat_type TEXT,
  mandat_date TEXT,

  -- Virtual tour
  url_visite_virtuelle TEXT,

  -- SEO
  seo_title TEXT,
  seo_description TEXT,

  -- Timestamps
  date_creation TEXT,                 -- When first imported
  date_modification TEXT,             -- Last sync update
  date_fermeture TEXT,                -- When status changed to 'closed'
  source TEXT DEFAULT 'wordpress',    -- 'wordpress' or 'ubiflow'

  -- Indexes created below
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Photos table (one-to-many)
CREATE TABLE IF NOT EXISTS annonces_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  annonce_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  position INTEGER DEFAULT 0,        -- Display order
  source TEXT DEFAULT 'wordpress',    -- 'wordpress', 'ubiflow', 'r2'
  FOREIGN KEY (annonce_id) REFERENCES annonces(id) ON DELETE CASCADE
);

-- SEO links for closed listings (editable via CMS)
CREATE TABLE IF NOT EXISTS annonces_seo_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  annonce_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  FOREIGN KEY (annonce_id) REFERENCES annonces(id) ON DELETE CASCADE
);

-- Ubiflow sync log
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  annonces_in_feed INTEGER DEFAULT 0,
  inserted INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  error_details TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_annonces_slug ON annonces(slug);
CREATE INDEX IF NOT EXISTS idx_annonces_status ON annonces(status);
CREATE INDEX IF NOT EXISTS idx_annonces_type ON annonces(type_annonce);
CREATE INDEX IF NOT EXISTS idx_annonces_arrondissement ON annonces(arrondissement);
CREATE INDEX IF NOT EXISTS idx_annonces_prix ON annonces(prix);
CREATE INDEX IF NOT EXISTS idx_annonces_code_postal ON annonces(code_postal);
CREATE INDEX IF NOT EXISTS idx_annonces_reference ON annonces(reference_agence);
CREATE INDEX IF NOT EXISTS idx_annonces_ubiflow_id ON annonces(ubiflow_annonce_id);
CREATE INDEX IF NOT EXISTS idx_annonces_contact ON annonces(contact_a_afficher);
CREATE INDEX IF NOT EXISTS idx_photos_annonce ON annonces_photos(annonce_id);
CREATE INDEX IF NOT EXISTS idx_seo_links_annonce ON annonces_seo_links(annonce_id);
