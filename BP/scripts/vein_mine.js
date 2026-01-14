import { world, system } from '@minecraft/server'
import { list, blacklist } from 'global_variables.js'
import { is_diggable } from 'is_diggable.js'
import { Player, ItemStack, Block } from '@minecraft/server'

function msg(str) {
    world.sendMessage(`${JSON.stringify(str)}`)
}

/* ───────────────────────────────────────────── */
/* VEIN LOOT CONTEXT (per-run, isolated)         */
/* ───────────────────────────────────────────── */

/**
 * Creates an isolated loot context for a single vein/tunnel run.
 * @param {Block} block
 */
function createVeinContext(block) {
    return {
        loot: new Map(),              // Map<typeId, totalAmount>
        dimension: block.dimension,
        dropPos: block.location
    }
}

/**
 * Accumulate an ItemStack into the context.
 * @param {{loot: Map<string, number>}} ctx
 * @param {ItemStack} itemStack
 */
function addLoot(ctx, itemStack) {
    const id = itemStack.typeId
    const amount = itemStack.amount ?? 1
    ctx.loot.set(id, (ctx.loot.get(id) ?? 0) + amount)
}

/**
 * Spawn all accumulated loot at the context drop position.
 * Splits stacks to max 64.
 * @param {{loot: Map<string, number>, dimension: any, dropPos: any}} ctx
 */
function dropVeinLoot(ctx) {
    for (const [typeId, amount] of ctx.loot.entries()) {
        let remaining = amount
        while (remaining > 0) {
            const stackSize = Math.min(remaining, 64)
            ctx.dimension.spawnItem(new ItemStack(typeId, stackSize), ctx.dropPos)
            remaining -= stackSize
        }
    }
}

/**
 * Breaks a block intelligently depending on its type or player tool.
 *
 * Priority:
 * 1. Checks block tags to trigger destruction script events:
 *    - dorios:machine → dorios:destroyMachine
 *    - dorios:generator → dorios:destroyGenerator
 *    - dorios:fluid → dorios:destroyTank
 *    - dorios:furnace → dorios:destroyFurnace
 * 2. Checks held item components:
 *    - utilitycraft:hammer → dorios:hammerBlock
 *    - utilitycraft:block_loot → dorios:blockLoot
 * 3. Falls back to loot generation + manual air replace (NO destroy) to avoid double drops.
 *
 * If `veinCtx` is provided, loot is accumulated and spawned only when the vein ends.
 *
 * @param {Player} player The player breaking the block.
 * @param {ItemStack} item The item used to break the block.
 * @param {Block} block The targeted block.
 * @param {object|null} veinCtx Per-vein loot context (optional).
 */
function breakBlock(player, item, block, veinCtx = null) {
    if (!player || !block) return

    const dim = block.dimension
    const { x, y, z } = block.location
    const posString = `${x},${y},${z}`

    const lootManager = world.getLootTableManager()

    // ───── Block tags handling ─────
    if (block.hasTag('dorios:machine')) {
        player.runCommand(`scriptevent dorios:destroyMachine ${posString}`)
        return
    }

    if (block.hasTag('dorios:generator')) {
        player.runCommand(`scriptevent dorios:destroyGenerator ${posString}`)
        return
    }

    if (block.hasTag('dorios:fluid')) {
        player.runCommand(`scriptevent dorios:destroyTank ${posString}`)
        return
    }

    if (block.hasTag('dorios:furnace')) {
        player.runCommand(`scriptevent dorios:destroyFurnace ${posString}`)
        return
    }

    // ───── Item component handling ─────
    const hammerComp = item?.getComponent('utilitycraft:hammer')
    if (hammerComp) {
        player.runCommand(`scriptevent dorios:hammerBlock ${posString}`)
        return
    }

    const lootComp = item?.getComponent('utilitycraft:block_loot')
    if (lootComp) {
        player.runCommand(`scriptevent dorios:blockLoot ${posString}`)
        return
    }

    // ───── Loot generation (count per vein) ─────
    const drops = lootManager.generateLootFromBlock(block, item)

    if (veinCtx) {
        for (const drop of drops) addLoot(veinCtx, drop)
    } else {
        for (const drop of drops) dim.spawnItem(drop, block.location)
    }

    // ───── Remove block without vanilla destroy drops ─────
    dim.runCommand(`fill ${x} ${y} ${z} ${x} ${y} ${z} air`)
}


