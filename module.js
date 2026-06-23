/*Copyright 2015-2024 Kirk McDonald

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/
import { makeDropdown, addInputs } from "./dropdown.js"
import { Icon, sprites } from "./icon.js"
import { useLegacyCalculation } from "./init.js"
import { Rational, zero, half, one } from "./rational.js"
import { sorted } from "./sort.js"
import { QUALITIES, DEFAULT_QUALITY, BEACON_EFFECTIVITY_PER_LEVEL } from "./quality.js"

let hundred = Rational.from_float(100)
function percent(x) {
    let sign = ""
    if (!x.less(zero)) {
        sign = "+"
    }
    return `${sign}${x.mul(hundred).toDecimal()}%`
}

class Module {
    constructor(key, name, col, row, category, order, productivity, speed, power) {
        // Other module effects not modeled by this calculator.
        this.key = key
        this.name = name
        this.category = category
        this.order = order
        this.productivity = productivity
        this.speed = speed
        this.power = power

        this.icon_col = col
        this.icon_row = row
        this.icon = new Icon(this)
    }
    // This naming scheme is some older cruft, which works in the vanilla
    // dataset, but it's possible other datasets would render it unworkable.
    shortName() {
        return this.key[0] + this.key[this.key.length - 1]
    }
    canUse(recipe) {
        if (this.hasProdEffect() && !recipe.allow_productivity) {
            return false
        }
        return true
    }
    canBeacon() {
        return this.productivity.isZero()
    }
    hasProdEffect() {
        return !this.productivity.isZero()
    }
    // Effects scaled for the given quality. Only the beneficial direction of
    // an effect scales; penalties (negative speed, positive power) are fixed.
    effectiveSpeed(quality) {
        if (this.speed.less(zero)) {
            return this.speed
        }
        return this.speed.mul(quality.factor)
    }
    effectiveProductivity(quality) {
        return this.productivity.mul(quality.factor)
    }
    effectivePower(quality) {
        if (this.power.less(zero)) {
            return this.power.mul(quality.factor)
        }
        return this.power
    }
    renderTooltip() {
        let self = this
        let t = d3.create("div")
            .classed("frame", true)
        let header = t.append("h3")
        header.append(() => self.icon.make(32, true))
        header.append(() => new Text(self.name))
        let line
        if (!this.power.isZero()) {
            line = t.append("div")
            line.append("b")
                .text("Energy consumption: ")
            line.append("span")
                .text(percent(this.power))
        }
        if (!this.speed.isZero()) {
            line = t.append("div")
            line.append("b")
                .text("Speed: ")
            line.append("span")
                .text(percent(this.speed))
        }
        if (!this.productivity.isZero()) {
            line = t.append("div")
            line.append("b")
                .text("Productivity: ")
            line.append("span")
                .text(percent(this.productivity))
        }
        return t.node()
    }
}

export function moduleDropdown(selector, data) {
    let moduleDropdownSpan = selector.selectAll("span.module-wrapper")
        .data(data)
        .join(
            enter => {
                let s = enter.append("span")
                    .classed("module-wrapper", true)
                makeDropdown(s)
                return s
            }
        )
    let moduleDropdown = moduleDropdownSpan.selectAll("div.dropdown")
    moduleDropdown.selectAll("div.moduleRow")
        .data(d => d.inputRows)
        .join("div")
            .classed("moduleRow", true)
            .selectAll("span.input")
            .data(d => d)
            .join(
                enter => {
                    let s = enter.append("span")
                        .classed("input", true)
                    let label = addInputs(
                        s,
                        d => d.cell.name,
                        d => d.checked(),
                        d => d.choose(),
                    )
                    label.append(function(d) {
                        if (d.module === null) {
                            return sprites.get("slot_icon_module").icon.make(32)
                        } else {
                            return d.module.icon.make(32, false, this.parentNode.parentNode.parentNode)
                        }
                    })
                    return s
                },
                update => {
                    update.selectAll("input").property("checked", d => d.checked())
                    return update
                },
            )
}

// ModuleSpec represents the set of modules (including beacons) configured for
// a given recipe.
export class ModuleSpec {
    constructor(recipe, spec) {
        this.recipe = recipe
        this.building = null
        this.modules = []
        this.beaconModules = [spec.defaultBeacon[0], spec.defaultBeacon[1]]
        this.beaconCount = spec.defaultBeaconCount
        // Quality tiers for this recipe's modules and its beacon. The beacon
        // quality also governs the quality of the modules placed in the beacon.
        // (Building quality lives on the spec, keyed by recipe.)
        this.moduleQuality = DEFAULT_QUALITY
        this.beaconQuality = DEFAULT_QUALITY
    }
    setBuilding(building, spec) {
        this.building = building
        if (this.modules.length > building.moduleSlots) {
            this.modules.length = building.moduleSlots
        }
        let toAdd = spec.getDefaultModule(this.recipe)
        while (this.modules.length < building.moduleSlots) {
            this.modules.push(toAdd)
        }
    }
    getModule(index) {
        return this.modules[index]
    }
    // Returns true if the module change requires a recalculation.
    setModule(index, module) {
        if (index >= this.modules.length) {
            return false
        }
        let oldModule = this.modules[index]
        let needRecalc = (oldModule && oldModule.hasProdEffect()) || (module && module.hasProdEffect())
        this.modules[index] = module
        return needRecalc
    }
    setBeaconModule(module, i) {
        this.beaconModules[i] = module
    }
    setBeaconCount(count) {
        this.beaconCount = count
    }
    speedEffect() {
        let speed = one
        for (let module of this.modules) {
            if (!module) {
                continue
            }
            speed = speed.add(module.effectiveSpeed(this.moduleQuality))
        }
        if (this.modules.length > 0) {
            let effectivity = beaconEffectAtQuality(this.beaconQuality)
            for (let module of this.beaconModules) {
                if (module === null) {
                    continue
                }
                let beacon = module.effectiveSpeed(this.beaconQuality).mul(this.beaconCount).mul(effectivity)
                if (!useLegacyCalculation) {
                    let i = this.beaconCount.ceil().toFloat() - 1
                    if (i >= beaconProfile.length) {
                        i = beaconProfile.length - 1
                    }
                    beacon = beacon.mul(beaconProfile[i])
                }
                speed = speed.add(beacon)
            }
        }
        return speed
    }
    prodEffect(spec) {
        let prod = one
        for (let module of this.modules) {
            if (!module) {
                continue
            }
            prod = prod.add(module.effectiveProductivity(this.moduleQuality))
        }
        prod = prod.add(this.building.prodEffect(spec))
        return prod
    }
    powerEffect(spec) {
        let power = one
        for (let module of this.modules) {
            if (!module) {
                continue
            }
            power = power.add(module.effectivePower(this.moduleQuality))
        }
        if (this.modules.length > 0) {
            let effectivity = beaconEffectAtQuality(this.beaconQuality)
            for (let module of this.beaconModules) {
                if (module === null) {
                    continue
                }
                let beacon = module.effectivePower(this.beaconQuality).mul(this.beaconCount).mul(effectivity)
                if (!useLegacyCalculation) {
                    let i = this.beaconCount.ceil().toFloat() - 1
                    if (i >= beaconProfile.length) {
                        i = beaconProfile.length - 1
                    }
                    beacon = beacon.mul(beaconProfile[i])
                }
                power = power.add(beacon)
            }
        }
        let minimum = Rational.from_floats(1, 5)
        if (power.less(minimum)) {
            power = minimum
        }
        return power
    }
}

export let moduleRows = null
export let shortModules = null

let beaconProfile
let beaconEffect

// Beacon distribution effectivity at a given quality: base + 0.2 per level.
function beaconEffectAtQuality(quality) {
    return beaconEffect.add(BEACON_EFFECTIVITY_PER_LEVEL.mul(Rational.from_float(quality.level)))
}

export function getModules(data, items) {
    let modules = new Map()
    for (let d of data.modules) {
        let item = items.get(d.item_key)
        let effect = d.effect
        let category = d.category
        let order = item.order
        let speed = Rational.from_float_approximate(effect.speed || 0)
        let productivity = Rational.from_float_approximate(effect.productivity || 0)
        let power = Rational.from_float_approximate(effect.consumption || 0)
        modules.set(d.item_key, new Module(
            d.item_key,
            item.name,
            item.icon_col,
            item.icon_row,
            category,
            order,
            productivity,
            speed,
            power,
        ))
    }
    let sortedModules = sorted(modules.values(), m => m.order)
    moduleRows = [[null]]
    shortModules = new Map()
    let category = null
    for (let module of sortedModules) {
        if (module.category !== category) {
            category = module.category
            moduleRows.push([])
        }
        moduleRows[moduleRows.length - 1].push(module)
        let shortName = module.shortName()
        if (shortModules.has(shortName)) {
            // This does not occur in the vanilla data, but let's plan ahead.
            module.shortName = function() { return this.key }
            shortName = module.key
        }
        shortModules.set(shortName, module)
    }
    beaconEffect = Rational.from_float_approximate(data.beacon.distribution_effectivity)
    if (useLegacyCalculation) {
        beaconProfile = null
    } else {
        beaconProfile = []
        for (let x of data.beacon.profile) {
            beaconProfile.push(Rational.from_float_approximate(x))
        }
    }
    return modules
}
