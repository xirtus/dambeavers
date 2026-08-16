# DAM BEAVERS — Full Systems Checklist

> **Design target:** A beaver-civilization simulator with the systemic depth, causal emergence, persistent history, and “anything can interact with anything” philosophy associated with *Dwarf Fortress*, but rebuilt around beaver biology, riparian ecology, hydraulic engineering, colony politics, and a modern simulation architecture.
>
> **Core rule:** Do not implement stories as scripts. Implement universal rules that can collide until stories happen by themselves.
>
> **Example:** We should never write `BEAVER_DROWNS_AFTER_DRUNKEN_LOG_ACCIDENT()`. We should implement fluid contamination, ingestion, intoxication, body mass, balance, current force, wet-surface traction, log momentum, swimming skill, fatigue, and rescue behavior—and allow the accident to emerge.

---

## Design Pillars

- [ ] **P1 — Beaver-first fiction.** Mechanics should feel native to a beaver civilization rather than dwarves wearing fur.
- [ ] **P2 — Water is terrain.** Rivers, ponds, groundwater, floods, ice, mud, sediment, and engineered flow are first-class simulation systems.
- [ ] **P3 — Construction is ecology.** Dams, canals, lodges, culverts, levees, and felled trees alter habitats and regional history.
- [ ] **P4 — Every object is physical.** Logs, branches, stones, food, tools, bodies, water, mud, and contaminants exist somewhere and move through the world.
- [ ] **P5 — Every beaver is historical.** Citizens have parents, memories, loyalties, skills, injuries, beliefs, relationships, possessions, and reputations.
- [ ] **P6 — Colonies are institutions.** Families, work crews, guilds, priesthoods, trading companies, councils, militias, and cults can outlive individuals.
- [ ] **P7 — Simulation over scripting.** Quests, disasters, conspiracies, romances, ecological crises, and wars should usually be discovered rather than authored.
- [ ] **P8 — Macro and micro agree.** An off-map watershed and a fully loaded 3D settlement should obey the same conceptual rules at different resolution.
- [ ] **P9 — Failure must be interesting.** Floods, famine, disease, structural collapse, political schism, predation, and engineering mistakes should create new stories.
- [ ] **P10 — Interoperability is content.** A system is valuable in proportion to how many unrelated systems it can affect.

---

# PART I — ORIGINAL CORE 1–100, ADAPTED FOR DAM BEAVERS

These correspond to the famous 2008 *Dwarf Fortress* Core 1–100 roadmap in spirit, but every item is reframed for a beaver civilization.

## A. Citizens, Adventure, Trade, and Immediate World Interaction

- [ ] **001. Grappling & Close Combat** — Bites, shoves, tail-strikes, wrestling, dragging, pinning, drowning attempts, and close-quarters fighting in water or on land.
- [ ] **002. Eating & Drinking** — Hunger, thirst, woody forage, bark, roots, aquatic plants, cultivated foods, preserved foods, and intoxicants.
- [ ] **003. Trade Caravans** — Merchant flotillas, pack-animal trains, log rafts, river barges, and overland traders physically move goods between settlements.
- [ ] **004. Ground & Shore Interaction** — Dig mud, move stones, strip bark, gather reeds, cut roots, clear debris, manipulate banks, and interact with shoreline terrain.
- [ ] **005. Overland / River Travel** — Characters travel through watersheds, rivers, lakes, forests, roads, tunnels, canals, and mountain passes.
- [ ] **006. Environmental Effects** — Rain, snow, ice, drought, heat, cold, wind, seasonal river flow, shade, and sunlight affect living things and materials.
- [ ] **007. Conversation** — Citizens exchange facts, rumors, requests, threats, promises, gossip, technical knowledge, and social information.
- [ ] **008. Shops & Markets** — Ownership, barter, currency where appropriate, market stalls, warehouses, river docks, and private inventories.
- [ ] **009. Towns & Settlements** — Procedurally generated pond-towns, canal cities, bank villages, lodge districts, hill settlements, and mixed-species trade sites.
- [ ] **010. Generalized Object Model** — Citizens, animals, plants, tools, structures, materials, liquids, organizations, documents, and events use extensible data-driven components.
- [ ] **011. Bonded Animals** — Replace dog/cat assumptions with river-ecosystem relationships: trained otters, geese, ducks, corvids, turtles, pack goats where culturally appropriate, or domesticated procedural species.
- [ ] **012. Colony Endgame I** — Founding failure, evacuation, conquest, ecological collapse, abandonment, or transformation into another polity.
- [ ] **013. Predator / Monster Attacks** — Wolves, bears, big cats, giant snapping turtles, monstrous fish, legendary predators, and generated megafauna attack settlements.
- [ ] **014. Fire** — Ignition, smoke, fuel, spread, heat damage, forest fire, lodge fire, peat fire, and steam interactions.
- [ ] **015. Important Figure Presentation** — Chiefs, engineers, prophets, merchants, war leaders, criminals, inventors, and elders are visible as historical people with motives.
- [ ] **016. Colony Endgame II** — Political fracture, forced migration, assimilation, dam failure, or succession outcomes persist in world history.
- [ ] **017. Legends & Chronicle** — Browse dynasties, dam projects, wars, floods, migrations, inventions, murders, artifacts, ecological disasters, and famous beasts.
- [ ] **018. Rebindable Controls** — Full keyboard/controller remapping and accessibility-aware input.
- [ ] **019. Tutorials** — Playable hydrology, survival, construction, logistics, combat, politics, and history tutorials.
- [ ] **020. Presentation / Intro Sequences** — Optional procedural title scenes, settlement flyovers, chronicle montages, and world-generation summaries.
- [ ] **021. Sound** — Water acoustics, chewing, falling timber, lodges, machinery, storms, wildlife, crowds, music, and contextual score.
- [ ] **022. Advisors** — Engineers, stewards, hydrologists, quartermasters, healers, scouts, and historians identify risks and opportunities.
- [ ] **023. In-Game Encyclopedia** — Searchable reference for materials, wildlife, hydraulic concepts, needs, laws, occupations, diseases, and mechanics.
- [ ] **024. Traveling Parties** — Multi-character expeditions with shared supplies, relationships, pack animals, boats, roles, and formation behavior.
- [ ] **025. Simulation-Driven Plot Cleanup** — Avoid hard-coded “story beats”; derive events from goals, institutions, world state, and causal chains.

## B. Armies, Territory, Persistence, and Civilization

