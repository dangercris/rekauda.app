-- Local-only seed with two fictional tenants (demo-a and demo-b) to exercise isolation. All data is invented.
-- Safe to run repeatedly: every insert is skipped when the row already exists.
INSERT INTO tenants (id, slug, status, config_json, r2_prefix, inbound_token_hash, source, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'demo-a', 'active', '{"schoolName":"Demo School A","className":"Demo class A","classShortName":"Demo A","classMark":"DA","treasury":{"bank":"Demo Bank A","accountType":"Savings","accountNumber":"0000000000","holder":"Treasurer A","holderId":"0000000000","deunaUrl":null,"qrUrl":null,"helpUrl":null},"banks":["Demo Bank A","Other bank"],"earliestTransferDate":"2026-11-01","defaultTone":"#C81E3A","analytics":{"gaMeasurementId":null}}', 't/a0000000-0000-4000-8000-00000000000a/',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'cloud', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z'),
  ('b0000000-0000-4000-8000-00000000000b', 'demo-b', 'active', '{"schoolName":"Demo School B","className":"Demo class B","classShortName":"Demo B","classMark":"DB","treasury":{"bank":"Demo Bank B","accountType":"Savings","accountNumber":"9999990000","holder":"Treasurer B","holderId":"0000000000","deunaUrl":null,"qrUrl":null,"helpUrl":null},"banks":["Demo Bank B","Other bank"],"earliestTransferDate":"2026-11-01","defaultTone":"#1E3AC8","analytics":{"gaMeasurementId":null}}', 't/b0000000-0000-4000-8000-00000000000b/',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cloud', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z') ON CONFLICT DO NOTHING;

INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES
  ('demo-a.localhost', 'a0000000-0000-4000-8000-00000000000a', 'subdomain', '2026-11-26T00:00:00.000Z'),
  ('demo-b.localhost', 'b0000000-0000-4000-8000-00000000000b', 'subdomain', '2026-11-26T00:00:00.000Z') ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, kind, created_at) VALUES
  ('u0000000-0000-4000-8000-00000000000a', 'owner-a@example.test', 'person', '2026-11-26T00:00:00.000Z'),
  ('u0000000-0000-4000-8000-00000000000b', 'owner-b@example.test', 'person', '2026-11-26T00:00:00.000Z') ON CONFLICT DO NOTHING;

INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'u0000000-0000-4000-8000-00000000000a', 'owner', '2026-11-26T00:00:00.000Z'),
  ('b0000000-0000-4000-8000-00000000000b', 'u0000000-0000-4000-8000-00000000000b', 'owner', '2026-11-26T00:00:00.000Z') ON CONFLICT DO NOTHING;

INSERT INTO collections (id, tenant_id, slug, title, description, options_json, deadline, created_at, updated_at) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'demo-collection', 'Demo collection A', 'Invented collection for tenant A.',
   '[{"key":"standard","label":"Standard","detail":"Demo","cents":1000}]', '2026-12-31', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z'),
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'demo-collection', 'Demo collection B', 'Invented collection for tenant B.',
   '[{"key":"standard","label":"Standard","detail":"Demo","cents":2000}]', '2026-12-31', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z') ON CONFLICT DO NOTHING;
