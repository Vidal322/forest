-- Smoke test for the schema: loads sample data, prints derived views, and checks
-- that bad data is rejected. Everything runs in one transaction and is rolled back.
-- Run:  make db-smoke   (every expect_fail line should read REJECTED)
\set ON_ERROR_STOP on
BEGIN;
-- dates are relative to "today" so the check works any day; offsets mirror the mockups (today = 22 nov)
SET LOCAL timezone = 'Europe/Lisbon';
CREATE TEMP TABLE d AS SELECT current_date AS t;
INSERT INTO field (id, name, frame_width, frame_height, calibration_line, calibration_length_m)
VALUES ('00000000-0000-0000-0000-000000000001', 'Quinta', 1000, 700, 'LINESTRING(180 640, 492 620)', 150.0);
-- a 14-day rule covering the current month, so the output is the same any day of the year
INSERT INTO watering_rule (field_id, name, from_month, to_month, interval_days) VALUES
 ('00000000-0000-0000-0000-000000000001', 'This month', extract(month from current_date)::int, extract(month from current_date)::int, 14);
INSERT INTO plot (id, field_id, name, geom, declared_area_ha) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Plot 1','POLYGON((30 30,470 30,480 670,40 600,30 30))',6.2),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Plot 2','POLYGON((500 150,840 150,960 690,500 690,500 150))',4.96);
INSERT INTO zone (id, plot_id, label, kind, geom) VALUES
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000a1','Z3 Faixa oeste','cultivation','POLYGON((80 220,180 210,190 380,90 400,80 220))'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000a1','Z11 Ressementeira','cultivation','POLYGON((100 335,200 328,205 385,105 392,100 335))'),
 ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000a1','Z6 Linha','cultivation','POLYGON((90 450,180 440,190 560,100 560,90 450))'),
 ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a2','Z2 Encosta','cultivation','POLYGON((600 300,700 300,700 400,600 400,600 300))'),
 ('00000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-0000000000a2','Z10 Caminho','path','POLYGON((600 200,833 200,836 225,600 225,600 200))');
INSERT INTO species (id, scientific_name, common_name) VALUES
 ('00000000-0000-0000-0000-0000000005b1','Quercus suber','sobreiro'),
 ('00000000-0000-0000-0000-0000000005b2','Castanea sativa','castanheiro'),
 ('00000000-0000-0000-0000-0000000005b3','Arbutus unedo','medronheiro');
-- A1: sowing 55 days ago in Z3 with seed mix; A2: planting 39 days ago in Z3; A3: watering 20 days ago Z3 + Z2;
-- A4: sowing 7 days ago in Z11; A5: watering 3 days ago in Z2
INSERT INTO activity (id, field_id, type, performed_on) VALUES
 ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-000000000001','sowing',  current_date - 55),
 ('00000000-0000-0000-0000-00000000ac02','00000000-0000-0000-0000-000000000001','planting',current_date - 39),
 ('00000000-0000-0000-0000-00000000ac03','00000000-0000-0000-0000-000000000001','watering',current_date - 20),
 ('00000000-0000-0000-0000-00000000ac04','00000000-0000-0000-0000-000000000001','sowing',  current_date - 7),
 ('00000000-0000-0000-0000-00000000ac05','00000000-0000-0000-0000-000000000001','watering',current_date - 3);
INSERT INTO activity_zone VALUES
 ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-00000000000c',60,'holes'),
 ('00000000-0000-0000-0000-00000000ac02','00000000-0000-0000-0000-00000000000c',30,'trees'),
 ('00000000-0000-0000-0000-00000000ac03','00000000-0000-0000-0000-00000000000c',NULL,NULL),
 ('00000000-0000-0000-0000-00000000ac03','00000000-0000-0000-0000-00000000000e',NULL,NULL),
 ('00000000-0000-0000-0000-00000000ac04','00000000-0000-0000-0000-00000000000b',30,'holes'),
 ('00000000-0000-0000-0000-00000000ac05','00000000-0000-0000-0000-00000000000e',NULL,NULL);
INSERT INTO activity_species (activity_id, species_id) VALUES
 ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-0000000005b1'),
 ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-0000000005b3');
-- 19 alive + 1 dead sobreiro, 10 castanheiro in Plot 1
INSERT INTO tree (plot_id, species_id, planting_activity_id, status)
SELECT '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000ac02','alive' FROM generate_series(1,19);
INSERT INTO tree (plot_id, species_id, status) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000005b1','dead');
INSERT INTO tree (plot_id, species_id, status)
SELECT '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000005b2','alive' FROM generate_series(1,10);
INSERT INTO task (zone_id, title, kind) VALUES ('00000000-0000-0000-0000-00000000000c','Falta adubar e regar','fertilize');
INSERT INTO task (plot_id, title, kind) VALUES ('00000000-0000-0000-0000-0000000000a2','Refazer caminho','improve_path');