- [ ] **026. Overland Army Attacks** — Enemy forces physically mobilize, travel, supply themselves, cross waterways, and approach from real world-map locations.
- [ ] **027. Beaver Armies & Militias** — Patrol rivers, guard dams, escort traders, raid enemies, defend fisheries, and project power beyond the home colony.
- [ ] **028. Territory & External Locations** — Colonies control watersheds, forests, quarries, fields, fisheries, fords, canals, mines, and tributaries.
- [ ] **029. External Constructions** — Build dams, levees, roads, bridges, canals, locks, watchposts, aqueducts, tunnels, dikes, logging camps, and reservoirs on the world map.
- [ ] **030. Polity Control** — A settlement can become the capital of a watershed-state and direct subordinate colonies.
- [ ] **031. Persistent Site Maps** — Caves, lodges, towns, ruins, dams, forts, sacred pools, mines, and camps have real spatial layouts.
- [ ] **032. Starting Objectives** — Contextual requests arise from actual world conditions: stabilize a river, reopen a trade route, settle refugees, repair an ancient dam, etc.
- [ ] **033. Service to the Crown / Council** — Higher authorities can demand timber, food, soldiers, taxes, engineering work, or diplomatic service.
- [ ] **034. Abandonment** — Evacuated settlements remain in the world, decay, flood, burn, rewild, or get resettled.
- [ ] **035. Raids** — Dispatch citizens to steal resources, free captives, sabotage dams, destroy infrastructure, or seize strategic sites.
- [ ] **036. Work Zones / Burrows** — Restrict citizens by district, island, pond, tunnel network, emergency refuge, nursery, military sector, or work territory.
- [ ] **037. Retirement & Re-entry** — Retired characters persist and can later reappear as elders, rivals, rulers, hermits, merchants, or legends.
- [ ] **038. Abstract Site Resources** — Off-map sites retain inventories, population, food, timber, tools, boats, livestock, structures, and military capacity.
- [ ] **039. Colony Endgame III** — Lost settlements become ruins, conquered provinces, refugee sources, ecological hazards, myths, or future adventure sites.
- [ ] **040. Legendary Beasts** — Unique generated creatures develop territories, kills, injuries, grudges, lairs, trophies, and historical reputations.
- [ ] **041. Homes, Lodges & Daily Schedules** — Families sleep, eat, groom, socialize, maintain lodges, raise kits, work, travel, and rest.
- [ ] **042. Personal & Household Goods** — Tools, bedding, food stores, ornaments, toys, books, heirlooms, and clothing belong to individuals or families.
- [ ] **043. Civic Locations** — Council chambers, flood halls, markets, temples, schools, guildhouses, archives, dockyards, hospitals, and great lodges.
- [ ] **044. Migration** — Refugees, pioneers, workers, religious groups, displaced families, and merchants physically move through the world.
- [ ] **045. Civilizations at War** — Polities declare war over water rights, territory, trade, ideology, dynastic disputes, resources, or historic grievances.
- [ ] **046. Off-Map Battles** — Armies fight, capture citizens, seize dams, destroy settlements, raid food stores, and alter borders.
- [ ] **047. Historical Data Abstraction** — Compress trivial events while preserving causes, relationships, ownership, ancestry, injuries, and major consequences.
- [ ] **048. Seamless Regional Space** — Rivers, roads, canals, forests, caves, and settlements connect continuously instead of functioning as disconnected stages.
- [ ] **049. Full 3D Terrain** — Water depth, banks, underground burrows, multi-story structures, cliffs, tunnels, reservoirs, and canopy height matter.
- [ ] **050. Flexible Visual Representation** — Simulation is independent from renderer; support rich 3D, schematic views, overlays, and modded visual sets.

## C. Interface, Logistics, Family, Diplomacy, and Hidden World

- [ ] **051. Resizable / Scalable UI** — Responsive desktop, ultrawide, handheld, and high-DPI layouts.
- [ ] **052. Interface Overhaul Layer** — Search, filters, context actions, inspect mode, overlays, notifications, timelines, and command palettes.
- [ ] **053. Data-Driven Definitions** — Species, plants, materials, jobs, structures, reactions, cultures, diseases, artifacts, and world rules are mod-data.
- [ ] **054. Localization** — UI and generated-language rendering support multiple real-world languages.
- [ ] **055. Lighting & Visibility** — Day/night, underwater visibility, murk, moonlight, firelight, bioluminescence, and enclosed darkness affect perception.
- [ ] **056. Settlement Transportation** — Log rafts, sledges, boats, carts, draft animals, canals, chutes, lifts, cranes, and conveyors improve logistics.
- [ ] **057. Automation** — Production rules, water-level triggers, floodgates, stock thresholds, scheduled maintenance, emergency policies, and manager logic.
- [ ] **058. Documentation System** — Tooltips, mechanic links, failure explanations, system inspectors, and discoverable simulation rules.
- [ ] **059. Love & Pair Bonds** — Courtship, attraction, pair bonding, separation, jealousy, affection, partnership, and culturally variable family structures.
- [ ] **060. Kits, Families & Succession** — Children inherit ancestry, property, expectations, titles, genes, relationships, and historical significance.
- [ ] **061. Player-Founded Organizations** — Adventuring groups, engineering companies, guilds, communes, cults, militias, and expeditions become historical entities.
- [ ] **062. Diplomacy** — Negotiation over trade, water, borders, migrants, criminals, marriages, hostages, military passage, fishing rights, and construction projects.
- [ ] **063. Succession, Schism & Conflict** — Leadership death or ideological division can split colonies, religions, guilds, or states.
- [ ] **064. Personal Affiliations** — A citizen may be loyal to family, profession, temple, company, friend, ruler, and homeland in conflicting ways.
- [ ] **065. Reputation & Membership** — Characters accumulate rank, trust, infamy, citizenship, professional status, religious standing, and local reputation.
- [ ] **066. Hidden World Systems** — Deep ruins, ancient species, forgotten hydrological machinery, underworld ecologies, cursed reservoirs, and secret civilizations.
- [ ] **067. Ruins** — Failed settlements preserve architecture, objects, bones, records, altered river courses, contaminants, and ecological consequences.
- [ ] **068. Cemeteries & Memorials** — Burial, water burial, cairns, tombs, ancestor lodges, memorial trees, relic keeping, and funerary customs.
- [ ] **069. Old Battlefields** — Weapons, bodies, fortifications, unexploded hazards, scorched forest, polluted water, monuments, and myths persist.
- [ ] **070. Settlement Archaeology** — Ruins preserve workshop layouts, export goods, family spaces, architectural phases, inscriptions, and evidence of their collapse.
- [ ] **071. Bandits, River Pirates & Cults** — Independent organizations occupy hidden coves, abandoned lodges, marshes, caves, and trade routes.
- [ ] **072. Developing Attributes** — Strength, endurance, swimming, dexterity, bite force, perception, memory, empathy, discipline, and other traits change through life.
- [ ] **073. Advanced Combat** — Weapon skill, biting, grappling, shields, formation fighting, water combat, ambush, armor, terrain, and technique.
- [ ] **074. Persistent Injuries** — Scars, missing digits, damaged tails, infected bites, broken teeth, impaired swimming, chronic pain, and disability.
- [ ] **075. Historically Generated Characters** — Adventurers and important citizens originate from real families, places, professions, wars, and cultural histories.

## D. Population, Crime, Ecology, Magic, and Procedural Culture

