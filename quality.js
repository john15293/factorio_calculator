/*Quality support for the Space Age expansion.

Models the per-tier multipliers that quality applies to crafting machines,
modules, and beacons. The numbers come from the base game:

  - Machines/miners: crafting (mining) speed is multiplied by (1 + 0.3 * level).
  - Modules: the *beneficial* part of each effect is multiplied by the same
    factor; penalties (e.g. a speed module's extra power draw, a productivity
    module's speed loss) are unchanged.
  - Beacons: distribution effectivity gains a flat +0.2 per quality level.

See: https://wiki.factorio.com/Quality */
import { Rational } from "./rational.js"

class Quality {
    constructor(key, name, level) {
        this.key = key
        this.name = name
        // Note: legendary is internal level 5, not 4. The game reserves a
        // hypothetical fifth tier, so legendary is a two-step jump (+150%).
        this.level = level
        // Positive stats are multiplied by (1 + 0.3 * level) = (10 + 3*level)/10.
        this.factor = Rational.from_floats(10 + 3 * level, 10)
    }
    // Single-character code, used to keep the URL fragment compact.
    code() {
        return this.key[0]
    }
}

export const QUALITIES = [
    new Quality("normal", "Normal", 0),
    new Quality("uncommon", "Uncommon", 1),
    new Quality("rare", "Rare", 2),
    new Quality("epic", "Epic", 3),
    new Quality("legendary", "Legendary", 5),
]

export const DEFAULT_QUALITY = QUALITIES[0]

export const qualityByKey = new Map(QUALITIES.map(q => [q.key, q]))
export const qualityByCode = new Map(QUALITIES.map(q => [q.code(), q]))

// Beacons gain a flat distribution-effectivity bonus per quality level (1.5 at
// normal, 2.5 at legendary), rather than the multiplicative scaling that
// modules and machines use.
export const BEACON_EFFECTIVITY_PER_LEVEL = Rational.from_floats(1, 5)
