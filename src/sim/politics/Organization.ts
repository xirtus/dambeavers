import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getOwner, setOwner, OwnerComponent } from "../creatures/Ownership.js";
import { nameEntity } from "../creatures/Naming.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P7-01: real, persistent groups any individual can belong to, with real
 * roles and real shared assets -- the general "organization" shape every
 * later Phase 7 task builds on (polities P7-02, government bodies P7-08,
 * military units P7-14, civilizations' institutions P7-17).
 *
 * Membership is a component attached to the MEMBER entity (a beaver, or
 * another organization for real institutional hierarchy), naming the
 * organization it belongs to and its data-defined role within it --
 * never a list the organization itself would have to keep in sync
 * (discover members by query, the same "derive, never cache" discipline
 * `Household.ts` already established). Roles are plain validated ids
 * ("leader", "soldier", "judge", ...): the organization's own charter
 * declares which roles it uses, so "roles" are real DATA (each org can
 * define its own), not a hardcoded enum switch.
 *
 * Shared assets are the already-real institutional-ownership mechanism
 * (`Ownership.ts` P5-06: goods owned by an organization's own stable
 * entity id) -- no parallel asset ledger, and every existing ownership
 * query (`getOwner`, inheritance) keeps working unchanged.
 */

export interface Organization {
  /** The real `"organization-founded"` event this entity's history chains from. */
  formedEventId: EventId;
  /** Data-defined role ids this organization's charter declares (members may only hold declared roles). */
  roleIds: readonly string[];
  /** Optional founding purpose -- free text, real identity data, not a behavior switch. */
  purpose?: string;
}
export const OrganizationComponent: ComponentType<Organization> = defineComponent<Organization>("organization");

export interface OrgMembership {
  organizationId: EntityId;
  roleId: string;
  sinceTick: number;
}
export const OrgMembershipComponent: ComponentType<OrgMembership> = defineComponent<OrgMembership>("org-membership");

const ROLE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertValidRoleId(roleId: string): void {
  if (!ROLE_ID_PATTERN.test(roleId)) {
    throw new RangeError(`role id must be non-empty lowercase kebab-case, got ${JSON.stringify(roleId)}`);
  }
}

export function assertValidOrganization(organization: Organization): void {
  if (!Number.isInteger(organization.formedEventId) || organization.formedEventId < 1) {
    throw new RangeError(`organization formedEventId must be a positive integer, got ${organization.formedEventId}`);
  }
  if (organization.roleIds.length === 0) {
    throw new RangeError("organization must declare at least one role id");
  }
  for (const roleId of organization.roleIds) assertValidRoleId(roleId);
  if (new Set(organization.roleIds).size !== organization.roleIds.length) {
    throw new RangeError(`organization roleIds must be unique, got ${JSON.stringify(organization.roleIds)}`);
  }
  if (organization.purpose !== undefined && organization.purpose.trim().length === 0) {
    throw new RangeError("organization purpose must be non-empty when present");
  }
}

export function setOrganization(components: ComponentStore, organizationId: EntityId, organization: Organization): void {
  assertValidOrganization(organization);
  const normalized: Organization = {
    formedEventId: organization.formedEventId,
    roleIds: [...organization.roleIds],
  };
  if (organization.purpose !== undefined) normalized.purpose = organization.purpose;
  components.set(organizationId, OrganizationComponent, normalized);
}

export function getOrganization(components: ComponentStore, organizationId: EntityId): Organization | undefined {
  const organization = components.get(organizationId, OrganizationComponent);
  if (organization !== undefined) assertValidOrganization(organization);
  return organization;
}

export function assertValidOrgMembership(membership: OrgMembership): void {
  if (!Number.isInteger(membership.organizationId) || membership.organizationId < 1) {
    throw new RangeError(`org-membership organizationId must be a positive integer, got ${membership.organizationId}`);
  }
  assertValidRoleId(membership.roleId);
  if (!Number.isInteger(membership.sinceTick) || membership.sinceTick < 0) {
    throw new RangeError(`org-membership sinceTick must be a non-negative integer, got ${membership.sinceTick}`);
  }
}

export function setOrgMembership(components: ComponentStore, memberId: EntityId, membership: OrgMembership): void {
  assertValidOrgMembership(membership);
  components.set(memberId, OrgMembershipComponent, membership);
}

export function getOrgMembership(components: ComponentStore, memberId: EntityId): OrgMembership | undefined {
  const membership = components.get(memberId, OrgMembershipComponent);
  if (membership !== undefined) assertValidOrgMembership(membership);
  return membership;
}

/**
 * Creates a real, permanent `"organization"` entity (P0-02 stable
 * identity), records the real `"organization-founded"` event, and
 * attaches a generated group name through the SAME `Identity` component
 * every named entity uses (P5-10's `nameEntity`). Returns the new stable
 * organization id.
 */
export function createOrganization(world: World, roleIds: readonly string[], random: RandomStream, purpose?: string): EntityId {
  const organizationId = world.entities.create("organization");
  const formedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "organization-founded",
    subjectIds: [organizationId],
    location: { x: 0, y: 0, z: 0 },
  });
  setOrganization(world.components, organizationId, {
    formedEventId,
    roleIds: [...roleIds],
    ...(purpose !== undefined ? { purpose } : {}),
  });
  nameEntity(world, organizationId, "group", random);
  return organizationId;
}