- [ ] **076. Historically Generated Embarks** — New settlements begin because of migrations, political grants, disasters, schisms, trade plans, wars, or ecological pressure.
- [ ] **077. Population Lifecycle** — Birth, childhood, maturation, aging, pair formation, fertility, mortality, and migration continue across the whole world.
- [ ] **078. Wildlife Population Tracking** — Fish, predators, herbivores, birds, insects, amphibians, and aquatic life have persistent populations.
- [ ] **079. Collectors & Specialized Demand** — Citizens and institutions desire rare woods, stones, shells, artwork, relics, books, foods, trophies, and tools.
- [ ] **080. Artifact Powers** — Optional fantastic mode where historically unique objects can acquire generated supernatural properties.
- [ ] **081. Tribute Networks** — Timber, grain, crafted goods, ore, labor, coin, hostages, or military support physically move between political entities.
- [ ] **082. Theft Ecosystem** — Thieves, fences, informants, smugglers, black markets, accomplices, stolen-goods provenance, and uncertain perpetrators.
- [ ] **083. Arrest, Trial & Punishment** — Investigation, accusation, testimony, evidence, imprisonment, restitution, exile, fines, execution, and pardon.
- [ ] **084. Foraging, Fishing & Wild Harvest** — Collect bark, reeds, berries, tubers, shellfish, fish, herbs, fungi, timber, clay, stone, and medicinal plants.
- [ ] **085. Field Construction** — Characters can dig, fell, dredge, dam, build, tunnel, reinforce, plant, and repair while outside settlement mode.
- [ ] **086. Personal Craft & Profession Skills** — Adventurers can actually perform carpentry, masonry, medicine, cooking, trapping, engineering, research, and trade.
- [ ] **087. Proper Beaver Civilization** — Beaver society is not “human society with tails”: family lodges, scent communication, swimming, gnawing, dam instincts, riparian engineering, seasonal work, and colony ecology shape behavior.
- [ ] **088. Proper Neighbor Species Cultures** — Otter, muskrat, raccoon, crow, turtle, capybara, human, or procedural sapient neighbors have genuinely different economies and lifeways.
- [ ] **089. Proper Hostile Cultures** — Rival species and hostile beaver polities have distinct institutions, warfare, settlement design, values, and survival strategies.
- [ ] **090. Proper Small-Scale / Tribal Cultures** — Nomadic wetland groups, scavenger societies, secretive burrowers, and hunter cultures use different social and economic rules.
- [ ] **091. Deep Underground & Watershed Features** — Aquifers, caves, springs, sinkholes, buried rivers, geothermal zones, fossil beds, and ancient hydraulic works.
- [ ] **092. Individual Appearance** — Fur color, scars, size, teeth, tail shape, posture, age, ornaments, clothing, grooming, and inherited traits vary.
- [ ] **093. Procedural Megafauna** — Generate legendary predators and monsters from anatomy, materials, behaviors, powers, habitat, and history.
- [ ] **094. Procedural Regions / Flora / Fauna** — Wetlands, forests, marshes, floodplains, alpine streams, tainted waters, magical biomes, and custom ecologies.
- [ ] **095. Procedural Peoples** — Optional worldgen can create sapient species and cultures with generated biology, ethics, architecture, economy, and language.
- [ ] **096. Generalized Transformations** — Disease, curse, mutation, parasitism, magical alteration, injury, aging, and augmentation use shared effect systems.
- [ ] **097. Semantic Phrase Storage** — Store meaning separately from rendered text so rumors, inscriptions, dialogue, and translation operate on concepts.
- [ ] **098. Procedural Grammar** — Generated languages have syntax, morphology, naming conventions, idioms, honorifics, and historical change.
- [ ] **099. Writing & Inscription** — Characters write on bark sheets, carved wood, stone tablets, cloth, paper, walls, signs, maps, legal records, and monuments.
- [ ] **100. Cultural Works** — Books, maps, engineering diagrams, songs, myths, laws, poems, scientific treatises, genealogies, chronicles, and correspondence are persistent objects.

---

# PART II — MODERN PARITY SYSTEMS, REFRAMED FOR DAM BEAVERS

These are concrete systems needed to reach the level of interaction players now expect from a mature *Dwarf Fortress*-style simulation.

## E. Anatomy, Materials, Medicine, and Contamination

- [ ] **101. Layered Anatomy** — Head, torso, paws, tail, eyes, ears, teeth, bones, organs, blood vessels, and other parts can be individually affected.
- [ ] **102. Tissue Layers** — Fur, skin, fat, muscle, tendon, bone, nerve, organ tissue, and tooth material behave differently.
- [ ] **103. Material Properties** — Density, hardness, elasticity, fracture behavior, melting point, ignition point, absorbency, porosity, value, and toxicity.
- [ ] **104. Body Size & Mass** — Age, nutrition, species, pregnancy, equipment, and body condition alter momentum, buoyancy, dosing, strength, and injury.
- [ ] **105. Organ Function** — Lung damage, brain trauma, heart injury, damaged eyes, broken teeth, and tail injury have meaningful consequences.
- [ ] **106. Blood & Hemorrhage** — Blood volume, bleeding rate, clotting, blood loss, and environmental contamination.
- [ ] **107. Pain** — Pain affects mood, movement, work, consciousness, compliance, and combat.
- [ ] **108. Stun / Shock / Unconsciousness** — Incapacitation exists separately from death.
- [ ] **109. Infection** — Dirty bites, contaminated water, surgery, and untreated wounds can infect.
- [ ] **110. Necrosis & Tissue Death** — Severe injury, infection, freezing, burns, or circulation loss can permanently destroy tissue.
- [ ] **111. Diagnosis** — Healers must discover symptoms, causes, internal injuries, toxins, and diseases with imperfect information.
- [ ] **112. Surgery** — Extraction, repair, amputation, cleaning, drainage, and other procedures act on actual anatomy.
- [ ] **113. Sutures, Dressings & Cleaning** — Treatment uses specific supplies and targets specific wound states.
- [ ] **114. Splints, Braces & Rehabilitation** — Broken limbs and damaged tails require support, rest, and recovery.
- [ ] **115. Hospital Logistics** — Beds, clean water, soap, bandages, herbs, tools, heat, food, sanitation, and skilled labor must all arrive physically.
- [ ] **116. Syndrome Framework** — Generic timed effects support poison, illness, intoxication, venom, magic, allergy, radiation-like fantasy effects, and medicines.
- [ ] **117. Venoms & Toxins** — Bite, ingestion, inhalation, eye exposure, skin contact, or embedded material can deliver harmful substances.
- [ ] **118. Contaminants** — Mud, blood, oil, alcohol, poison, spores, sewage, ash, salt, disease, and chemicals adhere to fur, paws, tools, food, and surfaces.
- [ ] **119. Embedded / Severed Objects** — Splinters, arrows, teeth, shards, severed tissue, and lodged debris remain physical.
- [ ] **120. Intoxication** — Dose, body mass, metabolism, repeated exposure, tolerance, behavior, vomiting, unconsciousness, and poisoning.

## F. Underground, Physics, Logistics, Machines, and Waterworks