\echo '--- zone_status (expect Z3 needs water; Z11 sown 7d ago ok; Z6 nothing yet = false; Z2 ok; path = NULL)'
SELECT z.label, s.last_sown_on IS NOT NULL AS sown, s.last_watered_on, s.current_interval_days AS every, s.needs_water, s.open_task_count AS tasks
  FROM zone_status s JOIN zone z ON z.id = s.zone_id ORDER BY z.label;
\echo '--- plot_stats (expect Plot 1: ~6.1 ha, 29 alive, 1 dead, 3 species [sob, cas + med sown], 1 task; Plot 2: 1 task)'
SELECT name, round(area_ha::numeric, 2) AS area_ha, declared_area_ha, tree_count, dead_tree_count, species_count, last_watered_on, open_task_count FROM plot_stats ORDER BY name;
\echo '--- metres_per_unit (expect ~0.480)'
SELECT round(metres_per_unit, 3) FROM field;

\echo '--- constraints (each line should say REJECTED)'
CREATE FUNCTION pg_temp.expect_fail(sql text, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN 'ACCEPTED (BUG): ' || label;
EXCEPTION WHEN OTHERS THEN RETURN 'REJECTED: ' || label || ' — ' || SQLERRM; END $$;
SELECT pg_temp.expect_fail($$INSERT INTO task (plot_id, zone_id, title) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c','x')$$, 'task on plot AND zone');
SELECT pg_temp.expect_fail($$INSERT INTO task (title) VALUES ('x')$$, 'task on neither');
SELECT pg_temp.expect_fail($$INSERT INTO task (zone_id, title, status) VALUES ('00000000-0000-0000-0000-00000000000c','x','done')$$, 'done task without completed_at');
SELECT pg_temp.expect_fail($$INSERT INTO activity_zone VALUES ('00000000-0000-0000-0000-00000000ac05','00000000-0000-0000-0000-00000000000c',5,NULL)$$, 'quantity without unit');
SELECT pg_temp.expect_fail($$INSERT INTO species (scientific_name) VALUES ('quercus SUBER')$$, 'duplicate species, other case');
SELECT pg_temp.expect_fail($$INSERT INTO plot (field_id, name, geom) VALUES ('00000000-0000-0000-0000-000000000001','Plot 1','POLYGON((0 0,1 0,1 1,0 1,0 0))')$$, 'duplicate live plot name');
SELECT pg_temp.expect_fail($$INSERT INTO zone (plot_id, geom) VALUES ('00000000-0000-0000-0000-0000000000a1','POLYGON((0 0,10 10,10 0,0 10,0 0))')$$, 'self-intersecting zone');
SELECT pg_temp.expect_fail($$UPDATE field SET calibration_line = NULL$$, 'line without length');
SELECT pg_temp.expect_fail($$UPDATE field SET calibration_line = 'LINESTRING(5 5, 5 5)'$$, 'zero-length calibration');
SELECT pg_temp.expect_fail($$INSERT INTO watering_rule (field_id, name, from_month, to_month, interval_days) VALUES ('00000000-0000-0000-0000-000000000001','x',13,1,5)$$, 'month 13');
SELECT pg_temp.expect_fail($$INSERT INTO field_image (field_id, image_key, width_px, height_px, affine_to_frame) VALUES ('00000000-0000-0000-0000-000000000001','k',10,10,'{1,0,0}')$$, 'affine with 3 numbers');
SELECT pg_temp.expect_fail($$INSERT INTO field_image (field_id, image_key, width_px, height_px, is_current) VALUES ('00000000-0000-0000-0000-000000000001','a',10,10,true),('00000000-0000-0000-0000-000000000001','b',10,10,true)$$, 'two current photos');
SELECT pg_temp.expect_fail($$DELETE FROM zone WHERE id = '00000000-0000-0000-0000-00000000000c'$$, 'hard-delete zone with history');

\echo '--- soft-deleted plot name can be reused; updated_at trigger'
INSERT INTO plot (field_id, name, geom, deleted_at) VALUES ('00000000-0000-0000-0000-000000000001','Plot 1','POLYGON((0 0,1 0,1 1,0 1,0 0))', now());
SELECT 'reuse ok';
\echo '--- seasonal rule wrapping December picks narrowest range'
DELETE FROM watering_rule;
INSERT INTO watering_rule (field_id, name, from_month, to_month, interval_days) VALUES
 ('00000000-0000-0000-0000-000000000001','Winter',11,2,14),
 ('00000000-0000-0000-0000-000000000001','Christmas',12,12,3),
 ('00000000-0000-0000-0000-000000000001','Summer',6,9,4);
SELECT water_interval_days('00000000-0000-0000-0000-000000000001','2026-01-15') AS jan_expect_14,
       water_interval_days('00000000-0000-0000-0000-000000000001','2026-12-10') AS dec_expect_3,
       water_interval_days('00000000-0000-0000-0000-000000000001','2026-07-01') AS jul_expect_4,
       water_interval_days('00000000-0000-0000-0000-000000000001','2026-04-01') AS apr_expect_default_7;

\echo '--- review fixes (each should say REJECTED)'
SELECT pg_temp.expect_fail($$INSERT INTO zone (plot_id, geom) VALUES ('00000000-0000-0000-0000-0000000000a1', ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'))$$, 'zone with SRID 4326');
SELECT pg_temp.expect_fail($$UPDATE field SET calibration_line = 'SRID=4326;LINESTRING(0 0, 10 0)'$$, 'calibration line SRID 4326');
SELECT pg_temp.expect_fail($$INSERT INTO zone (plot_id, geom) VALUES ('00000000-0000-0000-0000-0000000000a1','POLYGON EMPTY')$$, 'empty zone');
SELECT pg_temp.expect_fail($$INSERT INTO tree (plot_id, species_id, position) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000005b1','POINT EMPTY')$$, 'empty tree position');
SELECT pg_temp.expect_fail($$UPDATE field SET calibration_length_m = 'NaN'$$, 'NaN calibration');
SELECT pg_temp.expect_fail($$UPDATE field SET calibration_length_m = 'Infinity'$$, 'Infinity calibration');
SELECT pg_temp.expect_fail($$INSERT INTO field_image (field_id, image_key, width_px, height_px, affine_to_frame) VALUES ('00000000-0000-0000-0000-000000000001','k',10,10,'{1,NULL,0,0,1,0}')$$, 'affine with NULL');
SELECT pg_temp.expect_fail($$INSERT INTO field_image (field_id, image_key, width_px, height_px, affine_to_frame) VALUES ('00000000-0000-0000-0000-000000000001','k',10,10,'{{1},{0},{0},{0},{1},{0}}')$$, 'affine 2-D');
SELECT pg_temp.expect_fail($$INSERT INTO field_image (field_id, image_key, width_px, height_px, affine_to_frame) VALUES ('00000000-0000-0000-0000-000000000001','k',10,10,'{NaN,0,0,0,1,0}')$$, 'affine NaN');
SELECT pg_temp.expect_fail($$INSERT INTO plot (field_id, name, geom, declared_area_ha) VALUES ('00000000-0000-0000-0000-000000000001','P9','POLYGON((0 0,1 0,1 1,0 1,0 0))','NaN')$$, 'NaN declared area');
\echo '--- version + updated_at: real change bumps, identical update does not'
SELECT version FROM activity WHERE id = '00000000-0000-0000-0000-00000000ac05';
UPDATE activity SET notes = notes WHERE id = '00000000-0000-0000-0000-00000000ac05';
SELECT version AS after_noop_expect_1 FROM activity WHERE id = '00000000-0000-0000-0000-00000000ac05';
UPDATE activity SET notes = 'regado' WHERE id = '00000000-0000-0000-0000-00000000ac05';
SELECT version AS after_edit_expect_2 FROM activity WHERE id = '00000000-0000-0000-0000-00000000ac05';
UPDATE activity SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-00000000ac05';
SELECT version AS after_soft_delete_expect_3 FROM activity WHERE id = '00000000-0000-0000-0000-00000000ac05';
\echo '--- soft-deleted zone with an open task no longer counts in plot_stats'
INSERT INTO task (zone_id, title) VALUES ('00000000-0000-0000-0000-00000000000e', 'task on Z2');
SELECT open_task_count AS plot2_before_expect_2 FROM plot_stats WHERE name = 'Plot 2';
UPDATE zone SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-00000000000e';
SELECT open_task_count AS plot2_after_expect_1 FROM plot_stats WHERE name = 'Plot 2';
\echo '--- "today" ignores the session timezone'
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT field_today() = (now() AT TIME ZONE 'Europe/Lisbon')::date AS today_is_lisbon;
ROLLBACK;