function reduceHunger(player, minusHunger = 1, minusSaturation = 1) {
    if (world.getDynamicProperty('dorios:noConsumeSaturation')) return true

    const hungerComponent = player.getComponent('minecraft:food') ?? player.getComponent('player.hunger')
    const saturationComponent = player.getComponent('player.saturation')

    if (!hungerComponent || !saturationComponent) return false

    const currentHunger = hungerComponent.currentValue
    const currentSaturation = saturationComponent.currentValue

    // Prioriza gastar saturación antes que hambre
    if (currentSaturation - minusSaturation >= 0) {
        saturationComponent.setCurrentValue(currentSaturation - minusSaturation)
        return true
    } else if (currentHunger - minusHunger >= 0) {
        hungerComponent.setCurrentValue(currentHunger - minusHunger)
        return true
    }

    return false
}


const dirs = [
    // Cardinal directions (6)
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },

    // Edge diagonals (12)
    { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 },
    { x: -1, y: 1, z: 0 }, { x: -1, y: -1, z: 0 },
    { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 },
    { x: -1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 },
    { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
    { x: 0, y: -1, z: 1 }, { x: 0, y: -1, z: -1 },

    // Corner diagonals (8)
    { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 },
    { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
    { x: -1, y: 1, z: 1 }, { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }, { x: -1, y: -1, z: -1 }
]

export const shapeNames = {
    default: "Shapeless",
    shapelessVein: "Shapeless",
    treeCapitator: "Tree Capitator",
    veinMiner: "Vein Miner",
    largeTunnel: "Tunnel 3x3",
    smallTunnel: "Tunnel 1x2",
    lineTunnel: "Tunnel 1x1"
}


export const veinHandler = {
    /**
     * Vein miner shapeless (floodfill de bloques).
     */
    'shapelessVein': async function (player, block, brokenBlock, maxVein = 64, item) {
        const ctx = createVeinContext(block)

        try {
            const visited = new Set()
            const toCheck = [block.location]
            const dim = world.getDimension(player.dimension.id)

            let cont = 0

            while (toCheck.length > 0 && cont < maxVein) {

                if (item) {
                    const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")

                    if (currentMainhand?.typeId != item.typeId) {
                        break
                    }
                }

                const pos = toCheck.shift()
                const key = `${pos.x},${pos.y},${pos.z}`
                if (visited.has(key)) continue
                visited.add(key)

                let targetBlock
                try { targetBlock = dim.getBlock(pos) } catch { }

                if (visited.size === 1 || (targetBlock && targetBlock.typeId == brokenBlock)) {
                    if (player.getGameMode().toLowerCase() == 'survival' && item?.durability.isValidComponent()) {
                        if (item.durability.damage()) {
                            player.getComponent('equippable').setEquipment('Mainhand', item)
                        } else {
                            player.getComponent('equippable').setEquipment('Mainhand',)
                            player.playSound('random.break')
                        }
                    }
                    if (cont % 10 == 0 && cont != 0) {
                        if (!reduceHunger(player)) {
                            player.addEffect('nausea', 200, { showParticles: false })
                            break
                        }
                    }
                    cont++

                    if (targetBlock) {
                        breakBlock(player, item, targetBlock, ctx)
                        await system.waitTicks(1)
                    }

                    for (const d of dirs) {
                        toCheck.push({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z })
                    }
                }
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },

    /**
     * Tree Capitator: floodfill tipo shapeless, pero sólo para bloques de árbol.
     * Rompe bloques que terminen en _log, _leaves, _stem y _wart_block.
     */
    'treeCapitator': async function (player, block, brokenBlock, maxVein = 128, item) {
        const ctx = createVeinContext(block)

        try {
            const visited = new Set()
            const toCheck = [block.location]
            const dim = world.getDimension(player.dimension.id)

            const patterns = ['_log', '_leaves', '_stem', '_wart_block']

            function isTreeBlock(typeId) {
                return patterns.some(p => typeId.endsWith(p))
            }

            let cont = 0

            while (toCheck.length > 0 && cont < maxVein) {

                if (item) {
                    const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")

                    if (currentMainhand?.typeId != item.typeId) {
                        break
                    }
                }

                const pos = toCheck.shift()
                const key = `${pos.x},${pos.y},${pos.z}`
                if (visited.has(key)) continue
                visited.add(key)

                let targetBlock
                try { targetBlock = dim.getBlock(pos) } catch { }

                // MISMA LÓGICA QUE shapelessVein:
                // primer bloque siempre, después sólo si cumple condición
                if (visited.size === 1 || (targetBlock && isTreeBlock(targetBlock.typeId))) {
                    if (player.getGameMode().toLowerCase() == 'survival' && item?.durability.isValidComponent()) {
                        if (item.durability.damage()) {
                            player.getComponent('equippable').setEquipment('Mainhand', item)
                        } else {
                            player.getComponent('equippable').setEquipment('Mainhand',)
                            player.playSound('random.break')
                        }
                    }
                    if (cont % 10 == 0 && cont != 0) {
                        if (!reduceHunger(player)) {
                            player.addEffect('nausea', 200, { showParticles: false })
                            break
                        }
                    }
                    cont++

                    if (targetBlock) {
                        breakBlock(player, item, targetBlock, ctx)
                        await system.waitTicks(1)
                    }

                    // MISMO uso de dirs que shapeless
                    for (const d of dirs) {
                        toCheck.push({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z })
                    }
                }
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },

    /**
     * Vein miner de minerales: floodfill tipo shapeless,
     * pero sólo para bloques _ore y ancient_debris.
     */
    'veinMiner': async function (player, block, brokenBlock, maxVein = 64, item) {
        const ctx = createVeinContext(block)

        try {
            const visited = new Set()
            const toCheck = [block.location]
            const dim = world.getDimension(player.dimension.id)

            function isOreBlock(typeId) {
                return typeId.endsWith('_ore') || typeId === 'minecraft:ancient_debris'
            }

            let cont = 0

            while (toCheck.length > 0 && cont < maxVein) {

                if (item) {
                    const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")

                    if (currentMainhand?.typeId != item.typeId) {
                        break
                    }
                }

                const pos = toCheck.shift()
                const key = `${pos.x},${pos.y},${pos.z}`
                if (visited.has(key)) continue
                visited.add(key)

                let targetBlock
                try { targetBlock = dim.getBlock(pos) } catch { }

                if (visited.size === 1 || (targetBlock && isOreBlock(targetBlock.typeId))) {
                    if (player.getGameMode().toLowerCase() == 'survival' && item?.durability.isValidComponent()) {
                        if (item.durability.damage()) {
                            player.getComponent('equippable').setEquipment('Mainhand', item)
                        } else {
                            player.getComponent('equippable').setEquipment('Mainhand',)
                            player.playSound('random.break')
                        }
                    }
                    if (cont % 10 == 0 && cont != 0) {
                        if (!reduceHunger(player)) {
                            player.addEffect('nausea', 200, { showParticles: false })
                            break
                        }
                    }
                    cont++

                    if (targetBlock) {
                        breakBlock(player, item, targetBlock, ctx)
                        await system.waitTicks(1)
                    }

                    for (const d of dirs) {
                        toCheck.push({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z })
                    }
                }
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },

    /**
     * Gran túnel en forma de espiral 3x3 hacia adelante.
     */
    'largeTunnel': async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
        const ctx = createVeinContext(brokenBlock)

        try {
            const maxLength = Math.floor(maxVein / 4)
            const maxBlocks = maxVein * 2
            const matchType = true
            const allowVertical = true

            const dim = world.getDimension(player.dimension.id)
            const origin = brokenBlock.location

            const v = player.getViewDirection()
            let axis, stepSign
            if (!allowVertical) {
                if (Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                }
            } else {
                if (Math.abs(v.x) >= Math.abs(v.y) && Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else if (Math.abs(v.z) >= Math.abs(v.y)) {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                } else {
                    axis = "y"; stepSign = v.y >= 0 ? 1 : -1
                }
            }

            function getBlock(x, y, z) {
                try {
                    const b = dim.getBlock({ x, y, z })
                    if (!b) return null
                    if (b.typeId === "minecraft:air") return null
                    if (blacklist.includes(b.typeId)) return null
                    if (matchType && b.typeId !== brokenBlockPerm) return null
                    return b
                } catch {
                    return false
                }
            }

            function spiralOffsets(outward = true) {
                const orderOut = [
                    [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1],
                    [-1, 0], [-1, -1], [0, -1], [1, -1]
                ]
                return outward ? orderOut : orderOut.slice().reverse()
            }

            let broken = 0
            let outward = true
            let sliceStart = 0

            {
                let sliceCenter = { ...origin }
                const order = spiralOffsets(outward)
                let hasSolid = false
                for (const [dx, dy] of order) {
                    let x = sliceCenter.x, y = sliceCenter.y, z = sliceCenter.z
                    if (axis === "x") { y += dx; z += dy }
                    if (axis === "y") { x += dx; z += dy }
                    if (axis === "z") { x += dx; y += dy }
                    if (getBlock(x, y, z)) { hasSolid = true; break }
                }
                if (!hasSolid) sliceStart = 1
            }

            let cont = 0
            for (let d = sliceStart; d <= maxLength; d++) {
                let sliceCenter = { ...origin }
                if (axis === "x") sliceCenter.x += d * stepSign
                if (axis === "y") sliceCenter.y += d * stepSign
                if (axis === "z") sliceCenter.z += d * stepSign

                let foundInSlice = false
                const order = spiralOffsets(outward)

                for (const [dx, dy] of order) {
                    if (item) {
                        const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")

                        if (currentMainhand?.typeId != item.typeId) {
                            break
                        }
                    }

                    let x = sliceCenter.x, y = sliceCenter.y, z = sliceCenter.z
                    if (axis === "x") { y += dx; z += dy }
                    if (axis === "y") { x += dx; z += dy }
                    if (axis === "z") { x += dx; y += dy }

                    const blk = getBlock(x, y, z)
                    if (!blk) continue

                    if (player.getGameMode().toLowerCase() == 'survival' && item?.durability.isValidComponent()) {
                        if (item.durability.damage()) {
                            player.getComponent('equippable').setEquipment('Mainhand', item)
                        } else {
                            player.getComponent('equippable').setEquipment('Mainhand',)
                            player.playSound('random.break')
                        }
                    }
                    if (cont % 10 == 0 && cont != 0) {
                        if (!reduceHunger(player)) {
                            player.addEffect('nausea', 200, { showParticles: false })
                            break
                        }
                    }

                    try {
                        cont++
                        breakBlock(player, item, blk, ctx)
                    } catch (e) {
                        console.warn(`[VeinTunnel] Error en ${x},${y},${z}:`, e)
                        return
                    }

                    broken++
                    foundInSlice = true
                    if (broken + 1 >= maxBlocks) return
                    await system.waitTicks(1)
                }

                if (!foundInSlice) break
                outward = !outward
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },

    /**
     * Pequeño túnel 1x2 hacia adelante.
     */
    'smallTunnel': async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
        const ctx = createVeinContext(brokenBlock)

        try {
            const maxLength = Math.floor(maxVein / 2) // shorter than large
            const matchType = true
            const allowVertical = true

            const dim = world.getDimension(player.dimension.id)
            const origin = brokenBlock.location

            const v = player.getViewDirection()
            let axis, stepSign
            if (!allowVertical) {
                if (Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                }
            } else {
                if (Math.abs(v.x) >= Math.abs(v.y) && Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else if (Math.abs(v.z) >= Math.abs(v.y)) {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                } else {
                    axis = "y"; stepSign = v.y >= 0 ? 1 : -1
                }
            }

            function getBlock(x, y, z) {
                try {
                    const b = dim.getBlock({ x, y, z })
                    if (!b || b.typeId === "minecraft:air") return null
                    if (blacklist.includes(b.typeId)) return null
                    if (matchType && b.typeId !== brokenBlockPerm) return null
                    return b
                } catch {
                    return false
                }
            }

            let cont = 0
            for (let d = 0; d < maxLength; d++) {
                // move forward along axis
                let base = { ...origin }
                if (axis === "x") base.x += d * stepSign
                if (axis === "y") base.y += d * stepSign
                if (axis === "z") base.z += d * stepSign

                // mine 1×2 area (block and one above)
                const offsets = [
                    { dx: 0, dy: 0, dz: 0 },
                    { dx: 0, dy: 1, dz: 0 }
                ]

                for (const { dx, dy, dz } of offsets) {
                    if (item) {
                        const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")
                        if (currentMainhand?.typeId !== item.typeId) return
                    }

                    let x = base.x + dx
                    let y = base.y + dy
                    let z = base.z + dz

                    const blk = getBlock(x, y, z)
                    if (!blk) continue

                    if (player.getGameMode().toLowerCase() === 'survival' && item?.durability.isValidComponent()) {
                        if (item.durability.damage()) {
                            player.getComponent('equippable').setEquipment('Mainhand', item)
                        } else {
                            player.getComponent('equippable').setEquipment('Mainhand')
                            player.playSound('random.break')
                        }
                    }

                    if (cont % 10 === 0 && cont !== 0) {
                        if (!reduceHunger(player)) {
                            player.addEffect('nausea', 200, { showParticles: false })
                            return
                        }
                    }

                    try {
                        cont++
                        breakBlock(player, item, blk, ctx)
                    } catch (e) {
                        console.warn(`[VeinSmallTunnel] Error en ${x},${y},${z}:`, e)
                        return
                    }

                    await system.waitTicks(1)
                }
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },

    /**
     * Túnel lineal 1x1 hacia adelante.
     */
    'lineTunnel': async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
        const ctx = createVeinContext(brokenBlock)

        try {
            const maxLength = maxVein // cada bloque equivale a 1 paso
            const matchType = true
            const allowVertical = true

            const dim = world.getDimension(player.dimension.id)
            const origin = brokenBlock.location

            const v = player.getViewDirection()
            let axis, stepSign

            if (!allowVertical) {
                if (Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                }
            } else {
                if (Math.abs(v.x) >= Math.abs(v.y) && Math.abs(v.x) >= Math.abs(v.z)) {
                    axis = "x"; stepSign = v.x >= 0 ? 1 : -1
                } else if (Math.abs(v.z) >= Math.abs(v.y)) {
                    axis = "z"; stepSign = v.z >= 0 ? 1 : -1
                } else {
                    axis = "y"; stepSign = v.y >= 0 ? 1 : -1
                }
            }

            function getBlock(x, y, z) {
                try {
                    const b = dim.getBlock({ x, y, z })
                    if (!b || b.typeId === "minecraft:air") return null
                    if (blacklist.includes(b.typeId)) return null
                    if (matchType && b.typeId !== brokenBlockPerm) return null
                    return b
                } catch {
                    return false
                }
            }

            let cont = 0
            for (let d = 0; d < maxLength; d++) {
                let pos = { ...origin }
                if (axis === "x") pos.x += d * stepSign
                if (axis === "y") pos.y += d * stepSign
                if (axis === "z") pos.z += d * stepSign

                if (item) {
                    const currentMainhand = player.getComponent("equippable").getEquipment("Mainhand")
                    if (currentMainhand?.typeId !== item.typeId) break
                }

                const blk = getBlock(pos.x, pos.y, pos.z)
                if (!blk) continue

                if (player.getGameMode().toLowerCase() === 'survival' && item?.durability.isValidComponent()) {
                    if (item.durability.damage()) {
                        player.getComponent('equippable').setEquipment('Mainhand', item)
                    } else {
                        player.getComponent('equippable').setEquipment('Mainhand')
                        player.playSound('random.break')
                    }
                }

                if (cont % 10 === 0 && cont !== 0) {
                    if (!reduceHunger(player)) {
                        player.addEffect('nausea', 200, { showParticles: false })
                        break
                    }
                }

                try {
                    cont++
                    breakBlock(player, item, blk, ctx)
                } catch (e) {
                    console.warn(`[VeinLineTunnel] Error en ${pos.x},${pos.y},${pos.z}:`, e)
                    return
                }

                await system.waitTicks(1)
            }
        } finally {
            dropVeinLoot(ctx)
        }
    },
}


world.afterEvents.playerBreakBlock.subscribe(async e => {
    const { player, brokenBlockPermutation, block, itemStackBeforeBreak } = e

    if (!player.isSneaking || player.getGameMode().toLowerCase() == 'creative') return
    if (player.getDynamicProperty("dorios:isAdding") || player.getDynamicProperty("dorios:isBlacklistAdding") || player.getDynamicProperty("dorios:isDefaultAdding")) return

    let isEnabled = player.getDynamicProperty('dorios:veinEnabled')
    let veinShape = player.getDynamicProperty('dorios:veinShape')
    let veinLimit = player.getDynamicProperty('dorios:veinLimit')
    let veinList = player.getDynamicProperty("dorios:veinList")

    if (isEnabled == undefined) {
        player.setDynamicProperty('dorios:veinEnabled', true)
        isEnabled = true
    }

    if (veinShape == undefined) {
        player.setDynamicProperty('dorios:veinShape', 'shapelessVein')
        veinShape = 'shapelessVein'
    }

    if (veinLimit == undefined) {
        player.setDynamicProperty('dorios:veinLimit', 64)
        veinLimit = 64
    }

    if (veinList == undefined) {
        player.setDynamicProperty('dorios:veinList', JSON.stringify(list))
        veinList = list
    } else {
        veinList = JSON.parse(veinList)
    }

    let brokenBlock = brokenBlockPermutation.type.id

    if (blacklist.includes(brokenBlock)) {
        veinList = veinList.filter(id => id !== brokenBlock)
        player.setDynamicProperty('dorios:veinList', JSON.stringify(veinList))
        return
    }

    if (brokenBlock.includes('redstone_ore')) {
        brokenBlock = brokenBlock.replace("lit_", "")
    }

    if (!isEnabled || !is_diggable(itemStackBeforeBreak, brokenBlockPermutation)) return
    if (player.getComponent('player.hunger').currentValue == 0) return

    let vein = veinHandler[veinShape]

    if (veinShape == "largeTunnel" || veinShape == "smallTunnel") {
        vein(player, block, brokenBlock, veinLimit, itemStackBeforeBreak)
    } else {
        if (!veinList.includes(`${brokenBlock}`)) return
        vein(player, block, brokenBlock, veinLimit, itemStackBeforeBreak)
    }
})
