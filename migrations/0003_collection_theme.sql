-- Collection theming: accent tone (#RRGGBB) and an optional cover image stored in R2 under covers/.
-- Existing rows get the Christmas red, the tone of the first collection (vestuario-musical).
ALTER TABLE collections ADD COLUMN tone TEXT NOT NULL DEFAULT '#C81E3A';
ALTER TABLE collections ADD COLUMN cover_key TEXT;
