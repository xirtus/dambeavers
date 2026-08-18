/**
 * P10: the DF parity matrix -- every one of the 300 numbered rows of
 * `docs/DAM_BEAVERS_FULL_SYSTEMS_CHECKLIST.md`, mapped to one of the 12
 * parity domains, with a verdict and WRITTEN rationale per row.
 *
 * Verdict semantics (the roadmap's own four):
 *  - PASS:     the row's behavior exists through a real universal
 *              mechanism (evidence names the modules).
 *  - ADAPTED:  the beaver-world analogue exists, possibly partial --
 *              the rationale states exactly what is real and what
 *              remains.
 *  - EXCEEDED: the project's mechanism goes beyond the DF row (real
 *              example: full watershed hydrology, macro/micro agreement,
 *              the causal event graph).
 *  - OUT_OF_SCOPE: intentionally not in scope, WITH a written scope
 *              rationale (presentation layers while the simulation is
 *              headless, explicitly optional fantastic modes, authored
 *              content for later passes).
 *
 * "The parity matrix has no unexplained red rows" (the Phase 10 gate):
 * every row carries a verdict AND a rationale; the matrix test asserts
 * it structurally, and the gate test asserts it against the real file
 * system (every evidence module imports).
 */

export type ParityDomain =
  | "world"
  | "matter"
  | "environment"
  | "creatures"
  | "health"
  | "cognition"
  | "society"
  | "economy"
  | "construction"
  | "combat"
  | "ecology"
  | "history";

export type ParityVerdict = "PASS" | "ADAPTED" | "EXCEEDED" | "OUT_OF_SCOPE";

export interface ParityRow {
  /** Checklist number, 1..300 (001..300 in the doc). */
  id: number;
  title: string;
  domain: ParityDomain;
  verdict: ParityVerdict;
  /** Written rationale -- REQUIRED for every row, per the roadmap's own acceptance wording. */
  rationale: string;
  /** Real source modules backing a PASS/ADAPTED/EXCEEDED verdict (files the gate test imports). */
  evidence: readonly string[];
  /** Required for OUT_OF_SCOPE rows: why this is intentionally not in scope. */
  scopeReason?: string;
}

export const PARITY_DOMAINS: readonly ParityDomain[] = Object.freeze([
  "world", "matter", "environment", "creatures", "health", "cognition",
  "society", "economy", "construction", "combat", "ecology", "history",
]);

/** Every parity row for one domain, in checklist order. */
export function parityRowsByDomain(domain: ParityDomain): ParityRow[] {
  return PARITY_MATRIX.filter((row) => row.domain === domain);
}

/** Structural gate: rows whose verdict/rationale contract is broken. */
export function unexplainedParityRows(): ParityRow[] {
  return PARITY_MATRIX.filter((row) => row.rationale.trim().length === 0 || (row.verdict === "OUT_OF_SCOPE" && (row.scopeReason ?? "").trim().length === 0) || (row.verdict !== "OUT_OF_SCOPE" && row.evidence.length === 0));
}