- [ ] **121. Layered Caverns** — Underground burrow networks, caves, buried rivers, aquifers, mines, roots, and ruins.
- [ ] **122. Underground Ecology** — Fungi, roots, insects, blind fish, amphibians, cave predators, and microbes form real ecosystems.
- [ ] **123. Procedural Subterranean Creatures** — Generated cave horrors and ancient organisms occupy persistent habitats.
- [ ] **124. Temperature & Phase Change** — Water freezes/thaws, steam forms, fat melts, food cools, metal heats, ice jams rivers, and materials change phase.
- [ ] **125. Collapse & Cave-In** — Banks, tunnels, dams, roofs, snow, unstable soil, and unsupported structures can fail.
- [ ] **126. Falling Physics** — Characters, stones, logs, water, debris, carts, and animals fall through vertical space.
- [ ] **127. Cart / Sledge / Raft Dynamics** — Mass, slope, current, friction, buoyancy, collisions, and load distribution matter.
- [ ] **128. Projectile Motion** — Arrows, stones, thrown tools, siege ammunition, falling branches, and debris travel physically.
- [ ] **129. Momentum & Collision** — Heavy logs, flood debris, carts, falling rocks, animals, and bodies transfer force.
- [ ] **130. Sliding, Tumbling & Impact** — Mud, ice, steep banks, moving water, and collisions can knock characters off balance.
- [ ] **131. Hauling Routes** — Repeated logistics networks for food, timber, stone, waste, ore, fish, water, and trade goods.
- [ ] **132. Route Stops & Transfer Rules** — Load/unload conditions, priorities, limits, departure triggers, and destination rules.
- [ ] **133. Wheelbarrows / Sledges / Carriers** — Equipment modifies carrying capacity, speed, fatigue, and terrain access.
- [ ] **134. Containerized Hauling** — Baskets, crates, sacks, barrels, sledges, boats, and pallets move many items at once.
- [ ] **135. Stockpile Links** — Explicit source/sink rules prevent vital resources from being consumed by the wrong workshop.
- [ ] **136. Workshop Supply Links** — Buildings request and reserve particular resource classes.
- [ ] **137. Mechanical Power Networks** — Water wheels, windmills, gears, axles, ropes, pulleys, pumps, gates, mills, cranes, and powered workshops.
- [ ] **138. Pumping & Flow Engineering** — Pumps, floodgates, siphons, locks, sluices, drainage galleries, canals, and lift systems redirect fluids.
- [ ] **139. Aquifers & Groundwater** — Permeable layers, springs, seepage, water table, wells, drainage, contamination, and seasonal groundwater.
- [ ] **140. Multi-Tile Trees & Woody Plants** — Trees have roots, trunks, limbs, crown geometry, stored carbon, health, weight, nesting habitat, and fall direction.

## G. Psychology, Relationships, Culture, Knowledge, and Daily Life

- [ ] **141. Personality Traits** — Industriousness, curiosity, anxiety, aggression, patience, sociability, empathy, risk tolerance, neatness, ambition, etc.
- [ ] **142. Personal Values** — Family, craft, nature, wealth, hierarchy, freedom, tradition, science, religion, beauty, courage, mercy, and other ideals.
- [ ] **143. Emotion Model** — Events produce emotions through personality, expectation, relationship, cultural interpretation, and perceived responsibility.
- [ ] **144. Long-Term Stress** — Chronic danger, overcrowding, grief, hunger, overwork, noise, isolation, humiliation, or insecurity accumulate.
- [ ] **145. Short-Term Memory** — Recent events influence decisions and conversations.
- [ ] **146. Long-Term Memory** — Traumas, triumphs, betrayals, rescues, discoveries, relationships, and major works persist for years.
- [ ] **147. Personality Change** — War, parenting, loss, success, education, addiction, injury, and aging can change values and traits.
- [ ] **148. Needs** — Social contact, family, grooming, swimming, gnawing, creative work, worship, learning, privacy, nature, exercise, rest, accomplishment, and play.
- [ ] **149. Relationship Graph** — Family, friends, rivals, lovers, mentors, apprentices, coworkers, rescuers, enemies, debtors, patrons, and political allies.
- [ ] **150. Taverns / Fermentation Halls** — Drinking, gossip, music, meals, visitors, arguments, hiring, gambling where culturally allowed, and rumor exchange.
- [ ] **151. Inns / Guest Lodges** — Travelers, diplomats, scholars, merchants, pilgrims, refugees, and mercenaries need accommodation.
- [ ] **152. Temples & Sacred Water Sites** — Organized worship, ritual pools, ancestor shrines, holy dams, pilgrimage sites, clerics, and offerings.
- [ ] **153. Libraries & Archives** — Store maps, laws, hydraulic plans, histories, research, literature, and correspondence.
- [ ] **154. Procedural Poetry** — Cultures create poetic forms tied to meter, repetition, water imagery, genealogy, labor, or ritual.
- [ ] **155. Procedural Music** — Musical traditions, rhythm, instrumentation, social context, and compositions.
- [ ] **156. Procedural Dance / Ritual Movement** — Courtship displays, festivals, martial dances, work songs with choreography, and religious movement.
- [ ] **157. Procedural Instruments** — Drums, flutes, rattles, string instruments, water organs, resonant logs, bells, and generated constructions.
- [ ] **158. Performances** — Citizens perform myths, songs, poetry, dances, speeches, trials, ceremonies, and historical reenactments.
- [ ] **159. Knowledge Domains** — Hydrology, medicine, botany, carpentry, law, astronomy, engineering, metallurgy, ecology, theology, mathematics, etc.
- [ ] **160. Research** — Scholars observe, theorize, experiment, argue, publish, and discover.
- [ ] **161. Mentorship & Apprenticeship** — Skill and knowledge move between individuals through teaching relationships.
- [ ] **162. Books, Scrolls, Maps & Plans** — Knowledge exists in physical objects that can be copied, stolen, burned, hidden, inherited, or traded.
- [ ] **163. Scribes & Copying** — Reproduction consumes labor, writing surfaces, inks, storage, and access to originals.
- [ ] **164. Visitors** — Historical figures can arrive for trade, worship, diplomacy, study, migration, tourism, crime, or adventure.
- [ ] **165. Residency & Citizenship** — Visitors can petition to remain, form households, take jobs, join institutions, and become politically integrated.

## H. Institutions, Crime, Religion, Diplomacy, and Activated World History

