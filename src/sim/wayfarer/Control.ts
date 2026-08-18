import { defineComponent, type ComponentType, type ComponentStore } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { ColonyLoopDeps } from "../runtime/ColonyLoop.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { currentJobOf, suspendJob } from "../jobs/JobBoard.js";
import { executeWayfarerVerb, type WayfarerVerb } from "./Verbs.js";
import { tickWayfarerSurvival } from "./Survival.js";

/**
 * P9-01: player control REPLACES decision selection for one creature --
 * nothing else. The controlled beaver is an ordinary beaver with
 * ordinary Locomotion/Needs/Health/Inventory components; the player
 * submits an intent (a movement goal or one verb), and each colony tick
 * the controlled beaver executes it through the ORDINARY movement/body
 * primitives (`BeaverLocomotion.advanceTowards` -- real speed budget,
 * real pathfinding, real blocking; the verb functions in `Verbs.ts` --
 * all of which call the systems' own public APIs). `ColonyLoop` skips
 * ordinary job assignment/behavior arbitration for the controlled beaver
 * (its decisions are the player's), but every BODY system keeps ticking
 * exactly as it does for everyone else (needs decay, thermal exposure,
 * mortality -- the loop's own post-beaver passes run unchanged).
 */

export interface WayfarerMoveCommand {
  kind: "move";
  goal: ColumnCoordinate;
}

export interface WayfarerVerbCommand {
  kind: "verb";
  verb: WayfarerVerb;
}

export type WayfarerCommand = WayfarerMoveCommand | WayfarerVerbCommand;

export interface PlayerControl {
  /** The player's current intent -- one command at a time, exactly the one-action-per-tick discipline every other driver in this codebase enforces. */
  pending?: WayfarerCommand;
}
export const PlayerControlComponent: ComponentType<PlayerControl> = defineComponent<PlayerControl>("player-control");

function assertPositiveId(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new RangeError(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
}

function assertColumn(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || !Number.isInteger((value as { x?: unknown }).x) || !Number.isInteger((value as { z?: unknown }).z)) {
    throw new RangeError(`${label} must have integer coordinates, got ${JSON.stringify(value)}`);
  }
}

export function assertValidPlayerControl(control: PlayerControl): void {
  if (control.pending === undefined) return;
  const pending = control.pending;
  if (pending.kind === "move") {
    assertColumn(pending.goal, "player-control move goal");
  } else if (pending.kind === "verb") {
    // P9 critic fix: a corrupted snapshot could carry a garbage verb --
    // validate every verb payload shape (and reject unknown kinds).
    const verb = pending.verb as { kind: string; itemId?: unknown; at?: unknown; gateId?: unknown; toolId?: unknown; targetId?: unknown };
    switch (verb.kind) {
      case "pickup":
      case "eat":
      case "steal":
        assertPositiveId(verb.itemId, `player-control verb ${verb.kind} itemId`);
        break;
      case "drop":
        assertPositiveId(verb.itemId, "player-control verb drop itemId");
        assertColumn(verb.at, "player-control verb drop at");
        break;
      case "open":
        assertPositiveId(verb.gateId, "player-control verb open gateId");
        break;
      case "use":
        assertPositiveId(verb.toolId, "player-control verb use toolId");
        assertPositiveId(verb.targetId, "player-control verb use targetId");
        break;
      case "speak":
      case "attack":
        assertPositiveId(verb.targetId, `player-control verb ${verb.kind} targetId`);
        break;
      case "drink":
        break;
      default:
        throw new RangeError(`player-control verb kind must be a real wayfarer verb, got ${JSON.stringify(verb.kind)}`);
    }
  } else {
    throw new RangeError(`player-control pending command kind must be move/verb, got ${JSON.stringify((pending as { kind: string }).kind)}`);
  }
}

export function setPlayerControl(components: ComponentStore, beaverId: EntityId, control: PlayerControl): void {
  assertValidPlayerControl(control);
  components.set(beaverId, PlayerControlComponent, { ...(control.pending !== undefined ? { pending: control.pending } : {}) });
}

export function getPlayerControl(components: ComponentStore, beaverId: EntityId): PlayerControl | undefined {
  const control = components.get(beaverId, PlayerControlComponent);
  if (control !== undefined) assertValidPlayerControl(control);
  return control;
}

/** Whether `beaverId` is currently player-controlled (its decisions come from the player). */
export function isPlayerControlled(components: ComponentStore, beaverId: EntityId): boolean {
  return components.has(beaverId, PlayerControlComponent);
}

