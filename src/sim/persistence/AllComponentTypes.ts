import type { ComponentType } from "../core/ComponentStore.js";
import {
  IdentityComponent,
  CreatureBodyComponent,
  LocomotionComponent,
  SwimmerComponent,
  InventoryComponent,
  SkillsComponent,
  HealthComponent,
} from "../creatures/Beaver.js";
import { NeedsComponent } from "../creatures/Needs.js";
import { NeedFocusComponent } from "../creatures/BeaverNeeds.js";
import { BreathComponent } from "../creatures/Respiration.js";
import { CorpseComponent } from "../creatures/Mortality.js";
import { RelationshipsComponent, HouseholdMembershipComponent } from "../creatures/Relationships.js";
import { ParentageComponent, ReproductiveStateComponent } from "../creatures/Reproduction.js";
import { LifeStageComponent } from "../creatures/Aging.js";
import { SocialStateComponent } from "../creatures/SocialInteraction.js";
import { TraitsComponent } from "../creatures/Traits.js";
import { DesignationComponent } from "../jobs/Designation.js";
import { JobComponent } from "../jobs/Job.js";
import { LaborPreferencesComponent } from "../jobs/LaborPreferences.js";
import { TreeCutProgressComponent } from "../labor/TreeCutting.js";
import { LogComponent, HeldComponent, ReservationComponent } from "../labor/Log.js";
import { HaulProgressComponent } from "../labor/Hauling.js";
import { ToolComponent, RequiredToolComponent } from "../labor/Equipment.js";
import { ConstructionComponent, BuildProgressComponent } from "../labor/Construction.js";
import { FoodComponent } from "../labor/Food.js";
import { BurialProgressComponent, GraveComponent } from "../labor/Burial.js";
import { DamSegmentComponent, DamApplicationComponent } from "../hydrology/Dam.js";
import { GateComponent } from "../hydrology/Gate.js";
import { PlantComponent } from "../ecology/Plant.js";
import { FoodProducerComponent } from "../ecology/FoodProduction.js";
import { FoodSpoilageComponent } from "../ecology/FoodSpoilage.js";
import { StockpileComponent } from "../logistics/Stockpile.js";
import { RefuseComponent } from "../logistics/Refuse.js";
import { ZoneComponent } from "../spaces/FunctionalSpace.js";
import { SleepSpaceComponent, SleepClaimComponent } from "../spaces/SleepSpace.js";
import { DigProgressComponent } from "../labor/Digging.js";
import { GoodComponent } from "../economy/Good.js";
import { WorkshopComponent } from "../economy/Workshop.js";
import { CraftOrderComponent, CraftProgressComponent } from "../economy/Craft.js";
import { ContainerComponent } from "../economy/Container.js";
import { LiquidContentsComponent } from "../economy/Liquid.js";
import { BridgeSegmentComponent, BridgeApplicationComponent } from "../structures/Bridge.js";
import { WaterWheelComponent } from "../mechanics/WaterPower.js";
import { PowerTransmissionComponent } from "../mechanics/Machine.js";

type AnyComponentType = ComponentType<unknown>;

/**
 * P1-21's canonical answer to `WorldRestoreContext.componentTypes`'
 * own doc comment ("Typically assembled once at startup by importing
 * every feature's component-definition module") -- every real component
 * type any system in this codebase attaches to an entity, gathered in ONE
 * place, keyed by the SAME string name each type was itself defined with
 * (`defineComponent<T>("name")`). Every prior task's own acceptance/unit
 * tests hand-rolled their OWN partial `Map` of just the component types
 * that specific test happened to touch (a legitimate, deliberately-scoped
 * choice for a test proving one narrow mechanism) -- this file exists
 * because "save/reload the FULL watershed" (this task's own literal job)
 * needs the genuinely complete set, not a hand-picked subset a future
 * component type could silently fall outside of with no error until
 * someone's save mysteriously lost data.
 *
 * Adding a new component type anywhere in the codebase requires adding it
 * here too -- a real, deliberate, one-line registration step (matching
 * `STANDARD_MATERIALS_VERSION`/`STANDARD_PLANT_SPECIES_VERSION`'s own
 * "you must deliberately opt in" precedent for other codebase-wide
 * registries), not something a future task should expect to happen
 * automatically.
 */
export const ALL_COMPONENT_TYPES: ReadonlyMap<string, AnyComponentType> = new Map<string, AnyComponentType>([
  ["identity", IdentityComponent],
  ["creature-body", CreatureBodyComponent],
  ["locomotion", LocomotionComponent],
  ["swimmer", SwimmerComponent],
  ["inventory", InventoryComponent],
  ["skills", SkillsComponent],
  ["health", HealthComponent],
  ["needs", NeedsComponent],
  ["need-focus", NeedFocusComponent],
  ["breath", BreathComponent],
  ["corpse", CorpseComponent],
  ["relationships", RelationshipsComponent],
  ["household-membership", HouseholdMembershipComponent],
  ["parentage", ParentageComponent],
  ["reproductive-state", ReproductiveStateComponent],
  ["life-stage", LifeStageComponent],
  ["social-state", SocialStateComponent],
  ["traits", TraitsComponent],
  ["designation", DesignationComponent],
  ["job", JobComponent],
  ["labor-preferences", LaborPreferencesComponent],
  ["tree-cut-progress", TreeCutProgressComponent],
  ["log", LogComponent],
  ["held", HeldComponent],
  ["reservation", ReservationComponent],
  ["haul-progress", HaulProgressComponent],
  ["tool", ToolComponent],
  ["required-tool", RequiredToolComponent],
  ["construction", ConstructionComponent],
  ["build-progress", BuildProgressComponent],
  ["food", FoodComponent],
  ["dam-segment", DamSegmentComponent],
  ["dam-application", DamApplicationComponent],
  ["plant", PlantComponent],
  ["food-producer", FoodProducerComponent],
  ["food-spoilage", FoodSpoilageComponent],
  ["stockpile", StockpileComponent],
  ["refuse", RefuseComponent],
  ["zone", ZoneComponent],
  ["sleep-space", SleepSpaceComponent],
  ["sleep-claim", SleepClaimComponent],
  ["burial-progress", BurialProgressComponent],
  ["grave", GraveComponent],
  ["gate", GateComponent],
  ["dig-progress", DigProgressComponent],
  ["good", GoodComponent],
  ["workshop", WorkshopComponent],
  ["craft-order", CraftOrderComponent],
  ["craft-progress", CraftProgressComponent],
  ["container", ContainerComponent],
  ["liquid-contents", LiquidContentsComponent],
  ["bridge-segment", BridgeSegmentComponent],
  ["bridge-application", BridgeApplicationComponent],
  ["water-wheel", WaterWheelComponent],
  ["power-transmission", PowerTransmissionComponent],
]);