- [ ] **166. Guilds & Professional Orders** — Engineers, carpenters, healers, fishers, loggers, masons, scholars, boatbuilders, traders, and artists organize.
- [ ] **167. Guildhalls** — Organizations demand meeting halls, workshops, archives, symbols, officers, and prestige.
- [ ] **168. Organized Religions** — Faiths have doctrines, institutions, sacred places, internal factions, property, clergy, and political relationships.
- [ ] **169. Priesthoods** — Clerical offices, succession, hierarchy, duties, vows, and status.
- [ ] **170. Sermons & Pastoral Care** — Clerics teach, comfort, condemn, counsel, perform rites, and influence beliefs.
- [ ] **171. Petitions** — Workers, guilds, migrants, faiths, neighborhoods, and families submit requests or demands to authorities.
- [ ] **172. Artifact Provenance** — Famous tools, crowns, weapons, carvings, maps, relics, and inventions retain ownership history.
- [ ] **173. Relics** — Objects become sacred or politically important because of association, belief, history, or propaganda.
- [ ] **174. Displays & Museums** — Artifacts can be exhibited, guarded, interpreted, copied, stolen, and used for prestige.
- [ ] **175. False Identities** — Spies, fugitives, criminals, and infiltrators can maintain cover identities.
- [ ] **176. Agents & Covers** — Intelligence actors choose plausible occupations, relationships, travel patterns, and stories.
- [ ] **177. Corruption** — Officials can accept bribes, embezzle, manipulate contracts, steal supplies, protect criminals, or falsify records.
- [ ] **178. Criminal Networks** — Smugglers, thieves, pirates, assassins, fences, corrupt officials, and patrons form organizations.
- [ ] **179. Traitors & Internal Saboteurs** — Citizens may betray the colony for ideology, coercion, debt, revenge, foreign loyalty, or personal gain.
- [ ] **180. Artifact Heists** — Plans can involve casing, bribery, forged access, distraction, theft, transport, fencing, and recovery.
- [ ] **181. Interrogation & Testimony** — Information depends on memory, loyalty, fear, deception, coercion, evidence, and credibility.
- [ ] **182. Counterintelligence** — Investigators map associates, motives, communications, finances, travel, and suspicious access.
- [ ] **183. Multi-Agent Conspiracies** — Assassination, coup, sabotage, smuggling, theft, cult activity, and political manipulation are coordinated plans.
- [ ] **184. Activated World Simulation** — Migration, births, deaths, politics, trade, wars, discoveries, ecological change, and construction continue everywhere.
- [ ] **185. Off-Site Birth & Death** — Families and populations change beyond the loaded map.
- [ ] **186. Off-Site Marriage & Succession** — Dynasties, titles, inheritances, and alliances change while the player is elsewhere.
- [ ] **187. Dynamic Settlement Foundation** — Refugees, traders, religious groups, colonists, armies, and entrepreneurs can create new sites.
- [ ] **188. Site Conquest** — Settlements change rulers, populations, laws, faiths, tribute obligations, and architecture.
- [ ] **189. Holdings & Dependencies** — A player colony can control logging camps, fisheries, farms, quarry towns, forts, canals, and tributary settlements.
- [ ] **190. Administrators** — Governors, reeves, engineers, judges, tax collectors, quartermasters, and messengers execute policy away from the capital.
- [ ] **191. Pillaging & Requisition** — Military forces seize supplies, boats, livestock, timber, tools, food, valuables, or hostages.
- [ ] **192. Razing & Infrastructure Destruction** — Armies can burn lodges, breach dams, destroy bridges, poison wells, cut canals, or fell orchards.
- [ ] **193. Tribute & Vassalage** — Subordinate sites periodically transfer resources, military aid, labor, information, or political support.
- [ ] **194. Messengers & Envoys** — Diplomacy travels through actual characters who can be delayed, killed, bribed, lost, or defect.
- [ ] **195. Dynamic War / Peace / Alliances / Trade** — Relations change through treaties, provocations, dynastic links, resource needs, ideology, and player action.

## I. Combat, Expeditions, Sieges, Work Management, and Modding

- [ ] **196. Off-Site Skill Growth** — Expeditions and military missions improve or degrade skills based on what actually happened.
- [ ] **197. Military Tactics** — Leadership, reconnaissance, terrain, logistics, morale, formation, surprise, and command quality shape battle outcomes.
- [ ] **198. Multi-Character Adventure Parties** — Player-controlled expeditions with companions, animals, boats, provisions, roles, and shared history.
- [ ] **199. Tactical Party Orders** — Protect, hold, flank, retreat, rescue, suppress, scout, pursue, avoid water, defend a bridge, etc.
- [ ] **200. Mounts & Rideable Creatures** — Where fiction permits, larger allied species can be ridden; alternatively use boats as the primary mobility analogue.
- [ ] **201. Pack Animals & Cargo Companions** — Appropriate domesticated species or procedural fauna carry goods; river transport remains culturally dominant.
- [ ] **202. Persistent Pets / Companions** — Bonded otters, ducks, geese, ravens, turtles, fish, or generated domestic fauna can have names, skills, injuries, loyalty, and descendants.
- [ ] **203. Historical Background Selection** — Adventurers begin as refugees, engineers, merchants, soldiers, scholars, criminals, nobles, fishers, etc. from actual sites.
- [ ] **204. Belief / Religion Background** — Characters begin with culturally consistent faith, skepticism, sect membership, values, and taboos.
- [ ] **205. Starting Equipment Loadout** — Tools, clothing, weapons, maps, food, medicine, boats, heirlooms, and money reflect history and profession.
- [ ] **206. Ranged Loading & Preparation** — Bows, slings, crossbows, spear throwers, blowpipes, or fantastical equivalents have physical reload sequences.
- [ ] **207. Anatomical Aiming** — Ranged attacks can target eyes, paws, tail, head, torso, weapon arm, or exposed organs.
- [ ] **208. Distance-Based Accuracy** — Range, lighting, wind, movement, posture, fatigue, skill, and weapon design affect shots.
- [ ] **209. Fortification-Aware Ranged AI** — Defenders seek firing slits, towers, bank cover, boats, islands, trees, and protected angles.
- [ ] **210. Adaptive Siege Planning** — Attackers inspect walls, dams, water routes, weak banks, bridges, tunnels, gates, supply routes, and defenders.
- [ ] **211. Enemy Digging** — Siegers tunnel, undermine levees, breach banks, cut bypass channels, and excavate around defenses.
- [ ] **212. Enemy Construction** — Build ramps, rafts, bridges, siege towers, causeways, temporary dams, ladders, and field fortifications.
- [ ] **213. Enemy Deconstruction** — Break doors, gates, supports, bridges, machines, dams, stockades, and water-control structures.
- [ ] **214. Battering / Breaching Machines** — Rams, drills, wedges, winches, pile drivers, and other machines attack structures.
- [ ] **215. Danger Memory** — Attackers remember traps, drowning zones, collapse points, kill corridors, ambushes, and failed routes.
- [ ] **216. Tactical Siege Roles** — Engineers, swimmers, scouts, archers, shield troops, saboteurs, medics, haulers, officers, and shock units.
- [ ] **217. Historical Commanders** — Siege leaders are persistent people with tactics, traits, grudges, injuries, and reputations.
- [ ] **218. Siege Engines** — Ballistae, catapults, log throwers, water-powered defenses, fire projectors, or fantasy machines use physical ammunition.
- [ ] **219. Structural Material Resistance** — Wood species, stone, soil, ice, reinforcement, moisture, decay, and construction quality affect durability.
- [ ] **220. Reinforcement** — Pilings, cribwork, stone facing, timber bracing, clay cores, revetments, and engineered layering improve structures.
- [ ] **221. Work Details** — Define teams, professions, allowed tasks, emergency crews, seasonal crews, and exclusive specialists.
- [ ] **222. Job Priority** — Critical dam breach > drowning rescue > fire > medicine > food > hauling > beautification, according to policy and circumstance.
- [ ] **223. Manager Work Orders** — Conditional production based on stock, population, season, weather forecast, military state, water level, or institutional demand.
- [ ] **224. Difficulty as Parameters** — Predator frequency, enemy sophistication, climate volatility, disease, scarcity, world hostility, and simulation burden are tunable.
- [ ] **225. Data-Driven & Scriptable Modding** — Species, cultures, materials, jobs, reactions, worldgen, UI, behaviors, scenario rules, and generated content should be extensible.

---

# PART III — NEXT-GENERATION SYSTEMS UNIQUE TO DAM BEAVERS

These are the systems that should let the game surpass a straight *Dwarf Fortress* clone.

## J. Advanced Physical World & Hydrology

