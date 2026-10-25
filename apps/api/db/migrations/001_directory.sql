-- Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

-- Care directory: specialties, facilities, and the doctors who practise at them.

CREATE TABLE specialties (
  code     text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name_en  text NOT NULL,
  name_ar  text NOT NULL
);

CREATE TYPE facility_kind AS ENUM ('hospital', 'specialty_centre', 'clinic', 'virtual_clinic');

CREATE TABLE facilities (
  id                               text PRIMARY KEY,
  name_en                          text NOT NULL,
  name_ar                          text NOT NULL,
  kind                             facility_kind NOT NULL,
  city_en                          text,
  city_ar                          text,
  country_code                     char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  has_emergency_department         boolean NOT NULL DEFAULT false,
  accepts_international_patients   boolean NOT NULL DEFAULT false,
  -- A virtual clinic serves every city; anything else must say where it is.
  CHECK ((kind = 'virtual_clinic') = (city_en IS NULL)),
  CHECK ((city_en IS NULL) = (city_ar IS NULL))
);

CREATE TABLE doctors (
  id                 text PRIMARY KEY,
  facility_id        text NOT NULL REFERENCES facilities (id),
  specialty_code     text NOT NULL REFERENCES specialties (code),
  name_en            text NOT NULL,
  name_ar            text NOT NULL,
  focus_en           text,
  focus_ar           text,
  years_experience   smallint NOT NULL CHECK (years_experience BETWEEN 0 AND 60),
  languages          text[] NOT NULL CHECK (cardinality(languages) > 0),
  in_person          boolean NOT NULL,
  telemedicine       boolean NOT NULL,
  second_opinion     boolean NOT NULL,
  fee_amount         integer NOT NULL CHECK (fee_amount > 0),
  fee_currency       char(3) NOT NULL CHECK (fee_currency ~ '^[A-Z]{3}$'),
  typical_wait_days  smallint NOT NULL CHECK (typical_wait_days >= 0),
  -- A doctor nobody can see is not a listing.
  CHECK (in_person OR telemedicine)
);

-- Every search filters on specialty; the remaining filters run on that small set.
CREATE INDEX doctors_specialty_idx ON doctors (specialty_code, typical_wait_days);
CREATE INDEX doctors_facility_idx ON doctors (facility_id);
CREATE INDEX doctors_languages_idx ON doctors USING gin (languages);
CREATE INDEX facilities_city_idx ON facilities (city_en);