/** The real, live members of `organizationId` (any entity kind carrying an `org-membership` naming it), sorted by id for determinism. */
export function organizationMembers(components: ComponentStore, organizationId: EntityId): EntityId[] {
  const members: EntityId[] = [];
  for (const memberId of components.query(OrgMembershipComponent)) {
    const membership = getOrgMembership(components, memberId);
    if (membership !== undefined && membership.organizationId === organizationId) members.push(memberId);
  }
  return members.sort((a, b) => a - b);
}

/** The data-defined role `memberId` holds in `organizationId`, if it is a member at all. */
export function memberRole(components: ComponentStore, organizationId: EntityId, memberId: EntityId): string | undefined {
  const membership = getOrgMembership(components, memberId);
  return membership !== undefined && membership.organizationId === organizationId ? membership.roleId : undefined;
}

/**
 * Real membership change: `memberId` joins `organizationId` in `roleId`
 * (which the organization's own charter must declare). Throws on an
 * undeclared role -- roles are real data, not free-form labels.
 */
export function joinOrganization(world: World, organizationId: EntityId, memberId: EntityId, roleId: string): void {
  const organization = getOrganization(world.components, organizationId);
  if (organization === undefined) throw new RangeError(`unknown organization ${organizationId}`);
  if (!organization.roleIds.includes(roleId)) {
    throw new RangeError(`organization ${organizationId} does not declare role ${JSON.stringify(roleId)}`);
  }
  setOrgMembership(world.components, memberId, { organizationId, roleId, sinceTick: world.clock.tick });
}

/** Moves an existing member to a different declared role. Throws if not a member or role undeclared. */
export function setMemberRole(world: World, organizationId: EntityId, memberId: EntityId, roleId: string): void {
  if (getOrgMembership(world.components, memberId)?.organizationId !== organizationId) {
    throw new RangeError(`entity ${memberId} is not a member of organization ${organizationId}`);
  }
  joinOrganization(world, organizationId, memberId, roleId);
}

/** Removes `memberId`'s membership in `organizationId` (a no-op if it holds none). */
export function leaveOrganization(components: ComponentStore, organizationId: EntityId, memberId: EntityId): void {
  const membership = getOrgMembership(components, memberId);
  if (membership !== undefined && membership.organizationId === organizationId) {
    components.remove(memberId, OrgMembershipComponent);
  }
}

/**
 * The organization's real shared assets: every good currently owned
 * institutionally by `organizationId` (`Ownership.ts` P5-06, unmodified
 * -- the same query a settlement or household's assets use). Derived
 * fresh each call, never cached.
 */
export function organizationAssets(world: World, organizationId: EntityId): EntityId[] {
  const assets: EntityId[] = [];
  for (const itemId of world.components.query(OwnerComponent)) {
    const owner = getOwner(world.components, itemId);
    if (owner !== undefined && owner.ownerType === "institutional" && owner.ownerId === organizationId) assets.push(itemId);
  }
  return assets.sort((a, b) => a - b);
}

/** Real asset transfer INTO the organization's shared pool: `itemId` becomes institutionally owned by `organizationId`. */
export function transferAssetToOrganization(world: World, organizationId: EntityId, itemId: EntityId): void {
  if (getOrganization(world.components, organizationId) === undefined) {
    throw new RangeError(`unknown organization ${organizationId}`);
  }
  setOwner(world.components, itemId, { ownerType: "institutional", ownerId: organizationId });
}

/** Real asset transfer OUT of the shared pool: `itemId` becomes institutionally owned by `newOwnerId` (a site, another org, ...). */
export function transferAssetFromOrganization(world: World, organizationId: EntityId, itemId: EntityId, newOwnerId: EntityId): void {
  const owner = getOwner(world.components, itemId);
  if (owner === undefined || owner.ownerType !== "institutional" || owner.ownerId !== organizationId) {
    throw new RangeError(`item ${itemId} is not institutionally owned by organization ${organizationId}`);
  }
  setOwner(world.components, itemId, { ownerType: "institutional", ownerId: newOwnerId });
}

/** Convenience: whether `entityId` belongs to `organizationId`. */
export function isMemberOf(components: ComponentStore, organizationId: EntityId, entityId: EntityId): boolean {
  return getOrgMembership(components, entityId)?.organizationId === organizationId;
}
