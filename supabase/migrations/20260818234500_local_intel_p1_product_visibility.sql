-- Elm Directory: Priority-1 product visibility completion
-- Applied to live Noel/Elm Supabase on 2026-08-18.
--
-- IMPORTANT REPOSITORY HISTORY NOTE
-- The live local_intel schema predates the local migration history currently present
-- in this repository. This is a forward migration against the existing Elm local_intel
-- baseline; it is not a clean-bootstrap definition of that baseline.

DO $$
BEGIN
  IF to_regclass('local_intel.entities') IS NULL
     OR to_regclass('local_intel.offerings') IS NULL
     OR to_regclass('local_intel.question_gaps') IS NULL THEN
    RAISE EXCEPTION 'Elm local_intel baseline is required before 20260818234500_local_intel_p1_product_visibility.sql';
  END IF;
END $$;

WITH product_rows(entity_key, offering_key, offering_type, title, description, product_categories, source_url, current_status, availability_note) AS (
  VALUES
  ('38-street-eats-marshfield','38-street-eats-rotating-food-truck-meals','food_truck_destination','Food truck meals at 38 Street Eats','38 Street Eats is a Marshfield food-truck destination hosting rotating mobile vendors. Vendor menus change; Elm must refresh the current truck before promising a specific dish.',ARRAY['food truck meals','rotating mobile-vendor food']::text[],'https://teamsoundenvision.com/events-2-1/whatsnormalfoodtruck','product_category_known_current_vendor_roster_needs_live_check','Current truck and menu require a live refresh.'),
  ('3m-marketplace','3m-marketplace-vendor-goods','vendor_market','3M Marketplace vendor goods','3M Marketplace runs recurring Marshfield vendor-market events. Independent seller and food-vendor products vary by event, so Elm can route residents to the marketplace as a vendor-goods source without claiming a particular vendor is present today.',ARRAY['vendor-market goods','food and drink from event vendors','independent seller goods']::text[],'https://www.js-bees.com/about','recurring_2026_market_product_mix_dynamic','Exact vendor roster and products vary by event and require current-event confirmation.'),
  ('antique-mercantile-marshfield','antique-mercantile-assortment','antiques_collectibles','Antique Mercantile antiques & collectibles','Antique Mercantile carries a broad antique and collectible assortment including furniture, glassware, primitives and country-store items. Individual pieces rotate continuously.',ARRAY['antiques','collectibles','furniture','glassware','primitives','country-store items']::text[],'https://antiquesmissouri.com/listing/antique-mercantile/','current_assortment_category_inventory_dynamic','Assortment category is current; a particular piece must be confirmed before a special trip.'),
  ('down-south-fried-fish-regional','down-south-fried-fish-menu','food_beverage','Down South Fried Fish menu','Down South Fried Fish sells fried fish meals and sides from its mobile food-truck operation. The official menu includes fish and fries, fries, sauces and drinks; rotating specials or sides can change.',ARRAY['fried fish','fish and fries','fries','sauces','soft drinks and tea']::text[],'https://downsouthfriedfish.com/find-us/','current_official_menu_mobile_location_dynamic','Menu identity is current; truck location and item availability require a live check.'),
  ('elm-farm','elm-farm-products-and-shop','farm_products','Elm Farm flowers, farm goods & shop','Elm Farm sells locally grown flowers and bouquets and also offers farm/shop goods. Current public shop and farm pages support fresh bouquets, wholesale seasonal flowers/foliage, teas, eggs, sourdough and Elm-branded goods; exact stock changes.',ARRAY['fresh flower bouquets','seasonal cut flowers and foliage','herbal tea','eggs','sourdough','Elm Farm gifts and merchandise']::text[],'https://www.elmfarm.co/','owner_verified_assortment_live_inventory_dynamic','Elm controls the source, but item-level stock still needs current inventory state.'),
  ('gooseberry-bridge-farm-rogersville','gooseberry-bridge-farm-products','farm_products','Gooseberry Bridge farm products','Gooseberry Bridge Farm is a current farm-product source in addition to its U-pick and family programs. Public farm information supports cut flowers, herbs, plant starts, herb salts and baked goods; exact seasonal stock changes.',ARRAY['cut flowers','herbs','plant starts','herb salts','baked goods']::text[],'https://missourigrownusa.com/members/7637','current_farm_product_categories_inventory_dynamic','Current harvest and farm-stand stock require refresh/direct confirmation.'),
  ('hamptons-greenhouse-corn-maze-marshfield','hamptons-greenhouse-products','greenhouse_products','Hamptons greenhouse plants & seasonal farm products','Hamptons is currently listed as a Marshfield greenhouse store and seasonal agritourism destination. Elm can treat it as a greenhouse-plant source; seasonal pumpkin availability belongs to the live-availability layer.',ARRAY['greenhouse plants','seasonal potted plants','seasonal pumpkins']::text[],'https://mofb.org/missouri-agritourism/','current_greenhouse_identity_seasonal_inventory_dynamic','Plant varieties and seasonal pumpkin availability require direct/current confirmation.'),
  ('hogan-farm-fordland','hogan-farm-meat-and-produce','local_food','Hogan Farm meat & seasonal produce','Hogan Farm is a Webster County farm-direct food source for beef, pork and lamb, with seasonal fresh produce and free-range chicken also reported in current farm-directory information.',ARRAY['beef','pork','lamb','seasonal fresh produce','free-range chicken']::text[],'https://missourigrownusa.com/members/8218','current_product_identity_harvest_inventory_dynamic','Cuts, harvest, chicken and produce availability require current farm confirmation.'),
  ('kneading-joy-marshfield','kneading-joy-bakery-and-food-truck','bakery_food','Kneading Joy bakery & food-truck menu','Kneading Joy is a current Marshfield bakery/food-truck source. Recent public business evidence supports fresh baked goods, breads, biscuits/cakes and hot sandwich-style food; the daily menu rotates.',ARRAY['fresh baked goods','bread','biscuits and cakes','hot sandwiches']::text[],'https://restaurantguru.com/Kneading-Joy-Marshfield-Missouri','current_business_menu_dynamic','Exact baked goods and hot-food menu require current provider/menu confirmation.'),
  ('old-earth-acres-sips-marshfield','old-earth-acres-sips-products','farm_beverage','Old Earth Acres & Old Earth Sips products','Old Earth Acres & Old Earth Sips combines a flower/herb farm with mobile beverage service. Current vendor information supports handcrafted teas, fresh lemonade and house syrups, with flower/herb products tied to the farm.',ARRAY['handcrafted tea','fresh-squeezed lemonade','homemade syrups','flowers and herbs']::text[],'https://marketspread.com/vendor/168048/old-earth-acres-old-earth-sips/','current_vendor_product_categories_inventory_dynamic','Exact drink flavors, flowers and herb products require current vendor confirmation.'),
  ('papa-nanas-marshfield','papa-nanas-resale-assortment','resale_retail','Papa and Nana''s resale assortment','Papa and Nana''s carries a rotating thrift/antique assortment. Current specialty-directory evidence supports clothing, home goods, kitchenware, decor, books, toys, small furniture and occasional collectibles.',ARRAY['clothing','home goods','kitchenware','home decor','books','toys','small furniture','collectibles']::text[],'https://www.antiqueace.com/explore/Papa-and-Nana-s/','current_resale_assortment_inventory_dynamic','Individual resale pieces rotate; confirm a specific item before a special trip.'),
  ('penny-pinchers-marshfield','penny-pinchers-grocery-assortment','discount_grocery','Penny Pincher''s discount grocery assortment','Penny Pincher''s is a current discount-grocery source with rotating stock. Recent public evidence supports groceries and pantry goods, dairy/milk, fresh produce, bulk foods, frozen foods, fish/seafood, pastries and cold drinks.',ARRAY['groceries and pantry goods','milk and dairy','fresh produce','bulk foods','frozen foods','fish and seafood','pastries','cold drinks']::text[],'https://www.loc8nearme.com/missouri/marshfield/penny-pinchers-discount-grocery/2392733/','current_discount_grocery_assortment_inventory_dynamic','Discount inventory rotates quickly; item-level stock requires a current check.'),
  ('polka-dot-pig-marshfield','polka-dot-pig-bbq-food','food_beverage','Polka Dot Pig BBQ food & catering','Polka Dot Pig BBQ is a current Southwest Missouri barbecue food-truck and catering provider. Elm can route barbecue and catered-meal searches here; the exact current truck menu and booking availability need provider confirmation.',ARRAY['barbecue','food-truck meals','catered meals']::text[],'https://www.bark.com/en/us/caterers/missouri/','current_food_truck_catering_menu_dynamic','Exact menu, truck location and catering availability require current provider confirmation.'),
  ('prickly-cactus-coffee-marshfield','prickly-cactus-coffee-menu','food_beverage','Prickly Cactus Coffee menu','Prickly Cactus Coffee has a current merchant ordering presence with hot and iced coffee, frappes, smoothies, loaded lemonades, hot chocolate, local baked goods and quick eats. Individual flavors and items change.',ARRAY['hot coffee','iced coffee','frappes','smoothies','loaded lemonades','hot chocolate','local baked goods','quick eats']::text[],'https://www.doordash.com/store/prickly-cactus-coffee-marshfield-39893521/','current_merchant_menu_inventory_dynamic','Use the current merchant menu/provider for exact item availability.'),
  ('relics-antique-mall','relics-antique-mall-assortment','antiques_collectibles','Relics Antique Mall assortment','Relics Antique Mall is a large multi-dealer antique mall with a broad rotating assortment. Its current official site supports antiques, collectibles, furniture, home decor and unique/gift items across independent booths.',ARRAY['antiques','collectibles','furniture','home decor','gifts and unique items']::text[],'https://relicsantiquemall.com/','current_multi_dealer_assortment_inventory_dynamic','Dealer inventory changes continuously; confirm a particular piece before a special trip.'),
  ('rost-ready-mix-marshfield','rost-icf-construction-products','construction_supply','Rost concrete / ICF construction products','Rost''s current official product presence centers insulated concrete-form construction systems for residential, commercial and specialty building work.',ARRAY['insulated concrete forms','ICF wall systems','concrete construction materials']::text[],'https://www.rosticf.com/','current_official_construction_product_line','Specific block/system availability and project supply timing require provider confirmation.'),
  ('sand-ridge-farm-marshfield','sand-ridge-farm-seasonal-products','farm_products','Sand Ridge Farm seasonal flowers & farm products','Sand Ridge Farm is a current flower farm with locally grown flowers and an orchard/berry component. Elm can route locally grown flower searches here; exact bouquet, flower and seasonal orchard/berry inventory changes with harvest.',ARRAY['locally grown cut flowers','bouquets','seasonal orchard and berry products']::text[],'https://www.956srfarm.com/','current_farm_product_identity_harvest_dynamic','Exact flower varieties, bouquet stock and orchard/berry harvest require current farm confirmation.'),
  ('seymour-farmers-market','seymour-farmers-market-product-supply','market_supply','Seymour Farmers Market local product supply','Seymour Farmers Market is a Webster County market node for seasonal produce and other local farm/vendor goods. Exact sellers and product mix change by market date.',ARRAY['seasonal produce','local farm products','vendor-market goods']::text[],'https://missourigrownusa.com/members/70727','current_market_identity_vendor_mix_dynamic','Current vendor attendance and exact products require market-day confirmation.'),
  ('big-family-farm-fordland','big-family-farm-products','farm_products','The Big Family Farm seasonal products','The Big Family Farm is a seasonal farm-direct destination associated with pumpkins and other farm crops including elderberry and apples. Harvest availability is seasonal.',ARRAY['pumpkins','elderberry','apples']::text[],'https://missourigrownusa.com/members/8269','seasonal_product_identity_live_harvest_needed','Exact 2026 crop/harvest availability requires current farm confirmation.'),
  ('treasure-barn-marshfield','treasure-barn-assortment','resale_retail','Treasure Barn antiques, collectibles & consignments','Treasure Barn is a current Marshfield flea-market/consignment source with rotating antiques, collectibles, furniture, household/useful items and auction/consignment goods.',ARRAY['antiques','collectibles','furniture','household goods','consignment and auction items']::text[],'https://www.antiqueace.com/explore/Treasure-Barn/','current_resale_and_consignment_inventory_dynamic','Inventory changes continuously and auction lots are time-bound; verify a particular item.'),
  ('unique-antiques-gift-shop-marshfield','unique-antiques-gifts-assortment','resale_retail','Unique Antiques & Gift Shop assortment','Unique Antiques & Gift Shop is a multi-vendor Marshfield store with antiques/vintage goods, gifts, home decor and other new/used merchandise. The co-located 417 Willow florist remains a separate provider identity.',ARRAY['antiques and vintage goods','gifts','home decor','multi-vendor new and used goods','handbags and accessories']::text[],'https://www.loc8nearme.com/missouri/marshfield/unique-antiques-and-gift-shop/9562062/','current_multi_vendor_assortment_inventory_dynamic','Vendor inventory changes continuously; do not collapse The 417 Willow floral inventory into this store record.'),
  ('white-house-farmstead-fordland','white-house-farmstead-food-and-farm-goods','local_food','White House Farmstead food & farm goods','White House Farmstead is a farm-direct source for raw honey, beeswax wraps and pasture-raised food products including poultry and pork. Exact stock and pickup timing change.',ARRAY['raw honey','beeswax wraps','pasture-raised poultry','pork']::text[],'https://missourigrownusa.com/members/8174','current_product_identity_farm_stock_dynamic','Exact cuts, poultry, honey sizes and current farm-pickup stock require current confirmation.')
), inserted AS (
  INSERT INTO local_intel.offerings
    (stable_key,entity_id,offering_type,title,description,audience,price,schedule,location,active,current_status,last_verified_at,metadata,updated_at)
  SELECT pr.offering_key,e.id,pr.offering_type,pr.title,pr.description,
         jsonb_build_object('public',true),'{}'::jsonb,
         jsonb_build_object('availability',pr.availability_note),
         jsonb_strip_nulls(jsonb_build_object('address',concat_ws(', ',e.address_line1,e.city,e.state,e.postal_code),'phone',e.phone)),
         true,pr.current_status,now(),
         jsonb_build_object(
           'source_url',pr.source_url,
           'source_basis','current public source linked to entity',
           'product_categories',to_jsonb(pr.product_categories),
           'inventory_rule',pr.availability_note,
           'product_visibility_pass','2026-08-18-p1-batch'
         ),
         now()
  FROM product_rows pr
  JOIN local_intel.entities e ON e.stable_key=pr.entity_key
  ON CONFLICT (stable_key) DO UPDATE SET
    entity_id=excluded.entity_id,
    offering_type=excluded.offering_type,
    title=excluded.title,
    description=excluded.description,
    audience=excluded.audience,
    price=excluded.price,
    schedule=excluded.schedule,
    location=excluded.location,
    active=true,
    current_status=excluded.current_status,
    last_verified_at=excluded.last_verified_at,
    metadata=excluded.metadata,
    updated_at=now()
  RETURNING id
)
SELECT count(*) FROM inserted;

