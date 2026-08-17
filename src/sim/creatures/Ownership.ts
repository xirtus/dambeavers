import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { inheritingHouseholdMembers } from "./Household.js";

/**
 * P5-06: real ownership state attachable to ANY item/room entity --
 * generic over entity kind the same way `Identity`/`Held` already are.
 * `ownerType` names the roadmap's own four-item list; `"personal"`/
 * `"household"`/`"institutional"` carry a real `ownerId` (a beaver,
 * household, or settlement entity respectively); `"communal"` has none
 * (owned by everyone/no one in particular -- a real, meaningful absence,
 * not a missing value).
 */
export type OwnerType = "personal" | "household" | "institutional" | "communal";
const VALID_OWNER_TYPES: readonly OwnerType[] = ["personal", "household", "institutional", "communal"];

export interface Owner {
  ownerType: OwnerType;
  ownerId?: EntityId;
}
export const OwnerComponent: ComponentType<Owner> = defineComponent<Owner>("owner");

export function assertValidOwner(owner: Owner): void {
  if (!VALID_OWNER_TYPES.includes(owner.ownerType)) {
    throw new RangeError(`owner ownerType must be one of ${VALID_OWNER_TYPES.join(", ")}, got ${JSON.stringify(owner.ownerType)}`);
  }
  if (owner.ownerType === "communal" && owner.ownerId !== undefined) {
    throw new RangeError("owner ownerId must be absent for communal ownership");
  }
  if (owner.ownerType !== "communal" && (owner.ownerId === undefined || !Number.isInteger(owner.ownerId) || owner.ownerId < 1)) {
    throw new RangeError(`owner ownerId must be a positive integer for ownerType "${owner.ownerType}"`);
  }
}

export function setOwner(components: ComponentStore, itemId: EntityId, owner: Owner): void {
  assertValidOwner(owner);
  const normalized: Owner = owner.ownerId === undefined ? { ownerType: owner.ownerType } : { ownerType: owner.ownerType, ownerId: owner.ownerId };
  components.set(itemId, OwnerComponent, normalized);
}

export function getOwner(components: ComponentStore, itemId: EntityId): Owner | undefined {
  const owner = components.get(itemId, OwnerComponent);
  if (owner !== undefined) assertValidOwner(owner);
  return owner;
}

export function isOwnedBy(components: ComponentStore, itemId: EntityId, beaverId: EntityId): boolean {
  const owner = getOwner(components, itemId);
  return owner !== undefined && owner.ownerType === "personal" && owner.ownerId === beaverId;
}

/**
 * P5-06's own "inheritance hooks" made real: transfers every item
 * PERSONALLY owned by `deceasedId` to the highest-closeness live
 * household member (`Household.ts`'s `inheritingHouseholdMembers`, P5-05)
 * -- or, with no surviving household member, ownership drops to
 * `"communal"` (a real, honest outcome: an estate with no heir doesn't
 * vanish, it becomes the settlement's own). Called explicitly, not
 * automatically wired into `Mortality.die` (Law 10 -- the hook is real
 * and callable; a future task deciding WHEN estates should always
 * transfer automatically owns that wiring choice, not this one).
 */
export function bequeathEstate(world: World, deceasedId: EntityId): EntityId[] {
  const heirs = inheritingHouseholdMembers(world, deceasedId);
  const heir = heirs[0];
  const transferred: EntityId[] = [];
  for (const itemId of world.components.query(OwnerComponent)) {
    const owner = getOwner(world.components, itemId);
    if (owner === undefined || owner.ownerType !== "personal" || owner.ownerId !== deceasedId) continue;
    if (heir !== undefined) setOwner(world.components, itemId, { ownerType: "personal", ownerId: heir });
    else setOwner(world.components, itemId, { ownerType: "communal" });
    transferred.push(itemId);
  }
  return transferred;
}