- [ ] **226. Atmospheric Gas Simulation** — Oxygen, CO₂, smoke, steam, methane, swamp gas, toxic fumes, and dust occupy spaces and move through ventilation.
- [ ] **227. Air Pressure** — Sealed burrows, pipe systems, bellows, compressed air, steam pressure, and sudden pressure changes matter.
- [ ] **228. Ventilation** — Chimneys, shafts, fans, convection, wind, open doors, tunnels, and machinery alter air quality.
- [ ] **229. Fluid Mixtures** — Water can simultaneously contain salt, mud, blood, alcohol, sewage, poison, microbes, silt, oil, minerals, or dyes.
- [ ] **230. Dissolved Chemistry** — Solutes dissolve, precipitate, react, dilute, concentrate, and travel with water.
- [ ] **231. Humidity & Evaporation** — Moisture affects wood swelling, rot, mold, food, comfort, evaporation, cooling, and fire risk.
- [ ] **232. Thermodynamics** — Heat conducts through materials, convects through fluids, radiates from sources, and accumulates in enclosed spaces.
- [ ] **233. Combustion Chemistry** — Fuel, oxygen, moisture, temperature, airflow, and material determine ignition and burn behavior.
- [ ] **234. Explosions & Pressure Events** — Steam, gas, combustible dust, sealed vessels, magical substances, or industrial accidents can explode emergently.
- [ ] **235. Structural Load Simulation** — Weight travels through beams, pilings, walls, foundations, banks, dams, bridges, trees, and machines.
- [ ] **236. Material Fatigue & Decay** — Repeated loading, freeze-thaw, rot, rust, abrasion, gnawing, current, insects, and poor maintenance weaken structures.
- [ ] **237. Soil Mechanics** — Clay, silt, sand, gravel, peat, mud, loam, and saturated soil differ in bearing capacity, erosion, slumping, tunneling, and seepage.
- [ ] **238. Erosion & Sediment Transport** — Moving water scours banks, transports sediment, deposits deltas, silts reservoirs, and changes channels.
- [ ] **239. Watershed Hydrology** — Rainfall becomes runoff, infiltration, groundwater, streams, rivers, ponds, wetlands, and flood pulses.
- [ ] **240. Dynamic Weather** — Moving fronts, storms, snowmelt, drought, heat waves, atmospheric rivers, lightning, wind, and seasonal patterns affect the map.

## K. Biology, Disease, Ecology, Agriculture, and Food

- [ ] **241. Scent Simulation** — Odors spread by air and water; beavers use scent mounds, predators track prey, and criminals can be followed.
- [ ] **242. Microbiology** — Bacteria, fungi, mold, yeast, and decomposers transform food, waste, bodies, soil, and water.
- [ ] **243. Food Spoilage** — Heat, moisture, contamination, oxygen, storage method, microbes, and food composition determine decay.
- [ ] **244. Fermentation** — Brewing, souring, pickling, cheese-like products, preserved foods, and accidental fermentation emerge from microbes + ingredients + environment.
- [ ] **245. Epidemiology** — Infection spreads through contact, droplets, water, food, vectors, surfaces, blood, and migration networks.
- [ ] **246. Immune Systems** — Species resistance, prior exposure, nutrition, age, stress, genetics, and treatment affect illness.
- [ ] **247. Genetics** — Size, fur, disease susceptibility, metabolism, temperament predispositions, teeth, fertility, and other traits inherit.
- [ ] **248. Mutation & Population Change** — Long-term populations genetically drift or adapt under isolation, selection, catastrophe, magic, or contamination.
- [ ] **249. Real Food Webs** — Plants, insects, fish, herbivores, predators, scavengers, decomposers, and beavers affect one another’s populations.
- [ ] **250. Animal Territories & Migration** — Dens, nests, spawning grounds, migration routes, seasonal ranges, and territorial disputes persist.
- [ ] **251. Ecological Succession** — Clearcuts, burns, abandoned farms, dried ponds, flooded valleys, and ruins pass through changing ecological stages.
- [ ] **252. Extinction & Invasive Species** — Colonization, trade, climate, hunting, damming, pollution, and war can permanently alter biodiversity.
- [ ] **253. Soil Nutrients** — Nitrogen-like fertility, organic matter, waterlogging, salinity, contamination, and erosion affect crops and vegetation.
- [ ] **254. Crop Rotation & Land Stewardship** — Different plants, fallow periods, flooding, compost, manure, and mulch alter long-term soil productivity.
- [ ] **255. Nutrition & Metabolism** — Calories, protein, fat, fiber, minerals, vitamins, hydration, toxins, and energy expenditure affect bodies.

## L. Mind, Belief, Information, Law, Economy, and Society

- [ ] **256. Attention** — Citizens notice only a limited set of nearby events based on salience, role, stress, noise, visibility, and focus.
- [ ] **257. Working Memory** — Decision making uses a constrained active set of goals, facts, emotions, and perceptions.
- [ ] **258. Belief Graphs** — Separate objective world state from what each citizen thinks is true.
- [ ] **259. Confidence & Uncertainty** — Beliefs have confidence, source reliability, contradiction, and revision rather than binary knowledge.
- [ ] **260. Rumor Mutation** — Retelling compresses, exaggerates, distorts, moralizes, merges, or forgets details.
- [ ] **261. Information Provenance** — Track who observed, inferred, wrote, copied, translated, forged, or repeated each important claim.
- [ ] **262. Language Drift** — Vocabulary, pronunciation, grammar, names, and meanings change over generations.
- [ ] **263. Dialects & Sociolects** — River basins, professions, classes, religions, armies, and age groups develop speech differences.
- [ ] **264. Literacy** — Reading, writing, numeracy, map use, and technical literacy vary by citizen and culture.
- [ ] **265. Education** — Parents, apprenticeships, schools, guilds, military service, temples, books, and self-study transmit knowledge.
- [ ] **266. Institutional Memory** — Archives, bureaucracies, guilds, temples, firms, and states retain knowledge independently of current members.
- [ ] **267. Dynamic Law** — Societies generate laws from values, crises, institutions, precedent, class interests, religion, and political bargaining.
- [ ] **268. Legal Precedent** — Past rulings influence future judgments, interpretations, rights, and expectations.
- [ ] **269. Property & Contract Rights** — Ownership can include use rights, leases, shares, inheritance claims, water access, fishing rights, and collateral.
- [ ] **270. Inheritance** — Goods, homes, workshops, debts, titles, intellectual property, water rights, and family obligations transfer after death.
- [ ] **271. Emergent Market Prices** — Supply, demand, transport cost, scarcity, quality, season, risk, monopoly, and expectations determine price.
- [ ] **272. Credit & Debt** — Loans, tabs, bonds, collateral, interest, defaults, debt slavery where culturally present, and financial crises.
- [ ] **273. Firms & Enterprises** — Citizens form mills, shipping companies, fisheries, breweries, engineering firms, shops, mines, farms, and banks.
- [ ] **274. Political Coalitions** — Leaders require supporters across families, guilds, neighborhoods, military units, religions, firms, and regions.
- [ ] **275. Elections, Coups & Revolutions** — Leadership changes emerge from rules, legitimacy, organization, grievances, force, propaganda, and opportunity.
- [ ] **276. Treaty Clauses** — Borders, river navigation, dam operation, fishing rights, trade, tribute, extradition, military access, hostages, and joint projects.
- [ ] **277. Intelligence Networks** — Informants, handlers, couriers, cells, safe houses, bribery, observation, interception, and counterintelligence.
- [ ] **278. Secrecy & Access Control** — Facts, rooms, documents, projects, meetings, identities, and technologies have intended audiences.
- [ ] **279. Religious Evolution** — Doctrines reinterpret events, sects split, saints arise, reformers challenge institutions, and faiths merge or disappear.
- [ ] **280. Ritual Calendar** — Festivals, mourning periods, fasts, pilgrimages, mating customs, flood ceremonies, harvest rites, and memorial days reshape schedules.