/** Gives the player control of a live beaver. The beaver keeps every ordinary component; only its decision source changes. A job the beaver currently holds is suspended (requeued unclaimed) -- the colony loop no longer drives its work, so a held reservation would otherwise stall forever. */
export function designatePlayerControlled(world: World, beaverId: EntityId): void {
  if (!world.entities.isLive(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`entity ${beaverId} is not a live beaver -- cannot be player-controlled`);
  }
  if (isPlayerControlled(world.components, beaverId)) return;
  const heldJob = currentJobOf(world.entities, world.components, beaverId);
  if (heldJob !== undefined) suspendJob(world.components, heldJob);
  setPlayerControl(world.components, beaverId, {});
}

/** Returns the beaver to ordinary AI -- its decisions are its own again, with every change the player made left intact. */
export function releaseControl(world: World, beaverId: EntityId): void {
  world.components.remove(beaverId, PlayerControlComponent);
}

/** Submits the player's next command. One pending command at a time (replace it deliberately, or wait for it to finish -- the same discipline as any queued order). */
export function submitWayfarerCommand(world: World, beaverId: EntityId, command: WayfarerCommand): void {
  if (!isPlayerControlled(world.components, beaverId)) {
    throw new RangeError(`beaver ${beaverId} is not player-controlled -- cannot submit wayfarer commands`);
  }
  const current = getPlayerControl(world.components, beaverId)!;
  if (current.pending !== undefined) {
    throw new RangeError(`beaver ${beaverId} already has a pending command (${current.pending.kind}) -- one action at a time`);
  }
  setPlayerControl(world.components, beaverId, { pending: command });
}

export type CommandExecutionStatus = "executed" | "in-progress" | "blocked" | "invalid";

export interface CommandExecution {
  status: CommandExecutionStatus;
  reason: string | undefined;
  /** How many columns the ordinary movement actually advanced this tick (move commands). */
  columnsAdvanced: number | undefined;
}

/**
 * The controlled beaver's ONE action for this tick, called by
 * `ColonyLoop` in place of ordinary job assignment/behavior arbitration:
 * executes the pending command (movement advances one ordinary
 * speed-budget step toward the goal each tick -- never a teleport; a
 * verb executes once), then advances the beaver's survival needs and
 * thermal exposure through the SAME functions the ordinary AI uses.
 * Body systems beyond these (mortality, aging, social pressure) are the
 * loop's own post-beaver passes and run for the controlled beaver
 * exactly as for everyone else.
 */
export function tickControlledBeaver(deps: ColonyLoopDeps, world: World, beaverId: EntityId): CommandExecution {
  const control = getPlayerControl(world.components, beaverId);
  if (control === undefined) {
    throw new RangeError(`beaver ${beaverId} is not player-controlled`);
  }

  const hadPending = control.pending !== undefined;
  let execution: CommandExecution;
  if (control.pending === undefined) {
    execution = { status: "executed", reason: undefined, columnsAdvanced: undefined };
  } else if (control.pending.kind === "move") {
    const goal = control.pending.goal;
    const position = world.grid.positionOf(beaverId);
    if (position !== undefined && position.x === goal.x && position.z === goal.z) {
      setPlayerControl(world.components, beaverId, {});
      execution = { status: "executed", reason: undefined, columnsAdvanced: 0 };
    } else {
      const result = advanceTowards(deps.grid, deps.terrain, deps.water, deps.materials, deps.components, beaverId, goal);
      if (result.outcome === "arrived" || result.outcome === "already-there") {
        setPlayerControl(world.components, beaverId, {});
        execution = { status: "executed", reason: undefined, columnsAdvanced: result.columnsAdvanced };
      } else if (result.outcome === "unreachable") {
        setPlayerControl(world.components, beaverId, {});
        execution = { status: "blocked", reason: "no route to the goal exists for this creature's ordinary movement capability", columnsAdvanced: 0 };
      } else {
        execution = { status: "in-progress", reason: undefined, columnsAdvanced: result.columnsAdvanced };
      }
    }
  } else {
    const outcome = executeWayfarerVerb(deps, world, beaverId, control.pending.verb);
    setPlayerControl(world.components, beaverId, {});
    execution = { status: outcome.ok ? "executed" : outcome.blocked ? "blocked" : "invalid", reason: outcome.reason, columnsAdvanced: undefined };
  }

  // Ordinary survival: the SAME primitives the colony AI's own tick
  // uses (needs decay with real activity, thermal exposure, wound
  // physiology) -- one shared function, so the controlled body and the
  // ordinary body can never drift apart. Mortality stays the loop's own
  // pass, exactly as it is for every other beaver.
  const wasActive = hadPending && (execution.status === "executed" || execution.status === "in-progress");
  tickWayfarerSurvival(deps, world, beaverId, wasActive);
  return execution;
}