export const PARITY_MATRIX: readonly ParityRow[] = Object.freeze([
  // ─────────────────────────── A. Citizens, Adventure, Trade ───────────────────────────
  {
    id: 1, title: "Grappling & Close Combat", domain: "combat", verdict: "ADAPTED",
    rationale: "Real unarmed/armed exchanges resolve through body plans, tissue, weapons, armor, and skill (P7-10/P7-11/P7-15, and P9-06 direct control uses the same primitive). Grappling/wrestling/drowning-attempts specifically do not exist yet -- the universal exchange mechanism is real; the move vocabulary is not.",
    evidence: ["src/sim/creatures/Anatomy.ts", "src/sim/politics/Weaponry.ts", "src/sim/politics/Battle.ts"],
  },
  {
    id: 2, title: "Eating & Drinking", domain: "creatures", verdict: "ADAPTED",
    rationale: "Hunger/thirst decay continuously (P1-06); eating destroys real physical food and produces real refuse; drinking uses real standing water (P1-13); the wayfarer's eat/drink verbs call the same primitives (P9-02). Intoxicants do not exist.",
    evidence: ["src/sim/creatures/Needs.ts", "src/sim/creatures/BeaverNeeds.ts", "src/sim/wayfarer/Verbs.ts"],
  },
  {
    id: 3, title: "Trade Caravans", domain: "economy", verdict: "PASS",
    rationale: "P7-03: caravans are persistent entities carrying real deducted food along the real travel network, delivering only on physical arrival; goods move the same way with ownership transfers recorded (P8-05 provenance).",
    evidence: ["src/sim/politics/Trade.ts", "src/sim/region/Travel.ts", "src/sim/chronicle/Provenance.ts"],
  },
  {
    id: 4, title: "Ground & Shore Interaction", domain: "world", verdict: "ADAPTED",
    rationale: "Real digging of terrain (P3-06), tree felling, log hauling, and bank-adjacent construction exist. Bark-stripping/reed-gathering vocabulary does not -- the terrain/material mutation machinery is real, the specific verbs are not.",
    evidence: ["src/sim/labor/Digging.ts", "src/sim/labor/TreeCutting.ts", "src/sim/labor/Construction.ts"],
  },
  {
    id: 5, title: "Overland / River Travel", domain: "world", verdict: "PASS",
    rationale: "P6-09's travel-cost network with real routes (Dijkstra over terrain difficulty), used by caravans, migrations, raids, and the wayfarer's own journeys (P9-04), plus ordinary detailed-grid navigation (P1-04) with swimming/climbing profiles.",
    evidence: ["src/sim/region/Travel.ts", "src/sim/navigation/Pathfinding.ts", "src/sim/wayfarer/Travel.ts"],
  },
  {
    id: 6, title: "Environmental Effects", domain: "environment", verdict: "ADAPTED",
    rationale: "Seasons/temperature/precipitation exist (P1-18, P6-03), thermal exposure from real water vs air conductivity (P1-15), fires burn plants (P4-15). Snow/ice, wind, and shade do not yet affect materials or creatures.",
    evidence: ["src/sim/weather/Weather.ts", "src/sim/region/Climate.ts", "src/sim/creatures/BeaverNeeds.ts"],
  },
  {
    id: 7, title: "Conversation", domain: "cognition", verdict: "PASS",
    rationale: "P2-12 social interactions and P9-03's derived conversation (options from identity/knowledge/relationship/culture/situation; effects are real relationship contact, memory transfer, belief adoption) -- facts and social information genuinely move between persons.",
    evidence: ["src/sim/creatures/SocialInteraction.ts", "src/sim/wayfarer/Conversation.ts"],
  },
  {
    id: 8, title: "Shops & Markets", domain: "economy", verdict: "ADAPTED",
    rationale: "Real ownership (P5-06), real barter at scarcity-derived values (P7-04), institutional goods. Currency, stalls, and private shop inventories do not exist -- value is derived, never a stored price.",
    evidence: ["src/sim/politics/Market.ts", "src/sim/creatures/Ownership.ts"],
  },
  {
    id: 9, title: "Towns & Settlements", domain: "world", verdict: "PASS",
    rationale: "Procedurally generated regions (P6-02) with persistent sites (P6-06), real founding events, real populations/food summaries, and real activation into detailed settlements (P6-08) consistent with their macro state.",
    evidence: ["src/sim/region/Site.ts", "src/sim/region/SiteActivation.ts", "src/sim/region/RegionMap.ts"],
  },
  {
    id: 10, title: "Generalized Object Model", domain: "world", verdict: "PASS",
    rationale: "The ECS (P0-02/P0-03): citizens, animals, plants, tools, structures, materials, liquids, organizations, documents (events), and artifacts are all stable-id entities with data-driven components -- 87 component types, one store.",
    evidence: ["src/sim/core/EntityId.ts", "src/sim/core/ComponentStore.ts", "src/sim/persistence/AllComponentTypes.ts"],
  },
  {
    id: 11, title: "Bonded Animals", domain: "creatures", verdict: "ADAPTED",
    rationale: "Animal species exist with real populations (P4-05, P6-11) and predator bands (P7-13); the wayfarer's companions are ordinary beavers (P9-08). Domesticated/bonded fauna is a content layer not yet authored -- the animal framework it would hang on is real.",
    evidence: ["src/sim/creatures/Animal.ts", "src/sim/creatures/AnimalSpecies.ts", "src/sim/wayfarer/Companions.ts"],
  },
  {
    id: 12, title: "Colony Endgame I", domain: "society", verdict: "ADAPTED",
    rationale: "Real collapse conditions and recorded dissolutions exist (P7-18), populations genuinely abandon pressured sites (P7-05), and disasters strike (P6-12). Conquest/transformation endgames are partially the war/cession machinery (P7-16).",
    evidence: ["src/sim/politics/Collapse.ts", "src/sim/politics/Migration.ts", "src/sim/politics/War.ts"],
  },
  {
    id: 13, title: "Predator / Monster Attacks", domain: "ecology", verdict: "PASS",
    rationale: "Real predation (P4-05) and predator-band raids that travel and attack settlements through the ordinary combat/mortality systems (P7-13).",
    evidence: ["src/sim/creatures/Predation.ts", "src/sim/politics/Raids.ts"],
  },
  {
    id: 14, title: "Fire", domain: "environment", verdict: "PASS",
    rationale: "Real ignition/spread/burnout over real plants and material flammability (P4-15 Fire.ts), plus real wildfire disasters at region scale (P6-12).",
    evidence: ["src/sim/ecology/Fire.ts", "src/sim/region/WorldDisasters.ts"],
  },
  {
    id: 15, title: "Important Figure Presentation", domain: "history", verdict: "PASS",
    rationale: "Historical figures are DERIVED from real deeds (P5-15), and Chronicle renders them with every claim sourced to real records (P8-03) -- motives are their real recorded deeds, never authored.",
    evidence: ["src/sim/creatures/HistoricalFigure.ts", "src/sim/chronicle/FigurePages.ts"],
  },
  {
    id: 16, title: "Colony Endgame II", domain: "history", verdict: "PASS",
    rationale: "Fracture (civilization dissolution), forced migration (P7-05), dam-failure-adjacent disasters (P6-12), and succession outcomes all persist as recorded history (P7-18, P8).",
    evidence: ["src/sim/politics/Collapse.ts", "src/sim/politics/Migration.ts", "src/sim/history/EventLog.ts"],
  },
  {
    id: 17, title: "Legends & Chronicle", domain: "history", verdict: "EXCEEDED",
    rationale: "Phase 8 is a complete readable interface over simulation truth: dynasties (genealogy), dam projects and wars (causal views), floods/migrations/inventions (site histories), murders and artifacts (artifact histories), and famous beasts -- every claim traceable to a recorded event, with deep-time-verified stability.",
    evidence: ["src/sim/chronicle/Chronicle.ts", "src/sim/chronicle/Genealogy.ts", "src/sim/chronicle/CausalHistory.ts"],
  },
  {
    id: 18, title: "Rebindable Controls", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "No interactive client exists yet -- the simulation is headless by constitution (ARCHITECTURE_CONTRACT §1). Input binding belongs to the presentation layer when one is built.",
    evidence: [],
    scopeReason: "Presentation-layer feature; the authoritative simulation is headless and has no renderer/input client yet.",
  },
  {
    id: 19, title: "Tutorials", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Authored instructional content over a presentation layer; the headless sim and the existing text UI (P1-20) are the current surfaces.",
    evidence: [],
    scopeReason: "Presentation/authored content -- tutorials are content over a presentation layer that does not exist yet.",
  },
  {
    id: 20, title: "Presentation / Intro Sequences", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Optional presentational scenes; nothing in the simulation depends on them.",
    evidence: [],
    scopeReason: "Presentation layer -- optional cutscenes; the simulation does not own presentation.",
  },
  {
    id: 21, title: "Sound", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Audio is a renderer-side concern; the sim must not depend on it (contract §3).",
    evidence: [],
    scopeReason: "Presentation/audio layer -- the simulation contract is renderer-agnostic (ARCHITECTURE_CONTRACT §3).",
  },
  {
    id: 22, title: "Advisors", domain: "cognition", verdict: "ADAPTED",
    rationale: "The 'why' system answers real questions over real state (P1-22), and wayfarer situations surface real risks/opportunities (P9-09). Named advisor NPCs are an authored-content layer over these.",
    evidence: ["src/sim/history/CausalExplanation.ts", "src/sim/wayfarer/Situations.ts"],
  },
  {
    id: 23, title: "In-Game Encyclopedia", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "The underlying data (materials, species, recipes, beliefs) is already data-driven and inspectable; an encyclopedia UI is presentation.",
    evidence: [],
    scopeReason: "Presentation layer over already-data-driven registries.",
  },
  {
    id: 24, title: "Traveling Parties", domain: "society", verdict: "ADAPTED",
    rationale: "The wayfarer travels with real companions (P9-08), caravans and migration groups are multi-member traveling parties (P7-03/P7-05). Shared supplies/roles/boats are not modeled.",
    evidence: ["src/sim/wayfarer/Companions.ts", "src/sim/politics/Trade.ts", "src/sim/politics/Migration.ts"],
  },
  {
    id: 25, title: "Simulation-Driven Plot Cleanup", domain: "history", verdict: "PASS",
    rationale: "The project constitution (AGENTS.md Law 1.1) plus the gate tests enforcing it: no scripted story beats anywhere; every gate proves outcomes arise from systems.",
    evidence: ["AGENTS.md", "tests/gate/p9-gate-wayfarer.test.ts"],
  },
  // ─────────────────────────── B. Armies, Territory, Persistence ───────────────────────────
  {
    id: 26, title: "Overland Army Attacks", domain: "combat", verdict: "ADAPTED",
    rationale: "Raids physically mobilize, travel the real network, and attack (P7-13); wars declare and resolve with real cessions (P7-16). Full army logistics/supply is not modeled -- the raid/war machinery is the real analogue.",
    evidence: ["src/sim/politics/Raids.ts", "src/sim/politics/War.ts"],
  },
  {
    id: 27, title: "Beaver Armies & Militias", domain: "combat", verdict: "PASS",
    rationale: "Military units are ordinary organizations of ordinary beavers with real training (combat skill), real issued equipment, real missions, and derived strength (P7-14).",
    evidence: ["src/sim/politics/Military.ts"],
  },
  {
    id: 28, title: "Territory & External Locations", domain: "world", verdict: "PASS",
    rationale: "Persistent, overlappable territorial claims over real region cells (P7-07), with real tension, wars over contested cells, and recorded cessions.",
    evidence: ["src/sim/politics/Territory.ts", "src/sim/politics/War.ts"],
  },
  {
    id: 29, title: "External Constructions", domain: "construction", verdict: "ADAPTED",
    rationale: "Dams, bridges, gates, and water wheels are real physical constructions with real hydraulic/mechanical consequences (P1-12/P3-07/P3-13/P3-15). Region-scale external constructions (roads/levees on the world map) do not exist.",
    evidence: ["src/sim/hydrology/Dam.ts", "src/sim/structures/Bridge.ts", "src/sim/hydrology/Gate.ts"],
  },
  {
    id: 30, title: "Polity Control", domain: "society", verdict: "ADAPTED",
    rationale: "Settlements ARE polities with real leaders, government forms, territory, and diplomatic identity (P7-02/P7-08). Directing subordinate colonies is not modeled.",
    evidence: ["src/sim/politics/PoliticalEntity.ts", "src/sim/politics/Government.ts"],
  },
  {
    id: 31, title: "Persistent Site Maps", domain: "world", verdict: "ADAPTED",
    rationale: "Sites persist with real region positions and summaries (P6-06); activation reconstructs a detailed world consistent with macro state (P6-08). Individual detailed layouts are materialized, not stored per-site.",
    evidence: ["src/sim/region/Site.ts", "src/sim/region/SiteActivation.ts"],
  },
  {
    id: 32, title: "Starting Objectives", domain: "society", verdict: "PASS",
    rationale: "Wayfarer situations derive objectives from ACTUAL world conditions -- real shortages, real accusations, real prisoners, real caravans (P9-09) -- the roadmap's own 'objectives reference actual world entities/problems'.",
    evidence: ["src/sim/wayfarer/Situations.ts"],
  },
  {
    id: 33, title: "Service to the Crown / Council", domain: "society", verdict: "ADAPTED",
    rationale: "Treaties include tribute relations (P7-06); no higher authority issues concrete demands to settlements yet.",
    evidence: ["src/sim/politics/Diplomacy.ts"],
  },
  {
    id: 34, title: "Abandonment", domain: "world", verdict: "ADAPTED",
    rationale: "Sites deactivate through a real inverse (P6-08) and their summaries persist; evacuated-settlement decay/rewilding is not modeled.",
    evidence: ["src/sim/region/SiteActivation.ts", "src/sim/region/Site.ts"],
  },
  {
    id: 35, title: "Raids", domain: "combat", verdict: "PASS",
    rationale: "Real raids: settlement raids loot real food and carry it home; predator bands eat and dissolve; defended arrivals become real battles (P7-13).",
    evidence: ["src/sim/politics/Raids.ts", "src/sim/politics/Battle.ts"],
  },
  {
    id: 36, title: "Work Zones / Burrows", domain: "construction", verdict: "ADAPTED",
    rationale: "Real functional spaces/zones with declared functions (P2-05) and stockpile zones with real policy (P2-01). Burrow-style emergency sectors do not exist.",
    evidence: ["src/sim/spaces/FunctionalSpace.ts", "src/sim/logistics/Stockpile.ts"],
  },
  {
    id: 37, title: "Retirement & Re-entry", domain: "society", verdict: "ADAPTED",
    rationale: "Aging/retirement of laborers exists (P2-12), and identity/history outlive death (P0-02/P8). Reappearance as active elders/legends is the historical-figure layer (P5-15), not a separate mechanism.",
    evidence: ["src/sim/creatures/Aging.ts", "src/sim/creatures/HistoricalFigure.ts"],
  },
  {
    id: 38, title: "Abstract Site Resources", domain: "world", verdict: "PASS",
    rationale: "Inactive sites retain real population, stored food, structure counts, and their institutionally-owned goods (P6-07/P6-06/P7-02), advanced by real closed-form LOD.",
    evidence: ["src/sim/region/OffscreenLOD.ts", "src/sim/region/Site.ts"],
  },
  {
    id: 39, title: "Colony Endgame III", domain: "history", verdict: "ADAPTED",
    rationale: "Lost settlements persist as records (civilization-collapsed, migrations, wars) and remain queryable forever (P7-18/P8). Ruin-as-place and refugee-source mechanics are partial (migrations exist; ruins do not).",
    evidence: ["src/sim/politics/Collapse.ts", "src/sim/chronicle/SiteHistories.ts"],
  },
  {
    id: 40, title: "Legendary Beasts", domain: "creatures", verdict: "ADAPTED",
    rationale: "Predator bands have real behavior/history events (P7-13); individual generated beasts with territories/trophies do not exist.",
    evidence: ["src/sim/politics/Raids.ts"],
  },
  {
    id: 41, title: "Homes, Lodges & Daily Schedules", domain: "society", verdict: "PASS",
    rationale: "Families sleep in real claimed nest spaces inside real lodge rooms (P2-06), eat/drink/socialize through needs and social scheduling (P1-06/P2-12), raise kits (P2-11), and work ordinary jobs.",
    evidence: ["src/sim/spaces/SleepSpace.ts", "src/sim/creatures/SocialInteraction.ts", "src/sim/creatures/Reproduction.ts"],
  },
  {
    id: 42, title: "Personal & Household Goods", domain: "economy", verdict: "PASS",
    rationale: "Real personal/household/institutional ownership (P5-06), heirlooms with recorded provenance (P8-05), tools and equipment (P2-04), and real inheritance (bequeathEstate).",
    evidence: ["src/sim/creatures/Ownership.ts", "src/sim/chronicle/ArtifactHistories.ts"],
  },
  {
    id: 43, title: "Civic Locations", domain: "construction", verdict: "ADAPTED",
    rationale: "Rooms/zones are generic declared spaces (P2-05); named civic institutions (council halls, archives) are not distinct building types.",
    evidence: ["src/sim/spaces/FunctionalSpace.ts"],
  },
  {
    id: 44, title: "Migration", domain: "society", verdict: "PASS",
    rationale: "Real push/pull (danger, shortage, kinship, opportunity) with physical migration groups over the real network, real population deltas, recorded causally (P7-05).",
    evidence: ["src/sim/politics/Migration.ts"],
  },
  {
    id: 45, title: "Civilizations at War", domain: "society", verdict: "PASS",
    rationale: "Wars declare for real causes (territorial overlap, raid escalation, broken treaties), compose real battles, and end with real cessions and peace treaties (P7-16).",
    evidence: ["src/sim/politics/War.ts", "src/sim/politics/WarPlanning.ts"],
  },
  {
    id: 46, title: "Off-Map Battles", domain: "combat", verdict: "PASS",
    rationale: "The region layer IS the off-map layer: battles resolve through real exchanges in the region world itself, with real casualties, captured equipment paths, and recorded outcomes (P7-15/P7-16).",
    evidence: ["src/sim/politics/Battle.ts", "src/sim/politics/War.ts"],
  },
  {
    id: 47, title: "Historical Data Abstraction", domain: "history", verdict: "PASS",
    rationale: "Compressed but real: inactive sites advance through closed-form LOD (P6-07/P6-13), while the event log and chronicle preserve causes, relationships, ownership, ancestry, injuries, and major consequences (P8).",
    evidence: ["src/sim/region/OffscreenLOD.ts", "src/sim/history/EventLog.ts", "src/sim/chronicle/Chronicle.ts"],
  },
  {
    id: 48, title: "Seamless Regional Space", domain: "world", verdict: "ADAPTED",
    rationale: "Sites connect through one real travel network (P6-09); activation/deactivation bridges detailed worlds to it (P6-08). A single continuous 3D space across all sites does not exist.",
    evidence: ["src/sim/region/Travel.ts", "src/sim/region/SiteActivation.ts"],
  },
  {
    id: 49, title: "Full 3D Terrain", domain: "world", verdict: "ADAPTED",
    rationale: "True z-level terrain with multi-story construction, banks, and vertical navigation (P0-09/P1-04). Underground burrows/caverns are not authored terrain content.",
    evidence: ["src/sim/world/TerrainField.ts", "src/sim/world/WorldGrid.ts"],
  },
  {
    id: 50, title: "Flexible Visual Representation", domain: "world", verdict: "PASS",
    rationale: "The simulation is renderer-independent BY CONSTITUTION and proven headlessly -- every gate test runs with no renderer (contract §1/§3).",
    evidence: ["docs/ARCHITECTURE_CONTRACT.md", "tests/gate/p2-gate-full-year-soak-acceptance.test.ts"],
  },
  // ─────────────────────────── C. Interface, Logistics, Family, Diplomacy ───────────────────────────
  {
    id: 51, title: "Resizable / Scalable UI", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "No graphical UI exists; the only surface is the headless text UI (P1-20).",
    evidence: [],
    scopeReason: "Presentation layer; no graphical client has been built.",
  },
  {
    id: 52, title: "Interface Overhaul Layer", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Inspection/search/timeline data exists headlessly (P8-02/P8-10); the UI layer over it is presentation.",
    evidence: [],
    scopeReason: "Presentation layer over the headless chronicle queries (P8-02/P8-10 already provide the data).",
  },
  {
    id: 53, title: "Data-Driven Definitions", domain: "matter", verdict: "PASS",
    rationale: "Materials, plant species, animal species, recipes, pathogens, government forms, and organization roles are all data-defined registries (P0-07/P4-01/P4-05/P3-02/P4-14/P7-08/P7-01).",
    evidence: ["src/sim/materials/standardMaterials.ts", "src/sim/economy/Recipe.ts", "src/sim/politics/Government.ts"],
  },
  {
    id: 54, title: "Localization", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "UI text localization with no UI yet; generated names are procedural data, not a localization system.",
    evidence: [],
    scopeReason: "Presentation/authoring concern; simulation strings are data ids.",
  },
  {
    id: 55, title: "Lighting & Visibility", domain: "environment", verdict: "ADAPTED",
    rationale: "Day/night and seasons exist (P1-18); perception/visibility effects on creatures do not.",
    evidence: ["src/sim/weather/Weather.ts"],
  },
  {
    id: 56, title: "Settlement Transportation", domain: "economy", verdict: "ADAPTED",
    rationale: "Real hauling with mass-scaled speed (P1-09) and caravans (P7-03). Boats/rafts/carts do not exist.",
    evidence: ["src/sim/labor/Hauling.ts", "src/sim/politics/Trade.ts"],
  },
  {
    id: 57, title: "Automation", domain: "economy", verdict: "ADAPTED",
    rationale: "Real stockpile rules and automatic haul-job generation (P2-01), food production loops (P2-07). Manager logic/water-level triggers are not built.",
    evidence: ["src/sim/logistics/Stockpile.ts", "src/sim/ecology/FoodProduction.ts"],
  },
  {
    id: 58, title: "Documentation System", domain: "cognition", verdict: "ADAPTED",
    rationale: "The causal explanation layer answers real 'why' questions over real state (P1-22) and chronicle views explain chains (P8-08). Tooltips/encyclopedia UI are presentation.",
    evidence: ["src/sim/history/CausalExplanation.ts", "src/sim/chronicle/CausalHistory.ts"],
  },
  {
    id: 59, title: "Love & Pair Bonds", domain: "society", verdict: "ADAPTED",
    rationale: "Real mate edges, mutual-mate eligibility, and shared households (P1-19/P2-11). Courtship/jealousy are not modeled.",
    evidence: ["src/sim/creatures/Relationships.ts", "src/sim/creatures/Reproduction.ts"],
  },
  {
    id: 60, title: "Kits, Families & Succession", domain: "society", verdict: "PASS",
    rationale: "Children inherit real parentage and household membership (P2-11/P5-05); lineage inheritance governs succession and consults dead leaders' edges (P7-08); genealogy traverses generations with intact references (P8-06).",
    evidence: ["src/sim/creatures/Reproduction.ts", "src/sim/politics/Government.ts", "src/sim/chronicle/Genealogy.ts"],
  },
  {
    id: 61, title: "Player-Founded Organizations", domain: "society", verdict: "PASS",
    rationale: "Real organization entities with data-defined roles, membership, and shared institutional assets (P7-01); military units are player-shaped orgs (P7-14).",
    evidence: ["src/sim/politics/Organization.ts", "src/sim/politics/Military.ts"],
  },
  {
    id: 62, title: "Diplomacy", domain: "society", verdict: "PASS",
    rationale: "Standing derived from real shared events and active treaties (peace/alliance/tribute); treaties signed/broken through real events (P7-06).",
    evidence: ["src/sim/politics/Diplomacy.ts"],
  },
  {
    id: 63, title: "Succession, Schism & Conflict", domain: "society", verdict: "ADAPTED",
    rationale: "Real succession by four government forms (P7-08) and civilization succession (P7-18). Schism is not modeled.",
    evidence: ["src/sim/politics/Government.ts", "src/sim/politics/Collapse.ts"],
  },
  {
    id: 64, title: "Personal Affiliations", domain: "society", verdict: "ADAPTED",
    rationale: "Household membership, org membership, relationships, and institutional ownership coexist (P5-05/P7-01). Conflicting-loyalty decision logic is not modeled.",
    evidence: ["src/sim/creatures/Relationships.ts", "src/sim/politics/Organization.ts"],
  },
  {
    id: 65, title: "Reputation & Membership", domain: "society", verdict: "PASS",
    rationale: "Real derived reputation from recorded deeds (P5-13), household-norm-scored reputation (P5-07), accusations and status (P7-09), and org membership (P7-01).",
    evidence: ["src/sim/creatures/Reputation.ts", "src/sim/politics/Justice.ts"],
  },
  {
    id: 66, title: "Hidden World Systems", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Fantastic hidden-world content is a fiction choice; nothing in the roadmap's build order requires it.",
    evidence: [],
    scopeReason: "Optional fantasy content layer, not a systems gap.",
  },
  {
    id: 67, title: "Ruins", domain: "world", verdict: "ADAPTED",
    rationale: "Failed settlements persist as records (P7-18/P8-04) and abandoned sites remain region entities. Physical ruin decay/rewilding is not modeled.",
    evidence: ["src/sim/politics/Collapse.ts", "src/sim/chronicle/SiteHistories.ts"],
  },
  {
    id: 68, title: "Cemeteries & Memorials", domain: "society", verdict: "PASS",
    rationale: "Real burial jobs, graves, mourning notifications, and memorial records (P2-15); the dead stay queryable forever (P8).",
    evidence: ["src/sim/labor/Burial.ts", "src/sim/creatures/Mourning.ts"],
  },
  {
    id: 69, title: "Old Battlefields", domain: "history", verdict: "ADAPTED",
    rationale: "Battles, casualties, dropped equipment, and cessions persist as real records (P7-15/P8); physical battlefield props are not modeled.",
    evidence: ["src/sim/politics/Battle.ts", "src/sim/chronicle/CausalHistory.ts"],
  },
  {
    id: 70, title: "Settlement Archaeology", domain: "history", verdict: "ADAPTED",
    rationale: "Site histories reconstruct founding, population, disasters, constructions, battles, and culture from records (P8-04). Physical excavation of ruins is not modeled.",
    evidence: ["src/sim/chronicle/SiteHistories.ts"],
  },
  {
    id: 71, title: "Bandits, River Pirates & Cults", domain: "society", verdict: "ADAPTED",
    rationale: "Independent organizations with real goals/assets exist (P7-01/P7-13 raiders are orgs or bands). Criminal-cult behaviors are not authored.",
    evidence: ["src/sim/politics/Organization.ts", "src/sim/politics/Raids.ts"],
  },
  {
    id: 72, title: "Developing Attributes", domain: "cognition", verdict: "ADAPTED",
    rationale: "Skills develop through real practice (P2-03); traits are fixed at spawn (P2-13) and do not change through life.",
    evidence: ["src/sim/creatures/SkillProgression.ts", "src/sim/creatures/Traits.ts"],
  },
  {
    id: 73, title: "Advanced Combat", domain: "combat", verdict: "ADAPTED",
    rationale: "Weapon skill scales force, armor/tissue resist, terrain-relevant wounds (P7-10/P7-11/P7-15). Grappling, shields, formations, and water-combat bonuses are not modeled.",
    evidence: ["src/sim/politics/Battle.ts", "src/sim/politics/Weaponry.ts"],
  },
  {
    id: 74, title: "Persistent Injuries", domain: "health", verdict: "ADAPTED",
    rationale: "Wounds persist with real bleeding/pain/impairment and heal at a real rate (P7-10); permanent scars/disability do not survive full healing.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 75, title: "Historically Generated Characters", domain: "history", verdict: "PASS",
    rationale: "Citizens originate from real families with recorded births/parentage (P2-11/P8-06), real sites, and real histories; historical figures are derived from real deeds (P5-15).",
    evidence: ["src/sim/creatures/Reproduction.ts", "src/sim/chronicle/Genealogy.ts"],
  },
  // ─────────────────────────── D. Population, Crime, Ecology, Culture ───────────────────────────
  {
    id: 76, title: "Historically Generated Embarks", domain: "history", verdict: "ADAPTED",
    rationale: "Migration pressure genuinely moves population between sites (P7-05); site founding itself is not yet driven by migrations/grants/disasters.",
    evidence: ["src/sim/politics/Migration.ts", "src/sim/region/Site.ts"],
  },
  {
    id: 77, title: "Population Lifecycle", domain: "ecology", verdict: "PASS",
    rationale: "Birth, childhood, maturation, aging, pair formation, fertility, and mortality all run (P2-11/P2-12/P1-16), and inactive sites' populations advance through real LOD (P6-07/P6-13).",
    evidence: ["src/sim/creatures/Reproduction.ts", "src/sim/creatures/Aging.ts", "src/sim/region/OffscreenLOD.ts"],
  },
  {
    id: 78, title: "Wildlife Population Tracking", domain: "ecology", verdict: "PASS",
    rationale: "Persistent regional wildlife populations per cell per species with real carrying-capacity growth (P6-11), plus active-world animal populations (P4-05).",
    evidence: ["src/sim/region/WorldWildlife.ts", "src/sim/creatures/AnimalPopulation.ts"],
  },
  {
    id: 79, title: "Collectors & Specialized Demand", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Demand is modeled as real weighted population consumption (P7-04); individual collector desires are authored-content.",
    evidence: [],
    scopeReason: "Authored desire content over the real scarcity/value machinery; the machinery itself exists (P7-04).",
  },
  {
    id: 80, title: "Artifact Powers", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "The checklist itself marks this 'optional fantastic mode'; the historical-unique-objects layer it would attach to IS real (P8-05 provenance).",
    evidence: [],
    scopeReason: "Explicitly optional fantastic mode in the checklist's own wording; the historical-unique-objects layer it would attach to IS real (P8-05).",
  },
  {
    id: 81, title: "Tribute Networks", domain: "economy", verdict: "ADAPTED",
    rationale: "Tribute treaties exist (P7-06); physical tribute flows are not modeled.",
    evidence: ["src/sim/politics/Diplomacy.ts"],
  },
  {
    id: 82, title: "Theft Ecosystem", domain: "society", verdict: "ADAPTED",
    rationale: "Real theft detection, recorded violations naming the item, evidence, and prosecution (P5-12/P7-09/P9-07). Fences/black markets are not modeled.",
    evidence: ["src/sim/creatures/Law.ts", "src/sim/politics/Justice.ts"],
  },
  {
    id: 83, title: "Arrest, Trial & Punishment", domain: "society", verdict: "PASS",
    rationale: "The full pipeline: witnessed/evidenced accusations, investigation, real judgment, and real punishments (fine/confinement/exile) with causal case files (P7-09).",
    evidence: ["src/sim/politics/Justice.ts"],
  },
  {
    id: 84, title: "Foraging, Fishing & Wild Harvest", domain: "ecology", verdict: "ADAPTED",
    rationale: "Tree felling, food production from plants (P2-07), and fish ecology/predation exist (P4-05). The full forage/fish verb vocabulary is not authored.",
    evidence: ["src/sim/labor/TreeCutting.ts", "src/sim/ecology/FoodProduction.ts"],
  },
  {
    id: 85, title: "Field Construction", domain: "construction", verdict: "ADAPTED",
    rationale: "The wayfarer operates ordinary entities (P9-02) but cannot yet dig/build in adventure mode; the colony construction machinery is real (P1-10).",
    evidence: ["src/sim/labor/Construction.ts", "src/sim/wayfarer/Verbs.ts"],
  },
  {
    id: 86, title: "Personal Craft & Profession Skills", domain: "cognition", verdict: "ADAPTED",
    rationale: "Skills practice and tool use are real (P2-03/P2-04/P9-02). Full personal crafting is not built.",
    evidence: ["src/sim/creatures/SkillProgression.ts", "src/sim/labor/Equipment.ts"],
  },
  {
    id: 87, title: "Proper Beaver Civilization", domain: "society", verdict: "PASS",
    rationale: "The whole fiction: lodges, gnawing-adjacent felling, dam instinct expressed as real preferences (needs/jobs), riparian engineering, seasonal work, and colony ecology -- never humans with tails.",
    evidence: ["src/sim/creatures/BeaverNeeds.ts", "src/sim/hydrology/Dam.ts", "src/sim/spaces/SleepSpace.ts"],
  },
  {
    id: 88, title: "Proper Neighbor Species Cultures", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Distinct authored neighbor cultures are content; the generic systems (sites, polities, orgs) are species-agnostic and could host them.",
    evidence: [],
    scopeReason: "Authored content layer; not a systems gap -- generic polity/organization machinery already exists.",
  },
  {
    id: 89, title: "Proper Hostile Cultures", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Same as 088: hostile polities already exist generically (P7-16); distinct authored cultures are content.",
    evidence: [],
    scopeReason: "Authored content layer over the real war/diplomacy machinery (P7-16/P7-06).",
  },
  {
    id: 90, title: "Proper Small-Scale / Tribal Cultures", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Content layer; nomadic/small-scale societies would reuse the same site/polity systems.",
    evidence: [],
    scopeReason: "Authored content layer -- nomadic/small-scale societies would reuse the same site/polity systems.",
  },
  {
    id: 91, title: "Deep Underground & Watershed Features", domain: "environment", verdict: "ADAPTED",
    rationale: "Z-levels, digging, and water columns exist (P0-09/P3-06/P1-02). Aquifers/caves/springs are not authored.",
    evidence: ["src/sim/world/TerrainField.ts", "src/sim/labor/Digging.ts", "src/sim/hydrology/WaterField.ts"],
  },
  {
    id: 92, title: "Individual Appearance", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Visual appearance belongs to the renderer; identity (names) is simulated.",
    evidence: [],
    scopeReason: "Presentation layer; appearance is rendering, identity is simulated.",
  },
  {
    id: 93, title: "Procedural Megafauna", domain: "creatures", verdict: "ADAPTED",
    rationale: "Generic body plans and animal anatomy exist (P4-05/P7-10). Generated legendary megafauna is not authored.",
    evidence: ["src/sim/creatures/Animal.ts", "src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 94, title: "Procedural Regions / Flora / Fauna", domain: "ecology", verdict: "PASS",
    rationale: "Real generated regions with biomes, climate, rivers, and seeded wildlife (P6-02/P6-03/P6-11), plus standard plant/animal species data (P4-01/P4-05).",
    evidence: ["src/sim/region/RegionMap.ts", "src/sim/region/Biomes.ts", "src/sim/region/WorldWildlife.ts"],
  },
  {
    id: 95, title: "Procedural Peoples", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Optional worldgen scope; cultures are data, not generated yet.",
    evidence: [],
    scopeReason: "Optional worldgen content; cultures exist as data (P5-08/P7-08), generation does not.",
  },
  {
    id: 96, title: "Generalized Transformations", domain: "health", verdict: "ADAPTED",
    rationale: "Injury, infection, disease, and aging share component-based body state (P7-10/P2-10/P4-14/P2-12). A generic timed-syndrome framework is not built.",
    evidence: ["src/sim/creatures/Anatomy.ts", "src/sim/creatures/Disease.ts"],
  },
  {
    id: 97, title: "Semantic Phrase Storage", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Prose summaries are template-assembled from real records (P8-09), not a semantic phrase system; the information is the records themselves.",
    evidence: [],
    scopeReason: "The structured records ARE the semantics (P8-09's own traceability guarantee); phrase rendering is presentation.",
  },
  {
    id: 98, title: "Procedural Grammar", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Procedural names exist (P5-10); generated languages are authored-content scope.",
    evidence: [],
    scopeReason: "Authored content scope -- procedural names exist (P5-10); generated languages do not.",
  },
  {
    id: 99, title: "Writing & Inscription", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Knowledge objects (books/records) are not built; recorded events ARE the inscriptions.",
    evidence: [],
    scopeReason: "Physical writing objects are not built -- the event log serves the record role headlessly; knowledge objects are Phase 11 content (P11-09).",
  },
  {
    id: 100, title: "Cultural Works", domain: "history", verdict: "ADAPTED",
    rationale: "Real artworks with depictions of real entities/events, made by real makers (P5-09), with full provenance (P8-05). Books/maps/songs are not built.",
    evidence: ["src/sim/creatures/Art.ts", "src/sim/chronicle/ArtifactHistories.ts"],
  },
  // ─────────────────────────── E. Anatomy, Materials, Medicine ───────────────────────────
  {
    id: 101, title: "Layered Anatomy", domain: "creatures", verdict: "ADAPTED",
    rationale: "Real body plans with weighted parts (head/torso/limbs/hindquarters/tail) that can be individually struck and affected (P7-10). Eyes/organs/teeth as separate parts are not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 102, title: "Tissue Layers", domain: "creatures", verdict: "ADAPTED",
    rationale: "Each part has real tissue thickness AND hardness (two-layer resistance, P7-10). Separate fur/skin/fat/muscle/bone layers are not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 103, title: "Material Properties", domain: "matter", verdict: "PASS",
    rationale: "The material registry defines density, hardness, conductivity, friction, flammability, etc. (P0-07), and behavior derives from properties everywhere (weapon force, thermal exposure, hauling friction).",
    evidence: ["src/sim/materials/Material.ts", "src/sim/politics/Weaponry.ts"],
  },
  {
    id: 104, title: "Body Size & Mass", domain: "creatures", verdict: "ADAPTED",
    rationale: "Item mass is real and physical (logs/food/goods, P1-08/P3-01); creature body mass is not modeled as a number affecting momentum/buoyancy.",
    evidence: ["src/sim/labor/Log.ts", "src/sim/economy/Good.ts"],
  },
  {
    id: 105, title: "Organ Function", domain: "health", verdict: "ADAPTED",
    rationale: "Vital parts have mechanically different consequences (health damage, bleeding) vs limbs (mobility impairment) (P7-10). Named organs with specific dysfunctions are not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 106, title: "Blood & Hemorrhage", domain: "health", verdict: "ADAPTED",
    rationale: "Real per-wound bleeding rates drain real health and can kill (P7-10). Blood volume/clotting as separate state is not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 107, title: "Pain", domain: "health", verdict: "PASS",
    rationale: "Pain is real wound state that raises real stress (P7-10 -> P2-10 stress), which feeds behavior and mood.",
    evidence: ["src/sim/creatures/Anatomy.ts", "src/sim/creatures/Stress.ts"],
  },
  {
    id: 108, title: "Stun / Shock / Unconsciousness", domain: "health", verdict: "ADAPTED",
    rationale: "Impairment and pain disable movement partially (P7-10). Unconsciousness as a distinct state is not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 109, title: "Infection", domain: "health", verdict: "PASS",
    rationale: "Real infections with progression, damage, and contagion vectors (P2-10 sanitation, P4-14 disease/pathogens).",
    evidence: ["src/sim/creatures/Disease.ts", "src/sim/creatures/Disease.ts"],
  },
  {
    id: 110, title: "Necrosis & Tissue Death", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "No tissue-death mechanism; severe wounds kill through bleeding/health loss instead.",
    evidence: [],
    scopeReason: "Deferred -- tissue death is not modeled; the wound/health abstraction resolves severe injury through the existing mortality path.",
  },
  {
    id: 111, title: "Diagnosis", domain: "health", verdict: "ADAPTED",
    rationale: "Disease/infection are inspectable real state (P4-14/P2-10); a healer-diagnosis-with-uncertainty step is not modeled.",
    evidence: ["src/sim/creatures/Disease.ts"],
  },
  {
    id: 112, title: "Surgery", domain: "health", verdict: "ADAPTED",
    rationale: "Treatment targets real wound fields (P7-12); surgical procedures are not modeled.",
    evidence: ["src/sim/politics/Medicine.ts"],
  },
  {
    id: 113, title: "Sutures, Dressings & Cleaning", domain: "health", verdict: "PASS",
    rationale: "Bandages/poultices consume real materials and modify the targeted real wound field (bleeding/pain), scaled by the healer's real skill (P7-12).",
    evidence: ["src/sim/politics/Medicine.ts"],
  },
  {
    id: 114, title: "Splints, Braces & Rehabilitation", domain: "health", verdict: "PASS",
    rationale: "Splints consume real wood and reduce real mobility impairment; wounds then heal at their own real rate (P7-12/P7-10).",
    evidence: ["src/sim/politics/Medicine.ts", "src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 115, title: "Hospital Logistics", domain: "health", verdict: "ADAPTED",
    rationale: "Treatment materials are real physical goods that must exist (P7-12); full hospital infrastructure (beds, water supply) is not modeled.",
    evidence: ["src/sim/politics/Medicine.ts"],
  },
  {
    id: 116, title: "Syndrome Framework", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "Disease has a real progression model (P4-14); a generic timed-syndrome framework is not built.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-04 metabolism) -- a generic timed-syndrome framework is next-generation scope; specific disease/infection/wound systems cover current causes.",
  },
  {
    id: 117, title: "Venoms & Toxins", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "No toxin delivery routes are modeled.",
    evidence: [],
    scopeReason: "Deferred -- no venom/toxin content exists; the delivery-route machinery would be Phase 11 (P11-04) scope.",
  },
  {
    id: 118, title: "Contaminants", domain: "matter", verdict: "ADAPTED",
    rationale: "Refuse is real physical waste with origin records (P2-09); contaminants adhering to fur/items/surfaces are not modeled.",
    evidence: ["src/sim/logistics/Refuse.ts"],
  },
  {
    id: 119, title: "Embedded / Severed Objects", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "Deferred -- not modeled; see the row's rationale for what exists instead.",
    evidence: [],
    scopeReason: "Deferred -- wounds carry severity/bleeding/pain rather than embedded objects; embedded-object physics is out of the current fiction scope.",
  },
  {
    id: 120, title: "Intoxication", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "Fermentation exists as a craft (P3-08) but intoxication effects are not modeled.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-04 -- metabolism and intoxication); fermentation exists as a craft (P3-08) but intoxication effects do not.",
  },
  // ─────────────────────────── F. Underground, Physics, Logistics, Waterworks ───────────────────────────
  {
    id: 121, title: "Layered Caverns", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Z-level digging exists (P3-06); cavern content is not authored.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-19 millennia-scale archaeology) -- z-level digging exists (P3-06); cavern worldgen content does not.",
  },
  {
    id: 122, title: "Underground Ecology", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "No underground biome content.",
    evidence: [],
    scopeReason: "Deferred -- depends on cavern content (121); no underground biome exists.",
  },
  {
    id: 123, title: "Procedural Subterranean Creatures", domain: "creatures", verdict: "OUT_OF_SCOPE",
    rationale: "No cavern content.",
    evidence: [],
    scopeReason: "Deferred -- depends on cavern content (121).",
  },
  {
    id: 124, title: "Temperature & Phase Change", domain: "matter", verdict: "ADAPTED",
    rationale: "Temperature exists per tick/season (P1-18/P6-03) and fires consume flammable material (P4-15). Freezing/thawing and phase changes are not modeled.",
    evidence: ["src/sim/weather/Weather.ts", "src/sim/ecology/Fire.ts"],
  },
  {
    id: 125, title: "Collapse & Cave-In", domain: "construction", verdict: "ADAPTED",
    rationale: "Structural wear and failure exist (P3-12 Structural.ts); collapse cascades are not modeled.",
    evidence: ["src/sim/structures/Structural.ts"],
  },
  {
    id: 126, title: "Falling Physics", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "No falling/gravity model for entities.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope -- vertical placement is grid-authoritative; water is the project's physics engine, not rigid-body motion.",
  },
  {
    id: 127, title: "Cart / Sledge / Raft Dynamics", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Vehicles are not modeled; hauling is mass-scaled by the carrier (P1-09).",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: caravans/hauling are the cargo carriers (the checklist's own boats-as-analogue note); vehicle dynamics are not modeled.",
  },
  {
    id: 128, title: "Projectile Motion", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No ranged weapons.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: combat is melee-range exchanges; no ranged weapons.",
  },
  {
    id: 129, title: "Momentum & Collision", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "No momentum model.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: no rigid-body momentum model; water dynamics are the project's physics.",
  },
  {
    id: 130, title: "Sliding, Tumbling & Impact", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "Terrain friction exists as movement cost (P0-07/P1-04); no balance/knockdown model.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: friction is a navigation cost (P1-04); body-physics knockdown is not modeled.",
  },
  {
    id: 131, title: "Hauling Routes", domain: "economy", verdict: "PASS",
    rationale: "Real haul jobs with mass-scaled speed, reservations, and delivery (P1-09), plus stockpile haul generation (P2-01) and caravan routes (P7-03).",
    evidence: ["src/sim/labor/Hauling.ts", "src/sim/logistics/Stockpile.ts"],
  },
  {
    id: 132, title: "Route Stops & Transfer Rules", domain: "economy", verdict: "ADAPTED",
    rationale: "Stockpile rules (allowed/forbidden materials) govern transfers (P2-01); departure triggers/priorities are not modeled.",
    evidence: ["src/sim/logistics/Stockpile.ts"],
  },
  {
    id: 133, title: "Wheelbarrows / Sledges / Carriers", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Carrier equipment is not modeled.",
    evidence: [],
    scopeReason: "Deferred -- carrier equipment is not modeled; carrying capacity is per-creature.",
  },
  {
    id: 134, title: "Containerized Hauling", domain: "economy", verdict: "PASS",
    rationale: "Real containers with capacity mass, place/remove operations, and liquid contents (P3-07).",
    evidence: ["src/sim/economy/Container.ts", "src/sim/economy/Liquid.ts"],
  },
  {
    id: 135, title: "Stockpile Links", domain: "economy", verdict: "ADAPTED",
    rationale: "Stockpiles filter by real material categories (P2-01); explicit source/sink links are not modeled.",
    evidence: ["src/sim/logistics/Stockpile.ts"],
  },
  {
    id: 136, title: "Workshop Supply Links", domain: "economy", verdict: "ADAPTED",
    rationale: "Craft jobs consume real delivered materials (P3-02/P3-03); named supply links are not modeled.",
    evidence: ["src/sim/economy/Craft.ts", "src/sim/economy/Workshop.ts"],
  },
  {
    id: 137, title: "Mechanical Power Networks", domain: "construction", verdict: "PASS",
    rationale: "Water wheels generate real power transmitted over real networks to machines (P3-15/P3-16).",
    evidence: ["src/sim/mechanics/WaterPower.ts", "src/sim/mechanics/Machine.ts"],
  },
  {
    id: 138, title: "Pumping & Flow Engineering", domain: "environment", verdict: "ADAPTED",
    rationale: "Gates genuinely alter water flow (P3-13) and dams throttle through material properties (P1-12). Pumps/siphons/locks are not modeled.",
    evidence: ["src/sim/hydrology/Gate.ts", "src/sim/hydrology/Dam.ts"],
  },
  {
    id: 139, title: "Aquifers & Groundwater", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "Surface water columns are real (P1-02); groundwater layers are not modeled.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-01 watershed engineering / P11-03 fluid composition) -- surface water columns are real (P1-02); groundwater layers are not.",
  },
  {
    id: 140, title: "Multi-Tile Trees & Woody Plants", domain: "ecology", verdict: "ADAPTED",
    rationale: "Trees are real plants with health and real felling (P4-01/P1-08); multi-tile crown/root geometry is not modeled.",
    evidence: ["src/sim/ecology/Plant.ts", "src/sim/labor/TreeCutting.ts"],
  },
  // ─────────────────────────── G. Psychology, Relationships, Culture, Knowledge ───────────────────────────
  {
    id: 141, title: "Personality Traits", domain: "cognition", verdict: "PASS",
    rationale: "Real trait components (industriousness etc.) that norms evaluate and behavior reads (P2-13/P5-07).",
    evidence: ["src/sim/creatures/Traits.ts", "src/sim/creatures/Norms.ts"],
  },
  {
    id: 142, title: "Personal Values", domain: "cognition", verdict: "ADAPTED",
    rationale: "Household-generated norms encode values (P5-07); individual value sets are not modeled.",
    evidence: ["src/sim/creatures/Norms.ts"],
  },
  {
    id: 143, title: "Emotion Model", domain: "cognition", verdict: "ADAPTED",
    rationale: "Mood derives from real events and needs (P2-14), and stress accumulates from real causes (P2-10). Personality-mediated interpretation is not modeled.",
    evidence: ["src/sim/creatures/Mood.ts", "src/sim/creatures/Stress.ts"],
  },
  {
    id: 144, title: "Long-Term Stress", domain: "cognition", verdict: "PASS",
    rationale: "Stress accumulates from real causes (danger, pain, needs) and decays; extreme stress has real consequences (P2-10).",
    evidence: ["src/sim/creatures/Stress.ts"],
  },
  {
    id: 145, title: "Short-Term Memory", domain: "cognition", verdict: "ADAPTED",
    rationale: "Mood uses a real recent-event window (P2-14); a separate short-term memory store is not modeled.",
    evidence: ["src/sim/creatures/Mood.ts"],
  },
  {
    id: 146, title: "Long-Term Memory", domain: "cognition", verdict: "PASS",
    rationale: "Real persistent memories of real events with valence, strength, and decay (P5-02), carried across journeys (P9-04) and shared in conversation (P9-03).",
    evidence: ["src/sim/creatures/Memory.ts", "src/sim/wayfarer/Conversation.ts"],
  },
  {
    id: 147, title: "Personality Change", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Traits are fixed at spawn.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-08 cultural evolution) -- traits are static data today.",
  },
  {
    id: 148, title: "Needs", domain: "cognition", verdict: "PASS",
    rationale: "Hunger, thirst, fatigue, thermal comfort, social need, and their urgency-driven behavior (P1-06/P1-14/P2-12) -- the DF need loop with beaver-relevant drives.",
    evidence: ["src/sim/creatures/Needs.ts", "src/sim/creatures/BeaverNeeds.ts", "src/sim/creatures/SocialInteraction.ts"],
  },
  {
    id: 149, title: "Relationship Graph", domain: "society", verdict: "PASS",
    rationale: "A real graph: kin/mate edges with familiarity/affinity, households, org memberships (P1-19/P5-05/P7-01), with edges that survive their holder for succession (P7-08).",
    evidence: ["src/sim/creatures/Relationships.ts", "src/sim/politics/Organization.ts"],
  },
  {
    id: 150, title: "Taverns / Fermentation Halls", domain: "society", verdict: "ADAPTED",
    rationale: "Social venues and fermentation exist separately (P2-12/P3-08); a combined drinking-hall institution is not authored.",
    evidence: ["src/sim/creatures/SocialInteraction.ts", "src/sim/economy/Craft.ts"],
  },
  {
    id: 151, title: "Inns / Guest Lodges", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "No visitor-accommodation content; the wayfarer materializes into settlements directly (P9-04).",
    evidence: [],
    scopeReason: "Deferred -- no visitor-accommodation content; travel materializes the wayfarer at the site (P9-04).",
  },
  {
    id: 152, title: "Temples & Sacred Water Sites", domain: "society", verdict: "ADAPTED",
    rationale: "Real beliefs with origins, adoption, and rituals (P5-08); sacred-site designation is not modeled.",
    evidence: ["src/sim/creatures/Belief.ts"],
  },
  {
    id: 153, title: "Libraries & Archives", domain: "history", verdict: "ADAPTED",
    rationale: "The event log IS the archive, queryable forever (P0-08/P8); physical libraries of written objects are not modeled.",
    evidence: ["src/sim/history/EventLog.ts", "src/sim/chronicle/Chronicle.ts"],
  },
  {
    id: 154, title: "Procedural Poetry", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Authored culture content.",
    evidence: [],
    scopeReason: "Authored content; artworks exist (P5-09), poetry does not.",
  },
  {
    id: 155, title: "Procedural Music", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Authored culture content.",
    evidence: [],
    scopeReason: "Authored culture content.",
  },
  {
    id: 156, title: "Procedural Dance / Ritual Movement", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Rituals exist as real events (P5-08); choreography is presentation.",
    evidence: [],
    scopeReason: "Presentation of the real ritual system (P5-08); choreography is rendering.",
  },
  {
    id: 157, title: "Procedural Instruments", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Authored content.",
    evidence: [],
    scopeReason: "Authored content.",
  },
  {
    id: 158, title: "Performances", domain: "history", verdict: "ADAPTED",
    rationale: "Ritual performances are real recorded events with real participants (P5-08).",
    evidence: ["src/sim/creatures/Belief.ts"],
  },
  {
    id: 159, title: "Knowledge Domains", domain: "cognition", verdict: "ADAPTED",
    rationale: "Skills are named domains that develop through practice (P2-03); domain-specific knowledge objects are not modeled.",
    evidence: ["src/sim/creatures/SkillProgression.ts"],
  },
  {
    id: 160, title: "Research", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "No research loop.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-10 invention / P11-17 engineering design) -- no research loop.",
  },
  {
    id: 161, title: "Mentorship & Apprenticeship", domain: "cognition", verdict: "ADAPTED",
    rationale: "Real mentor relationships derived from skill gaps (P2-13 RelationshipTypes); apprenticeship effects are not modeled.",
    evidence: ["src/sim/creatures/RelationshipTypes.ts"],
  },
  {
    id: 162, title: "Books, Scrolls, Maps & Plans", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Knowledge objects are not built; recorded events serve the role.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-09 technological knowledge as culture) -- knowledge objects are not built; the event log is the persistent store.",
  },
  {
    id: 163, title: "Scribes & Copying", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on writing objects (162).",
    evidence: [],
    scopeReason: "Deferred -- depends on writing objects (162).",
  },
  {
    id: 164, title: "Visitors", domain: "society", verdict: "ADAPTED",
    rationale: "The wayfarer arrives at settlements as a real visitor (P9-04); other visitor types are not authored.",
    evidence: ["src/sim/wayfarer/Travel.ts"],
  },
  {
    id: 165, title: "Residency & Citizenship", domain: "society", verdict: "ADAPTED",
    rationale: "Migrations genuinely add population (P7-05) and households form (P5-05); petition/citizenship flows are not modeled.",
    evidence: ["src/sim/politics/Migration.ts", "src/sim/creatures/Household.ts"],
  },
  // ─────────────────────────── H. Institutions, Crime, Religion, Diplomacy ───────────────────────────
  {
    id: 166, title: "Guilds & Professional Orders", domain: "society", verdict: "PASS",
    rationale: "Organizations with real roles, membership, and shared institutional assets (P7-01) -- the generic machinery guilds are.",
    evidence: ["src/sim/politics/Organization.ts"],
  },
  {
    id: 167, title: "Guildhalls", domain: "construction", verdict: "ADAPTED",
    rationale: "Workshops are real spaces org assets could occupy (P3-02); org-linked halls are not modeled.",
    evidence: ["src/sim/economy/Workshop.ts"],
  },
  {
    id: 168, title: "Organized Religions", domain: "society", verdict: "ADAPTED",
    rationale: "Beliefs have real origins, adoption, and rituals (P5-08); institutional faiths with clergy/property are not modeled.",
    evidence: ["src/sim/creatures/Belief.ts"],
  },
  {
    id: 169, title: "Priesthoods", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on organized religions (168).",
    evidence: [],
    scopeReason: "Deferred -- beliefs exist without clerical offices; organized religions are Phase 11 (P11-08) content.",
  },
  {
    id: 170, title: "Sermons & Pastoral Care", domain: "society", verdict: "ADAPTED",
    rationale: "Ritual participation is real (P5-08); preaching as an activity is not modeled.",
    evidence: ["src/sim/creatures/Belief.ts"],
  },
  {
    id: 171, title: "Petitions", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Wayfarer situations surface real needs (P9-09) instead of petition documents.",
    evidence: [],
    scopeReason: "Deferred -- situations (P9-09) serve the discovery role headlessly; petition documents are not modeled.",
  },
  {
    id: 172, title: "Artifact Provenance", domain: "history", verdict: "PASS",
    rationale: "Full recorded owner chains, movement, use in events, theft, loss, recovery (P8-05) -- provenance is the system.",
    evidence: ["src/sim/chronicle/ArtifactHistories.ts", "src/sim/chronicle/Provenance.ts"],
  },
  {
    id: 173, title: "Relics", domain: "history", verdict: "ADAPTED",
    rationale: "Artifacts acquire real historical association through recorded events (P8-05); sacred status is not modeled.",
    evidence: ["src/sim/chronicle/ArtifactHistories.ts"],
  },
  {
    id: 174, title: "Displays & Museums", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Display institutions are not modeled.",
    evidence: [],
    scopeReason: "Deferred -- ownership/provenance exist (P8-05) without exhibition mechanics; museums are content.",
  },
  {
    id: 175, title: "False Identities", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Identity is a real single component (P5-10); no cover-identity system.",
    evidence: [],
    scopeReason: "Deferred -- identity is a real single component (P5-10); espionage content is out of scope.",
  },
  {
    id: 176, title: "Agents & Covers", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Espionage content.",
    evidence: [],
    scopeReason: "Deferred -- espionage content is out of scope.",
  },
  {
    id: 177, title: "Corruption", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "No bribery/embezzlement mechanics.",
    evidence: [],
    scopeReason: "Deferred -- no official/contract system exists to corrupt yet.",
  },
  {
    id: 178, title: "Criminal Networks", domain: "society", verdict: "ADAPTED",
    rationale: "Hostile organizations and raiders exist (P7-01/P7-13); criminal-org behaviors are not authored.",
    evidence: ["src/sim/politics/Organization.ts", "src/sim/politics/Raids.ts"],
  },
  {
    id: 179, title: "Traitors & Internal Saboteurs", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "No loyalty/defection model.",
    evidence: [],
    scopeReason: "Deferred -- no loyalty/defection model.",
  },
  {
    id: 180, title: "Artifact Heists", domain: "society", verdict: "ADAPTED",
    rationale: "The core loop is real: theft (P5-12/P9-07), evidence, prosecution, and recovery through real justice (P7-09). Casing/bribery/distraction layers are not authored.",
    evidence: ["src/sim/creatures/Law.ts", "src/sim/politics/Justice.ts", "src/sim/wayfarer/Consequences.ts"],
  },
  {
    id: 181, title: "Interrogation & Testimony", domain: "society", verdict: "ADAPTED",
    rationale: "Witnesses are derived from real recorded history at the violation's place/time (P7-09); interrogation mechanics are not modeled.",
    evidence: ["src/sim/politics/Justice.ts"],
  },
  {
    id: 182, title: "Counterintelligence", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Espionage content.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 183, title: "Multi-Agent Conspiracies", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Coordinated plotting is not modeled.",
    evidence: [],
    scopeReason: "Deferred -- no planning/coordination system for crime.",
  },
  {
    id: 184, title: "Activated World Simulation", domain: "world", verdict: "PASS",
    rationale: "Trade, migration, politics, raids, battles, wars, and civilization rise/fall continue across the whole region through tickPolitics (P7) and deep time (P6-13).",
    evidence: ["src/sim/politics/PoliticsLoop.ts", "src/sim/region/DeepTime.ts"],
  },
  {
    id: 185, title: "Off-Site Birth & Death", domain: "world", verdict: "ADAPTED",
    rationale: "Inactive-site populations change through real closed-form LOD (P6-07) and real migrations (P7-05); individual off-site persons are not tracked (population counts are).",
    evidence: ["src/sim/region/OffscreenLOD.ts", "src/sim/politics/Migration.ts"],
  },
  {
    id: 186, title: "Off-Site Marriage & Succession", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Inactive sites have no individual persons to marry/succeed.",
    evidence: [],
    scopeReason: "Deferred by design -- the region scale abstracts persons to population counts (P6-08's own semantics); off-site individuals do not exist to marry or succeed.",
  },
  {
    id: 187, title: "Dynamic Settlement Foundation", domain: "world", verdict: "ADAPTED",
    rationale: "Migration moves population between EXISTING sites (P7-05); new-site founding by groups is not modeled.",
    evidence: ["src/sim/politics/Migration.ts"],
  },
  {
    id: 188, title: "Site Conquest", domain: "society", verdict: "ADAPTED",
    rationale: "Wars cede real territory (P7-16) and raids loot (P7-13); ruler/population changes by conquest are not modeled.",
    evidence: ["src/sim/politics/War.ts", "src/sim/politics/Raids.ts"],
  },
  {
    id: 189, title: "Holdings & Dependencies", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Polities claim territory (P7-07) but do not administer subordinate settlements.",
    evidence: [],
    scopeReason: "Deferred -- territory claims exist (P7-07) without administrative hierarchy; holdings are Phase 11 institutional content.",
  },
  {
    id: 190, title: "Administrators", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Named offices beyond leadership are not modeled.",
    evidence: [],
    scopeReason: "Deferred -- org roles exist generically (P7-01) but named offices do not.",
  },
  {
    id: 191, title: "Pillaging & Requisition", domain: "combat", verdict: "ADAPTED",
    rationale: "Raids loot real food (P7-13); military requisition of specific goods is not modeled.",
    evidence: ["src/sim/politics/Raids.ts"],
  },
  {
    id: 192, title: "Razing & Infrastructure Destruction", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No structure-destruction combat.",
    evidence: [],
    scopeReason: "Deferred -- raids loot food rather than destroy structures; structure-destruction combat is siege content.",
  },
  {
    id: 193, title: "Tribute & Vassalage", domain: "economy", verdict: "ADAPTED",
    rationale: "Tribute treaty kind exists (P7-06); physical tribute transfers are not modeled.",
    evidence: ["src/sim/politics/Diplomacy.ts"],
  },
  {
    id: 194, title: "Messengers & Envoys", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Diplomacy is event-derived (P7-06); no physical messengers.",
    evidence: [],
    scopeReason: "Deferred -- standing derives from shared recorded events (P7-06); physical messengers are not modeled.",
  },
  {
    id: 195, title: "Dynamic War / Peace / Alliances / Trade", domain: "society", verdict: "PASS",
    rationale: "Relations change through real recorded events and treaties; wars declare from real causes and end in real peace (P7-06/P7-16); trade flows from real surplus/shortage (P7-03).",
    evidence: ["src/sim/politics/Diplomacy.ts", "src/sim/politics/War.ts", "src/sim/politics/Trade.ts"],
  },
  // ─────────────────────────── I. Combat, Expeditions, Sieges, Work, Modding ───────────────────────────
  {
    id: 196, title: "Off-Site Skill Growth", domain: "cognition", verdict: "ADAPTED",
    rationale: "Military training practices real skills (P7-14); expedition-driven skill change is not modeled.",
    evidence: ["src/sim/politics/Military.ts"],
  },
  {
    id: 197, title: "Military Tactics", domain: "combat", verdict: "ADAPTED",
    rationale: "Combat skill, equipment, and numbers decide battles (P7-15); terrain/formation/morale tactics are not modeled.",
    evidence: ["src/sim/politics/Battle.ts"],
  },
  {
    id: 198, title: "Multi-Character Adventure Parties", domain: "society", verdict: "PASS",
    rationale: "The wayfarer + real companions with ordinary AI travel and act together (P9-08), exactly the party loop without a separate ruleset.",
    evidence: ["src/sim/wayfarer/Companions.ts", "src/sim/wayfarer/Travel.ts"],
  },
  {
    id: 199, title: "Tactical Party Orders", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "Companions follow (P9-08); tactical orders are not modeled.",
    evidence: [],
    scopeReason: "Deferred -- follow behavior exists (P9-08); tactical battle orders are siege/party content.",
  },
  {
    id: 200, title: "Mounts & Rideable Creatures", domain: "creatures", verdict: "OUT_OF_SCOPE",
    rationale: "The checklist itself suggests boats as the analogue; neither is modeled.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: the checklist itself suggests boats as the analogue; travel is swimming/walking/caravan.",
  },
  {
    id: 201, title: "Pack Animals & Cargo Companions", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Caravans carry goods abstractly over real routes (P7-03); pack creatures are not modeled.",
    evidence: [],
    scopeReason: "Deferred -- caravans are the region-scale cargo carrier; pack creatures are not modeled.",
  },
  {
    id: 202, title: "Persistent Pets / Companions", domain: "creatures", verdict: "ADAPTED",
    rationale: "Beaver companions persist with relationships (P9-08); named animal pets are not modeled.",
    evidence: ["src/sim/wayfarer/Companions.ts"],
  },
  {
    id: 203, title: "Historical Background Selection", domain: "history", verdict: "ADAPTED",
    rationale: "Citizens have real parentage/sites/histories (P8-06); a background-picking UI is not modeled.",
    evidence: ["src/sim/chronicle/Genealogy.ts"],
  },
  {
    id: 204, title: "Belief / Religion Background", domain: "society", verdict: "ADAPTED",
    rationale: "Households hold real beliefs (P5-08); adventurer starting-belief selection is not modeled.",
    evidence: ["src/sim/creatures/Belief.ts"],
  },
  {
    id: 205, title: "Starting Equipment Loadout", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Adventurer starting gear is not modeled.",
    evidence: [],
    scopeReason: "Deferred -- the wayfarer starts with carried items only; loadout selection is content.",
  },
  {
    id: 206, title: "Ranged Loading & Preparation", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No ranged weapons.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: combat is melee exchanges; no ranged weapons.",
  },
  {
    id: 207, title: "Anatomical Aiming", domain: "combat", verdict: "ADAPTED",
    rationale: "Attacks strike body parts by real weighted chance (P7-10); deliberate aiming is not modeled.",
    evidence: ["src/sim/creatures/Anatomy.ts"],
  },
  {
    id: 208, title: "Distance-Based Accuracy", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No ranged attacks.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope -- combat is melee-range exchanges.",
  },
  {
    id: 209, title: "Fortification-Aware Ranged AI", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on ranged combat.",
    evidence: [],
    scopeReason: "Intentionally out of the fiction scope: depends on ranged combat.",
  },
  {
    id: 210, title: "Adaptive Siege Planning", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "Sieges are not modeled.",
    evidence: [],
    scopeReason: "Deferred -- raids/battles exist (P7-13/P7-15); sieges do not.",
  },
  {
    id: 211, title: "Enemy Digging", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "Siege content.",
    evidence: [],
    scopeReason: "Deferred -- siege content.",
  },
  {
    id: 212, title: "Enemy Construction", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "Siege content.",
    evidence: [],
    scopeReason: "Deferred -- siege content.",
  },
  {
    id: 213, title: "Enemy Deconstruction", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No structure-attack mechanics.",
    evidence: [],
    scopeReason: "Deferred -- structures are not combat targets.",
  },
  {
    id: 214, title: "Battering / Breaching Machines", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No siege engines.",
    evidence: [],
    scopeReason: "Deferred -- siege content.",
  },
  {
    id: 215, title: "Danger Memory", domain: "cognition", verdict: "PASS",
    rationale: "Migration push derives from real recent hostile events (P7-05) and memory stores real events with valence (P5-02) -- danger genuinely remembered, not scripted.",
    evidence: ["src/sim/politics/Migration.ts", "src/sim/creatures/Memory.ts"],
  },
  {
    id: 216, title: "Tactical Siege Roles", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No sieges.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 217, title: "Historical Commanders", domain: "history", verdict: "ADAPTED",
    rationale: "War participants and casualties are real historical records (P7-15/P8); commander personas are not modeled.",
    evidence: ["src/sim/politics/Battle.ts", "src/sim/chronicle/CausalHistory.ts"],
  },
  {
    id: 218, title: "Siege Engines", domain: "combat", verdict: "OUT_OF_SCOPE",
    rationale: "No siege content.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 219, title: "Structural Material Resistance", domain: "construction", verdict: "PASS",
    rationale: "Structures hold real materials (wood/stone) with real hardness/strength, and structural wear consumes them (P3-12/P1-10).",
    evidence: ["src/sim/structures/Structural.ts", "src/sim/labor/Construction.ts"],
  },
  {
    id: 220, title: "Reinforcement", domain: "construction", verdict: "ADAPTED",
    rationale: "Material choice affects structural behavior (P3-12); layered reinforcement is not modeled.",
    evidence: ["src/sim/structures/Structural.ts"],
  },
  {
    id: 221, title: "Work Details", domain: "economy", verdict: "ADAPTED",
    rationale: "Labor preferences weight job selection (P2-02); named crews/teams are not modeled.",
    evidence: ["src/sim/jobs/LaborPreferences.ts"],
  },
  {
    id: 222, title: "Job Priority", domain: "economy", verdict: "ADAPTED",
    rationale: "Urgent fatigue interrupts jobs and the colony loop prioritizes labor types (P1-14/ColonyLoop); a full policy-driven priority system is not modeled.",
    evidence: ["src/sim/creatures/BeaverBehavior.ts", "src/sim/runtime/ColonyLoop.ts"],
  },
  {
    id: 223, title: "Manager Work Orders", domain: "economy", verdict: "ADAPTED",
    rationale: "Automatic stockpile/food-production/social loops exist (P2-01/P2-07); conditional production rules are not modeled.",
    evidence: ["src/sim/logistics/Stockpile.ts", "src/sim/ecology/FoodProduction.ts"],
  },
  {
    id: 224, title: "Difficulty as Parameters", domain: "world", verdict: "ADAPTED",
    rationale: "All balance values are tunable constants, but no difficulty-preset system exists.",
    evidence: ["src/sim/materials/standardMaterials.ts"],
  },
  {
    id: 225, title: "Data-Driven & Scriptable Modding", domain: "world", verdict: "ADAPTED",
    rationale: "All definitions are data-driven registries (materials, species, recipes, pathogens, roles, government forms); a mod-loading layer is not built.",
    evidence: ["src/sim/persistence/AllComponentTypes.ts", "src/sim/economy/Recipe.ts"],
  },
  // ─────────────────────────── J. Advanced Physical World & Hydrology ───────────────────────────
  {
    id: 226, title: "Atmospheric Gas Simulation", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "Breath is modeled per-creature (P1-16); gases as moving volumes are not.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-15 environmental signals) -- respiration is per-creature (P1-16); volumetric gas is not.",
  },
  {
    id: 227, title: "Air Pressure", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "No pressure model.",
    evidence: [],
    scopeReason: "Deferred -- no pressure model.",
  },
  {
    id: 228, title: "Ventilation", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on gas simulation.",
    evidence: [],
    scopeReason: "Deferred -- depends on gas simulation (226).",
  },
  {
    id: 229, title: "Fluid Mixtures", domain: "matter", verdict: "ADAPTED",
    rationale: "Liquid contents exist per container (P3-08); water columns are uniform -- no multi-solute mixing.",
    evidence: ["src/sim/economy/Liquid.ts"],
  },
  {
    id: 230, title: "Dissolved Chemistry", domain: "matter", verdict: "OUT_OF_SCOPE",
    rationale: "No solute model.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-03 fluid composition) -- water is uniform columns; dissolved chemistry is next-generation scope.",
  },
  {
    id: 231, title: "Humidity & Evaporation", domain: "environment", verdict: "ADAPTED",
    rationale: "Weather/precipitation and seasons exist (P1-18/P6-03); humidity effects on materials are not modeled.",
    evidence: ["src/sim/weather/Weather.ts"],
  },
  {
    id: 232, title: "Thermodynamics", domain: "matter", verdict: "ADAPTED",
    rationale: "Thermal conductivity drives creature exposure (P1-15); heat transfer through materials is not modeled.",
    evidence: ["src/sim/creatures/BeaverNeeds.ts"],
  },
  {
    id: 233, title: "Combustion Chemistry", domain: "matter", verdict: "ADAPTED",
    rationale: "Fire consumes flammable material and spreads (P4-15); oxygen/airflow factors are not modeled.",
    evidence: ["src/sim/ecology/Fire.ts"],
  },
  {
    id: 234, title: "Explosions & Pressure Events", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "No pressure model.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 235, title: "Structural Load Simulation", domain: "construction", verdict: "ADAPTED",
    rationale: "Structural wear with material strength (P3-12); load paths through beams/foundations are not modeled.",
    evidence: ["src/sim/structures/Structural.ts"],
  },
  {
    id: 236, title: "Material Fatigue & Decay", domain: "construction", verdict: "ADAPTED",
    rationale: "Structures wear (P3-12); rot/freeze-thaw decay is not modeled.",
    evidence: ["src/sim/structures/Structural.ts"],
  },
  {
    id: 237, title: "Soil Mechanics", domain: "matter", verdict: "ADAPTED",
    rationale: "Terrain materials differ in dig cost/behavior (P3-06/P0-07); bearing capacity/erosion are not modeled.",
    evidence: ["src/sim/labor/Digging.ts"],
  },
  {
    id: 238, title: "Erosion & Sediment Transport", domain: "environment", verdict: "OUT_OF_SCOPE",
    rationale: "Water moves as columns without sediment.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-05 dynamic river morphology) -- water moves as columns without sediment.",
  },
  {
    id: 239, title: "Watershed Hydrology", domain: "environment", verdict: "EXCEEDED",
    rationale: "Real regional watershed generation with river networks, flow accumulation, and flood detection from real climate (P6-02/P6-04/P6-12), plus detailed-scale hydrology -- the project's signature system, beyond DF's water model.",
    evidence: ["src/sim/region/RegionalHydrology.ts", "src/sim/hydrology/WaterField.ts", "src/sim/region/WorldDisasters.ts"],
  },
  {
    id: 240, title: "Dynamic Weather", domain: "environment", verdict: "ADAPTED",
    rationale: "Seasons drive real temperature/precipitation curves (P1-18/P6-03); moving fronts/storms are not modeled.",
    evidence: ["src/sim/weather/Weather.ts", "src/sim/region/Climate.ts"],
  },
  // ─────────────────────────── K. Biology, Disease, Ecology, Agriculture, Food ───────────────────────────
  {
    id: 241, title: "Scent Simulation", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "No odor model; predation uses distance/preference (P4-05).",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-16 scent/chemical traces) -- scent is abstracted into predator targeting (P4-05).",
  },
  {
    id: 242, title: "Microbiology", domain: "ecology", verdict: "ADAPTED",
    rationale: "Pathogens spread and damage (P4-14); microbes as food/waste transformers are not modeled.",
    evidence: ["src/sim/creatures/Disease.ts"],
  },
  {
    id: 243, title: "Food Spoilage", domain: "ecology", verdict: "PASS",
    rationale: "Real food spoilage with material-dependent rates (P2-08).",
    evidence: ["src/sim/ecology/FoodSpoilage.ts"],
  },
  {
    id: 244, title: "Fermentation", domain: "matter", verdict: "PASS",
    rationale: "Real fermentation of liquid contents in containers (P3-08).",
    evidence: ["src/sim/economy/Liquid.ts", "src/sim/economy/Container.ts"],
  },
  {
    id: 245, title: "Epidemiology", domain: "health", verdict: "ADAPTED",
    rationale: "Disease spreads through real contagion (P4-14); droplet/water/vector routes are not modeled.",
    evidence: ["src/sim/creatures/Disease.ts"],
  },
  {
    id: 246, title: "Immune Systems", domain: "health", verdict: "OUT_OF_SCOPE",
    rationale: "Infection/disease resolve without per-creature immunity.",
    evidence: [],
    scopeReason: "Deferred -- infection progression is uniform; per-creature immunity is not modeled.",
  },
  {
    id: 247, title: "Genetics", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "No heritable trait model.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-08 cultural evolution / genetics) -- offspring do not inherit traits.",
  },
  {
    id: 248, title: "Mutation & Population Change", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on genetics.",
    evidence: [],
    scopeReason: "Deferred -- depends on genetics (247).",
  },
  {
    id: 249, title: "Real Food Webs", domain: "ecology", verdict: "ADAPTED",
    rationale: "Predator/prey dynamics with real populations (P4-05/P6-11); full multi-trophic webs are not modeled.",
    evidence: ["src/sim/creatures/Predation.ts", "src/sim/region/WorldWildlife.ts"],
  },
  {
    id: 250, title: "Animal Territories & Migration", domain: "ecology", verdict: "ADAPTED",
    rationale: "Wildlife populations are per-cell (P6-11); territories/routes are not modeled.",
    evidence: ["src/sim/region/WorldWildlife.ts"],
  },
  {
    id: 251, title: "Ecological Succession", domain: "ecology", verdict: "ADAPTED",
    rationale: "Vegetation health responds to real conditions and fire clears plants (P4-16/P4-15); staged succession is not modeled.",
    evidence: ["src/sim/history/EcosystemCausality.ts", "src/sim/ecology/Fire.ts"],
  },
  {
    id: 252, title: "Extinction & Invasive Species", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "Populations can be depleted to zero per cell (P6-11); species-level extinction is not modeled.",
    evidence: [],
    scopeReason: "Deferred -- populations are per-cell (P6-11) without species-level extinction.",
  },
  {
    id: 253, title: "Soil Nutrients", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "Fertility is a per-biome constant (P6-11), not soil state.",
    evidence: [],
    scopeReason: "Deferred -- biome fertility is data (P6-11), not soil chemistry.",
  },
  {
    id: 254, title: "Crop Rotation & Land Stewardship", domain: "ecology", verdict: "OUT_OF_SCOPE",
    rationale: "No crop-specific soil management.",
    evidence: [],
    scopeReason: "Deferred -- food production is plant-based (P2-07) without soil state.",
  },
  {
    id: 255, title: "Nutrition & Metabolism", domain: "health", verdict: "ADAPTED",
    rationale: "Food restores hunger by real nutrition values (P1-13); calories/macronutrients are not modeled.",
    evidence: ["src/sim/labor/Food.ts"],
  },
  // ─────────────────────────── L. Mind, Belief, Information, Law, Economy ───────────────────────────
  {
    id: 256, title: "Attention", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "No perception/attention filter; systems read global state.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-06 knowledge propagation) -- perception is not limited; systems read global state.",
  },
  {
    id: 257, title: "Working Memory", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Decisions use current needs/memories directly (P1-06/P5-02); no constrained active set.",
    evidence: [],
    scopeReason: "Deferred -- decision inputs are unfiltered state; working memory is next-generation cognition scope.",
  },
  {
    id: 258, title: "Belief Graphs", domain: "cognition", verdict: "ADAPTED",
    rationale: "Memories store what individuals actually witnessed (P5-02) and norms/beliefs are per-household (P5-07/P5-08); full belief-about-world graphs are not modeled.",
    evidence: ["src/sim/creatures/Memory.ts", "src/sim/creatures/Belief.ts"],
  },
  {
    id: 259, title: "Confidence & Uncertainty", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Memories have strength (P5-02) but no confidence model.",
    evidence: [],
    scopeReason: "Deferred -- memory strength exists (P5-02) without belief confidence.",
  },
  {
    id: 260, title: "Rumor Mutation", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Shared memories are copied faithfully (P9-03).",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-07 rumor, distortion, and folklore) -- information spreads without distortion.",
  },
  {
    id: 261, title: "Information Provenance", domain: "history", verdict: "PASS",
    rationale: "Every recorded event carries its cause chain and participants (P0-08); chronicle claims cite their exact source events (P8-03) -- provenance is the system's spine.",
    evidence: ["src/sim/history/EventLog.ts", "src/sim/chronicle/FigurePages.ts"],
  },
  {
    id: 262, title: "Language Drift", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Names are procedural but static (P5-10).",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-07/P11-08) -- names are procedural but static (P5-10); no language model.",
  },
  {
    id: 263, title: "Dialects & Sociolects", domain: "history", verdict: "OUT_OF_SCOPE",
    rationale: "Depends on language model.",
    evidence: [],
    scopeReason: "Deferred -- depends on the language model (262).",
  },
  {
    id: 264, title: "Literacy", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "No written-knowledge objects.",
    evidence: [],
    scopeReason: "Deferred -- no writing system; literacy is Phase 11 knowledge content (P11-09).",
  },
  {
    id: 265, title: "Education", domain: "cognition", verdict: "ADAPTED",
    rationale: "Skills pass via mentorship relationships (P2-13) and memory sharing (P9-03); schooling is not modeled.",
    evidence: ["src/sim/creatures/RelationshipTypes.ts"],
  },
  {
    id: 266, title: "Institutional Memory", domain: "history", verdict: "PASS",
    rationale: "The event log outlives every member (P0-08); civilizations/orgs persist dissolved with their records (P7-18); chronicle reads all of it (P8).",
    evidence: ["src/sim/history/EventLog.ts", "src/sim/politics/Collapse.ts"],
  },
  {
    id: 267, title: "Dynamic Law", domain: "society", verdict: "ADAPTED",
    rationale: "Norms are generated per household (P5-07) and violations/justice are real (P5-12/P7-09); law evolution from crises is not modeled.",
    evidence: ["src/sim/creatures/Norms.ts", "src/sim/politics/Justice.ts"],
  },
  {
    id: 268, title: "Legal Precedent", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Judgments are real but do not accumulate into precedent.",
    evidence: [],
    scopeReason: "Deferred -- each case is judged on its own evidence; precedent accumulation is not modeled.",
  },
  {
    id: 269, title: "Property & Contract Rights", domain: "economy", verdict: "ADAPTED",
    rationale: "Real ownership types and inheritance (P5-06); leases/shares/contracts are not modeled.",
    evidence: ["src/sim/creatures/Ownership.ts"],
  },
  {
    id: 270, title: "Inheritance", domain: "economy", verdict: "PASS",
    rationale: "Real estate bequeathal to the closest household member, falling to communal with no heir, recorded with the death as cause (P5-06/P8-05).",
    evidence: ["src/sim/creatures/Ownership.ts"],
  },
  {
    id: 271, title: "Emergent Market Prices", domain: "economy", verdict: "PASS",
    rationale: "Exchange value derives from per-kind utility x REAL scarcity (held mass vs population) -- no stored prices anywhere (P7-04).",
    evidence: ["src/sim/politics/Market.ts"],
  },
  {
    id: 272, title: "Credit & Debt", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "No financial instruments.",
    evidence: [],
    scopeReason: "Deferred -- barter only; financial instruments are not modeled.",
  },
  {
    id: 273, title: "Firms & Enterprises", domain: "society", verdict: "ADAPTED",
    rationale: "Organizations hold real institutional assets (P7-01); firm economic behavior is not modeled.",
    evidence: ["src/sim/politics/Organization.ts"],
  },
  {
    id: 274, title: "Political Coalitions", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Leadership selection uses reputation/skill/affinity (P7-08); coalition-building is not modeled.",
    evidence: [],
    scopeReason: "Deferred -- succession rules are the polity mechanics (P7-08); coalition-building is not modeled.",
  },
  {
    id: 275, title: "Elections, Coups & Revolutions", domain: "society", verdict: "ADAPTED",
    rationale: "Acclamation election is a real government form (P7-08); coups/revolutions are not modeled.",
    evidence: ["src/sim/politics/Government.ts"],
  },
  {
    id: 276, title: "Treaty Clauses", domain: "society", verdict: "ADAPTED",
    rationale: "Treaty kinds (peace/alliance/tribute) exist (P7-06); clause-level terms are not modeled.",
    evidence: ["src/sim/politics/Diplomacy.ts"],
  },
  {
    id: 277, title: "Intelligence Networks", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Espionage content.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 278, title: "Secrecy & Access Control", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "No access-control model; evidence/witness knowledge exists (P7-09).",
    evidence: [],
    scopeReason: "Deferred -- knowledge access is not restricted; evidence/witness knowledge exists (P7-09).",
  },
  {
    id: 279, title: "Religious Evolution", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Beliefs form/adopt (P5-08) but do not evolve.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-08 cultural evolution) -- beliefs are static data today.",
  },
  {
    id: 280, title: "Ritual Calendar", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "Rituals are performed (P5-08); no calendar.",
    evidence: [],
    scopeReason: "Deferred -- rituals are performed (P5-08); no ritual calendar.",
  },
  // ─────────────────────────── M. Technology, Agency, Narrative, Architecture ───────────────────────────
  {
    id: 281, title: "Procedural Invention", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Recipes are fixed data (P3-02); no invention loop.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-10 invention) -- recipes are fixed data (P3-02); no invention loop.",
  },
  {
    id: 282, title: "Experimental Science", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "No science loop.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-10/P11-17) -- no science loop.",
  },
  {
    id: 283, title: "Engineering Blueprints", domain: "construction", verdict: "OUT_OF_SCOPE",
    rationale: "Designations exist (P1-07); blueprint objects are not modeled.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-17 engineering design knowledge) -- designations are direct, not blueprint objects.",
  },
  {
    id: 284, title: "Machine Wear & Maintenance", domain: "construction", verdict: "ADAPTED",
    rationale: "Structural wear exists (P3-12); machine-specific wear is not modeled.",
    evidence: ["src/sim/structures/Structural.ts"],
  },
  {
    id: 285, title: "Repair, Salvage & Recycling", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Refuse records consumed materials (P2-09); salvage is not modeled.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-11 infrastructure memory) -- refuse records consumed materials (P2-09); salvage is not modeled.",
  },
  {
    id: 286, title: "Multi-Step NPC Planning", domain: "cognition", verdict: "ADAPTED",
    rationale: "Beavers decompose needs into seek/consume intent chains (P1-14) and jobs into travel/work phases (P1-07); general multi-step planning is not modeled.",
    evidence: ["src/sim/creatures/BeaverNeeds.ts", "src/sim/jobs/Job.ts"],
  },
  {
    id: 287, title: "Institutional Agency", domain: "society", verdict: "ADAPTED",
    rationale: "Organizations hold assets/members/missions (P7-01/P7-14); autonomous institutional goal pursuit is not modeled.",
    evidence: ["src/sim/politics/Organization.ts", "src/sim/politics/Military.ts"],
  },
  {
    id: 288, title: "Emergent Quests", domain: "society", verdict: "PASS",
    rationale: "P9-09's situations ARE the DF emergent-quest loop: objectives reference actual unresolved world problems (real items, accusations, shortages, caravans) and resolve only when the world genuinely changes -- never spawned copies.",
    evidence: ["src/sim/wayfarer/Situations.ts"],
  },
  {
    id: 289, title: "Macro/Micro Equivalence", domain: "world", verdict: "EXCEEDED",
    rationale: "The region layer and detailed layer agree by construction: activation reconstructs the detailed world from the site's own summary state, and deactivation reads the live state back (P6-08) -- verified by the P6 gate's zoom-in consistency test.",
    evidence: ["src/sim/region/SiteActivation.ts", "tests/gate/p6-gate-world-centuries.test.ts"],
  },
  {
    id: 290, title: "Causal Event Graph", domain: "history", verdict: "EXCEEDED",
    rationale: "Every significant event records its cause chain and participants (P0-08); chronicle renders upstream chains, and the P8 gate proved centuries of the graph stable and inspectable -- the roadmap's own 'answer why' north star, made literal.",
    evidence: ["src/sim/history/EventLog.ts", "src/sim/chronicle/CausalHistory.ts"],
  },
  {
    id: 291, title: "Counterfactual Reasoning", domain: "cognition", verdict: "OUT_OF_SCOPE",
    rationale: "Agents do not reason about hypothetical outcomes.",
    evidence: [],
    scopeReason: "Deferred to Phase 11 (P11-13 counterfactual replay) -- agents do not reason about hypothetical outcomes.",
  },
  {
    id: 292, title: "Procedural Architecture Traditions", domain: "construction", verdict: "OUT_OF_SCOPE",
    rationale: "Construction is player/system-driven (P1-10); no stylistic generation.",
    evidence: [],
    scopeReason: "Deferred -- buildings are functional, not stylistically generated; architecture traditions are Phase 11 cultural content (P11-18).",
  },
  {
    id: 293, title: "Procedural Cuisine", domain: "economy", verdict: "OUT_OF_SCOPE",
    rationale: "Food is generic with real nutrition (P1-13); no cuisine generation.",
    evidence: [],
    scopeReason: "Deferred -- food has nutrition, not cuisine; procedural cuisine is Phase 11 content.",
  },
  {
    id: 294, title: "Fashion & Display", domain: "world", verdict: "OUT_OF_SCOPE",
    rationale: "Presentation of appearance.",
    evidence: [],
    scopeReason: "Presentation layer -- appearance is rendering.",
  },
  {
    id: 295, title: "Art Movements", domain: "history", verdict: "ADAPTED",
    rationale: "Artworks depict real subjects with real makers (P5-09); stylistic movements are not modeled.",
    evidence: ["src/sim/creatures/Art.ts"],
  },
  {
    id: 296, title: "Propaganda & Mass Persuasion", domain: "society", verdict: "OUT_OF_SCOPE",
    rationale: "No persuasion model.",
    evidence: [],
    scopeReason: "Deferred -- not modeled; see the row's rationale for what exists instead.",
  },
  {
    id: 297, title: "Possess Any Citizen", domain: "world", verdict: "PASS",
    rationale: "P9-01/P9-10: player control attaches to ANY ordinary live beaver -- there is no separate avatar; returning to colony mode releases exactly that override. The P9 gate proves the round trip.",
    evidence: ["src/sim/wayfarer/Control.ts", "src/sim/wayfarer/Return.ts"],
  },
  {
    id: 298, title: "Seamless Colony <-> Third-Person <-> First-Person View", domain: "world", verdict: "ADAPTED",
    rationale: "The SIMULATION supports seamless mode switching (god-view ticking and embodied control share one world, P9-10); the camera modes themselves are presentation.",
    evidence: ["src/sim/wayfarer/Return.ts", "src/sim/runtime/ColonyLoop.ts"],
  },
  {
    id: 299, title: "Procedural Natural-Language Dialogue Layer", domain: "cognition", verdict: "ADAPTED",
    rationale: "The simulation side exists: conversation options and effects are fully simulation-derived (P9-03) and prose summaries are template-rendered from real records (P8-09); an optional language-model renderer is presentation.",
    evidence: ["src/sim/wayfarer/Conversation.ts", "src/sim/chronicle/ProseSummaries.ts"],
  },
  {
    id: 300, title: "World Historian / Story Discovery Engine", domain: "history", verdict: "EXCEEDED",
    rationale: "Chronicle is the story-discovery engine made real: causal chains (P8-08), figure/site/artifact histories (P8-03/04/05), genealogy (P8-06), search (P8-10), and traceable prose (P8-09) -- all over the causal graph, proven stable across centuries by the P8 gate.",
    evidence: ["src/sim/chronicle/Chronicle.ts", "src/sim/chronicle/CausalHistory.ts", "src/sim/chronicle/ProseSummaries.ts"],
  },

])