## M. Technology, Agency, Narrative, and Simulation Architecture

- [ ] **281. Procedural Invention** — New technologies emerge by recombining known principles, materials, needs, accidents, and experiments instead of a fixed tech tree.
- [ ] **282. Experimental Science** — Citizens form hypotheses, design tests, collect evidence, disagree, replicate findings, and sometimes reach wrong conclusions.
- [ ] **283. Engineering Blueprints** — Machines, dams, buildings, locks, weapons, and industrial processes can require plans that are copied, taught, stolen, or lost.
- [ ] **284. Machine Wear & Maintenance** — Bearings, ropes, gears, gates, pumps, boats, tools, and mills degrade according to load, material, environment, and upkeep.
- [ ] **285. Repair, Salvage & Recycling** — Broken structures and tools become damaged components, scrap, reusable timber, spare parts, or raw material.
- [ ] **286. Multi-Step NPC Planning** — Citizens decompose goals into plans and can improvise when steps fail.
- [ ] **287. Institutional Agency** — Guilds, firms, temples, armies, councils, criminal networks, and states possess goals, assets, strategies, memory, and internal politics.
- [ ] **288. Emergent Quests** — A “quest” is a real unresolved world problem that becomes known to someone, not an arbitrary spawned objective.
- [ ] **289. Macro/Micro Equivalence** — Off-screen simulation uses compressed versions of the same economy, ecology, demography, politics, and causality.
- [ ] **290. Causal Event Graph** — Significant events record causes, enabling forensic inspection and coherent historical explanation.
- [ ] **291. Counterfactual Reasoning** — Agents estimate likely outcomes: “If we breach this bank, the lower district floods,” “If I accuse her, my guild may retaliate,” etc.
- [ ] **292. Procedural Architecture Traditions** — Building forms evolve from climate, water, materials, religion, prestige, defense, family structure, and historical imitation.
- [ ] **293. Procedural Cuisine** — Recipes evolve from ingredients, preservation, tools, ritual rules, status, trade, and local ecology.
- [ ] **294. Fashion & Display** — Fur grooming, dyes, jewelry, clothing, tooth ornament, carved tail guards, badges, and materials cycle through status trends.
- [ ] **295. Art Movements** — Artists influence one another, reject predecessors, form schools, imitate famous works, and respond to politics or religion.
- [ ] **296. Propaganda & Mass Persuasion** — Speeches, songs, monuments, rumor, books, symbols, festivals, censorship, and staged events affect public belief.
- [ ] **297. Possess Any Citizen** — Seamlessly leave colony command and directly inhabit a historical citizen without creating a separate “player avatar.”
- [ ] **298. Seamless Colony ↔ Third-Person ↔ First-Person View** — The same simulation supports god-view management, tactical command, embodied exploration, and cinematic observation.
- [ ] **299. Procedural Natural-Language Dialogue Layer** — Simulation chooses facts, motives, lies, emotions, and intents; an optional language model only renders them into expressive speech.
- [ ] **300. World Historian / Story Discovery Engine** — Analyze the causal graph to identify tragedies, dynasties, revenge chains, heroic rescues, ecological disasters, political collapses, bizarre accidents, inventions, romances, and myths after they naturally occur.

---

# PART IV — BEAVER-SPECIFIC SYSTEMS THAT MUST CUT ACROSS THE ENTIRE GAME

These are not extra numbered systems; they are **cross-cutting requirements** that distinguish *Dam Beavers* from a generic fantasy colony simulator.

## Beaver Biology

- [ ] Semi-aquatic locomotion: walking, swimming, diving, surfacing, climbing banks, dragging objects.
- [ ] Breath holding, drowning, current resistance, cold-water exposure, and underwater work.
- [ ] Teeth continuously grow and require gnawing behavior.
- [ ] Gnawing skill, tooth wear, damaged incisors, and material-dependent cutting efficiency.
- [ ] Tail functions: balance, swimming, fat storage, signaling, injury, thermal regulation where modeled.
- [ ] Dense fur, grooming, wetness, contamination, insulation, drying, and oil condition.
- [ ] Family lodge behavior and kit dependency.
- [ ] Scent marking and territorial communication.
- [ ] Food caching underwater or in cold storage where ecologically appropriate.
- [ ] Strong innate attraction to altering water flow expressed as preferences/goals—not magical hard-coded omniscience.

## Hydraulic Civilization

- [ ] Dams are not decorative buildings; they alter upstream depth, current, groundwater, erosion, fish passage, fertility, and flood risk.
- [ ] Every floodgate, culvert, levee, bypass, spillway, reservoir, lock, and canal participates in the real fluid model.
- [ ] Citizens can reason about target water levels and route water intentionally.
- [ ] Engineering mistakes can create downstream disasters.
- [ ] Ancient dams and abandoned canals remain regional features for centuries.
- [ ] Water rights become economic, legal, religious, and military issues.
- [ ] Settlement wealth can derive from navigation, irrigation, milling, fisheries, flood control, or trade chokepoints.
- [ ] A colony can unintentionally destroy another society simply by changing a river.

## Riparian Ecology

- [ ] Fish spawning and migration react to dams and water quality.
- [ ] Wetland creation increases some species while reducing others.
- [ ] Tree removal alters erosion, habitat, shade, and future timber supply.
- [ ] Predators learn colony locations because engineered ponds concentrate prey.
- [ ] Mosquitoes, parasites, disease vectors, and stagnant-water ecologies can emerge.
- [ ] Floodplains gain or lose fertility through sediment deposition.
- [ ] Beaver engineering should visibly transform the world map over generations.

## Appropriate Companion / Domestic Fauna

Avoid copying the dwarf “cats and dogs everywhere” ecosystem.

Possible roles should be filled by species that make ecological or cultural sense:

- [ ] **Otters** — trained fishing partners, scouts, elite swimmers, companions, or rivals depending on culture.
- [ ] **Geese / Ducks** — alarm animals, egg producers, symbolic animals, messengers only in more fantastic cultures.
- [ ] **Corvids** — scouts, mimics, message carriers, thieves, intelligent companions.
- [ ] **Turtles** — ceremonial pets, long-lived household animals, religious symbols.
- [ ] **Muskrats** — close ecological neighbors, workers, rivals, trade partners, or domesticated burrow specialists.
- [ ] **Fish** — pond husbandry, sacred animals, food stocks, ornamental breeding.
- [ ] **Large domestic procedural fauna** — where hauling or riding is needed, generate regionally appropriate animals rather than forcing horses into every culture.
- [ ] Domesticity itself should be cultural and historical, not a global species flag.

---

# PART V — THE UNIVERSAL ENGINES UNDER THE 300 SYSTEMS

The project should **not** contain 300 isolated managers. Most numbered mechanics should emerge from a smaller substrate.