-- Round Table already had a farmstand offering; enrich it rather than duplicate it.
UPDATE local_intel.offerings o
SET description='Farmstand with coffee, seasonal produce, artisan sourdough and flowers/bouquets. Product categories are current from the official farm site; item-level stock changes.',
    current_status='current_official_farmstand_assortment_dynamic',
    last_verified_at=now(),
    metadata=coalesce(o.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_url','https://www.roundtablecollective.org/',
      'product_categories',jsonb_build_array('coffee','seasonal produce','artisan sourdough','cut flowers and bouquets'),
      'inventory_rule','Farmstand assortment is current; exact produce, bread and flower inventory requires a current check.',
      'product_visibility_pass','2026-08-18-p1-batch'
    ),
    updated_at=now()
WHERE o.stable_key='round-table-farmstand';

-- Product visibility is durable knowledge. Resolve P1 product gaps only when the
-- entity now has an active structured product-category offering. This does NOT
-- resolve current-stock/live-availability questions.
UPDATE local_intel.question_gaps qg
SET status='resolved',
    metadata=coalesce(qg.metadata,'{}'::jsonb) || jsonb_build_object(
      'resolved_at',now(),
      'resolved_by','structured_product_assortment_batch_2026_08_18'
    ),
    updated_at=now()
WHERE qg.question_key='find_product'
  AND qg.priority=1
  AND qg.status='open'
  AND EXISTS (
    SELECT 1
    FROM local_intel.offerings o
    WHERE o.entity_id=qg.entity_id
      AND o.active=true
      AND o.metadata ? 'product_categories'
  );
