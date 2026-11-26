-- Per-collection Deuna charge link (usually for the exact amount) and the day it stops working (YYYY-MM-DD, Ecuador).
ALTER TABLE collections ADD COLUMN deuna_link TEXT;
ALTER TABLE collections ADD COLUMN deuna_link_expires TEXT;