## Suggested Engine Layer

1. **Entity / Component / Identity Engine**
2. **Time, Scheduling & Simulation-LOD Engine**
3. **3D Spatial / Navigation Engine**
4. **Terrain, Soil & Geology Engine**
5. **Materials & Object-State Engine**
6. **Rigid-Body / Momentum / Structural Physics Engine**
7. **Hydrology & Liquid Transport Engine**
8. **Atmosphere / Gas / Thermal Engine**
9. **Chemistry / Contamination / Reaction Engine**
10. **Plant & Forestry Engine**
11. **Wildlife / Population Ecology Engine**
12. **Anatomy / Physiology / Medicine Engine**
13. **Metabolism / Nutrition / Disease Engine**
14. **Perception / Attention Engine**
15. **Memory / Belief / Information Engine**
16. **Emotion / Personality / Needs Engine**
17. **Relationships / Family / Social Graph Engine**
18. **Goals / Planning / Utility AI Engine**
19. **Jobs / Skills / Work Scheduling Engine**
20. **Inventory / Ownership / Logistics Engine**
21. **Production / Craft / Machine Engine**
22. **Economy / Contracts / Property Engine**
23. **Law / Crime / Evidence Engine**
24. **Organizations / Politics / Diplomacy Engine**
25. **Combat / Threat / Military Engine**
26. **Culture / Religion / Art Engine**
27. **Language / Writing / Knowledge Engine**
28. **World History / Causal Event Graph**
29. **Procedural Generation / Worldgen Engine**
30. **Narrative Discovery / Chronicle Engine**
31. **Modding / Data / Scripting Layer**
32. **Rendering / Audio / Presentation Layer**

### Architectural requirement

A numbered feature should normally be implemented as a **composition of these engines**, not as bespoke game logic.

Example:

`poisoned marsh water kills a visiting diplomat`

should resolve through:

**industrial discharge → fluid mixture → watershed flow → contaminant concentration → visitor drinks → ingestion route → dose/body mass → syndrome → symptoms → healer diagnosis → death → diplomatic event → rumor transmission → political retaliation**

The diplomatic crisis is therefore caused by the same water simulation used to run mills and irrigate farms.

---

# PART VI — SYSTEM INTERACTION TESTS

These are “if the engine is really systemic, this should be possible” acceptance tests.

- [ ] A fallen tree can block a stream, raise water, flood a burrow, displace a family, spread sewage, trigger disease, and cause a political scandal.
- [ ] A drought can reduce river depth, halt boat trade, expose a ford, alter a war route, concentrate pollutants, kill fish, raise food prices, and trigger migration.
- [ ] A dam can improve irrigation while destroying downstream fisheries and causing a neighboring polity to declare war.
- [ ] A famous engineer can design a brilliant flood-control system, die, have the blueprints lost, and leave later generations unable to maintain it.
- [ ] A criminal can poison water without the game firing a “poison plot event”; the result emerges from access, chemistry, motives, secrecy, and ingestion.
- [ ] A beaver can become drunk from contaminated fur through grooming if dose and physiology make it possible.
- [ ] A predator can learn where citizens cross the river and begin ambushing them because of repeated successful hunts.
- [ ] Refugees can introduce a new crop, religion, disease, dialect, technology, and political faction at the same time.
- [ ] A poorly maintained floodgate can fail because of material fatigue rather than a random disaster roll.
- [ ] A guild can become wealthy, finance a council faction, alter water law, and indirectly cause ecological collapse.
- [ ] A sacred pond can become polluted, producing religious unrest because physical contamination and cultural meaning intersect.
- [ ] An off-map war can alter trade prices before the player learns why.
- [ ] A rumor can name the wrong culprit, lead to an unjust conviction, generate a blood feud, and later be disproven by recovered records.
- [ ] An abandoned city can gradually become marshland, then wildlife habitat, then a sacred ruin, then a resettled fortress.
- [ ] A minor kit rescued from a flood can grow up remembering the rescuer and later save that family politically or militarily.
- [ ] One structural breach can propagate through connected reservoirs and produce a cascading regional flood.
- [ ] A new invention can spread unevenly because blueprints, literacy, travel, institutional secrecy, and material availability all matter.
- [ ] Citizens can invent a false supernatural explanation for a real natural event because beliefs are not identical to simulation truth.
- [ ] Two cultures can independently solve the same hydraulic problem with architecturally different technologies.
- [ ] A historian can reconstruct a century-old catastrophe from ruins, documents, survivor lineages, sediment, and artifact provenance.

---

# PART VII — IMPLEMENTATION PRIORITY

## Tier 0 — Non-Negotiable Substrate

- [ ] ECS / world-state architecture
- [ ] Deterministic event timing
- [ ] Causal event graph
- [ ] Terrain + 3D occupancy
- [ ] Hydrology
- [ ] Materials
- [ ] Objects + inventories
- [ ] Citizens + anatomy
- [ ] Needs + jobs
- [ ] Skills
- [ ] Construction
- [ ] Production
- [ ] Navigation
- [ ] Basic ecology
- [ ] Relationships
- [ ] History persistence
- [ ] Macro simulation LOD

## Tier 1 — “This Already Feels Like Dam Beavers”

- [ ] Tree felling
- [ ] Log transport
- [ ] Dam construction
- [ ] Dynamic ponds
- [ ] Flooding
- [ ] Lodges / burrows
- [ ] Family colonies
- [ ] Food stores
- [ ] Seasonal river change
- [ ] Predator ecology
- [ ] Trade
- [ ] Crafting
- [ ] Injuries
- [ ] Death + burial/memorial
- [ ] Individual memories
- [ ] Colony migration
- [ ] Basic diplomacy

## Tier 2 — Dwarf-Fortress-Level Emergence

- [ ] Full contaminant chain
- [ ] Deep anatomy and medicine
- [ ] Persistent politics
- [ ] Crime + evidence
- [ ] Guilds and religions
- [ ] Art and scholarship
- [ ] Off-map armies
- [ ] Raids and conquest
- [ ] Procedural creatures
- [ ] Advanced economy
- [ ] Personality development
- [ ] World activation
- [ ] Siege engineering
- [ ] Historical artifacts
- [ ] Information / rumor propagation

## Tier 3 — “Beyond Dwarf Fortress”

- [ ] Full watershed simulation
- [ ] Sediment and erosion
- [ ] Structural engineering
- [ ] Microbiology
- [ ] Epidemiology
- [ ] Genetics
- [ ] Belief graphs
- [ ] Dynamic law
- [ ] Credit / firms
- [ ] Invention
- [ ] Science
- [ ] Institutional agency
- [ ] Counterfactual planning
- [ ] Macro/micro equivalence
- [ ] Seamless possession view
- [ ] Narrative historian

---

# FINAL STANDARD

**Dam Beavers succeeds when the player can ask “why did this happen?” and the game can answer with a real causal chain.**

The target is not merely a giant feature count. The target is a world where:

> **water, matter, bodies, animals, memories, institutions, economics, culture, and history all obey compatible rules.**

If an event can be produced by those rules, we should not script it.

That is how *Dam Beavers* becomes a beaver civilization simulator with *Dwarf Fortress*-class emergence rather than a themed colony builder.
