import { world, system } from '@minecraft/server'
import { list, blacklist, maxLimit } from 'global_variables.js'
import { is_diggable } from 'is_diggable.js'
import { Player, ItemStack, Block } from '@minecraft/server'

const DEFAULT_SETTINGS = {
    consumeInterval: 10,
    hungerCost: 1,
    saturationCost: 1,
    breakDelayEvery: 32,
    breakDelayTicks: 1,
    veinConnectDefault: false,
}

function msg(str) {
    world.sendMessage(`${JSON.stringify(str)}`)
}

function getNumberSetting(propertyId, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
    const raw = world.getDynamicProperty(propertyId)
    const value = Number(raw)

    if (!Number.isFinite(value)) return fallback
    return Math.min(Math.max(value, min), max)
}

function getBooleanSetting(propertyId, fallback = false) {
    const raw = world.getDynamicProperty(propertyId)
    return typeof raw === 'boolean' ? raw : fallback
}

function normalizeTypeId(typeId) {
    if (!typeId) return typeId

    return typeId
        .replace('minecraft:lit_redstone_ore', 'minecraft:redstone_ore')
        .replace('minecraft:lit_deepslate_redstone_ore', 'minecraft:deepslate_redstone_ore')
}

function shouldConsumeFoodAt(counter) {
    const interval = getNumberSetting('dorios:consumeInterval', DEFAULT_SETTINGS.consumeInterval, 1, 1024)
    return counter !== 0 && counter % interval === 0
}

function shouldDelayAt(counter) {
    const interval = getNumberSetting('dorios:breakDelayEvery', DEFAULT_SETTINGS.breakDelayEvery, 1, 1024)
    return counter !== 0 && counter % interval === 0
}

async function handleBreakDelay(counter) {
    if (!shouldDelayAt(counter)) return

    const ticks = getNumberSetting('dorios:breakDelayTicks', DEFAULT_SETTINGS.breakDelayTicks, 0, 20)
    if (ticks > 0) {
        await system.waitTicks(ticks)
    }
}

function shouldBreakConnectedType(targetTypeId, brokenBlock, veinConnect, veinListSet) {
    const normalizedTarget = normalizeTypeId(targetTypeId)
    if (!normalizedTarget || blacklist.includes(normalizedTarget)) return false

    if (normalizedTarget === brokenBlock) return true
    if (!veinConnect || !veinListSet) return false

    return veinListSet.has(normalizedTarget)
}

function blockKey(pos) {
    return `${pos.x},${pos.y},${pos.z}`
}

function isAirBlock(block) {
    return !block || block.typeId === 'minecraft:air'
}

function getGameMode(player) {
    try {
        return player.getGameMode().toLowerCase()
    } catch {
        return ''
    }
}

function getMainhand(player) {
    try {
        return player.getComponent('equippable')?.getEquipment('Mainhand')
    } catch {
        return undefined
    }
}

function getEffectiveVeinLimit(player) {
    const playerLimit = Number(player.getDynamicProperty('dorios:veinLimit') ?? 64)
    const worldLimit = Number(world.getDynamicProperty('dorios:maxLimit') ?? maxLimit ?? 128)
    const safePlayerLimit = Number.isFinite(playerLimit) ? playerLimit : 64
    const safeWorldLimit = Number.isFinite(worldLimit) && worldLimit > 0 ? worldLimit : safePlayerLimit

    return Math.max(1, Math.floor(Math.min(safePlayerLimit, safeWorldLimit)))
}

function parseVeinList(player) {
    const raw = player.getDynamicProperty('dorios:veinList')
    if (raw === undefined) {
        player.setDynamicProperty('dorios:veinList', JSON.stringify(list))
        return [...list]
    }

    if (Array.isArray(raw)) return raw

    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : [...list]
    } catch {
        return [...list]
    }
}

function getVeinSettings(player) {
    let isEnabled = player.getDynamicProperty('dorios:veinEnabled')
    let veinShape = player.getDynamicProperty('dorios:veinShape')
    let veinConnect = player.getDynamicProperty('dorios:veinConnect')

    if (isEnabled == undefined) {
        player.setDynamicProperty('dorios:veinEnabled', true)
        isEnabled = true
    }

    if (veinShape == undefined) {
        player.setDynamicProperty('dorios:veinShape', 'shapelessVein')
        veinShape = 'shapelessVein'
    }

    if (player.getDynamicProperty('dorios:veinLimit') == undefined) {
        player.setDynamicProperty('dorios:veinLimit', 64)
    }

    const veinList = parseVeinList(player)

    if (veinConnect == undefined) {
        const defaultConnect = getBooleanSetting('dorios:veinConnectDefault', DEFAULT_SETTINGS.veinConnectDefault)
        player.setDynamicProperty('dorios:veinConnect', defaultConnect)
        veinConnect = defaultConnect
    }

    const normalizedVeinList = veinList.map(typeId => normalizeTypeId(typeId))

    return {
        isEnabled: !!isEnabled,
        veinShape,
        veinLimit: getEffectiveVeinLimit(player),
        veinList,
        veinListSet: new Set(normalizedVeinList),
        veinConnect: !!veinConnect,
    }
}

function removeBlacklistedFromPlayerList(player, veinList, typeId) {
    const nextList = veinList.filter(id => normalizeTypeId(id) !== typeId)
    player.setDynamicProperty('dorios:veinList', JSON.stringify(nextList))
}

function isTreeBlock(typeId) {
    return ['_log', '_leaves', '_stem', '_wart_block'].some(p => typeId.endsWith(p))
}

function isOreBlock(typeId) {
    return typeId.endsWith('_ore') || typeId === 'minecraft:ancient_debris'
}

function getAxisFromView(player, allowVertical = true) {
    const v = player.getViewDirection()

    if (!allowVertical) {
        if (Math.abs(v.x) >= Math.abs(v.z)) return { axis: 'x', stepSign: v.x >= 0 ? 1 : -1 }
        return { axis: 'z', stepSign: v.z >= 0 ? 1 : -1 }
    }

    if (Math.abs(v.x) >= Math.abs(v.y) && Math.abs(v.x) >= Math.abs(v.z)) {
        return { axis: 'x', stepSign: v.x >= 0 ? 1 : -1 }
    }

    if (Math.abs(v.z) >= Math.abs(v.y)) {
        return { axis: 'z', stepSign: v.z >= 0 ? 1 : -1 }
    }

    return { axis: 'y', stepSign: v.y >= 0 ? 1 : -1 }
}

function offsetByAxis(origin, axis, stepSign, distance) {
    const pos = { ...origin }
    if (axis === 'x') pos.x += distance * stepSign
    if (axis === 'y') pos.y += distance * stepSign
    if (axis === 'z') pos.z += distance * stepSign
    return pos
}

function getTunnelSlicePosition(center, axis, dx, dy) {
    const pos = { ...center }
    if (axis === 'x') { pos.y += dx; pos.z += dy }
    if (axis === 'y') { pos.x += dx; pos.z += dy }
    if (axis === 'z') { pos.x += dx; pos.y += dy }
    return pos
}

function spiralOffsets(outward = true) {
    const orderOut = [
        [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1],
        [-1, 0], [-1, -1], [0, -1], [1, -1]
    ]
    return outward ? orderOut : orderOut.slice().reverse()
}

function getMatchingBlock(dim, pos, brokenBlock, matchType = true) {
    try {
        const b = dim.getBlock(pos)
        if (isAirBlock(b)) return null

        const normalized = normalizeTypeId(b.typeId)
        if (blacklist.includes(normalized)) return null
        if (matchType && normalized !== brokenBlock) return null

        return b
    } catch {
        return null
    }
}

function canPreviewConsumeAt(player, counter, spent) {
    if (!shouldConsumeFoodAt(counter) || world.getDynamicProperty('dorios:noConsumeSaturation')) return true

    const minusHunger = Math.floor(getNumberSetting('dorios:hungerCost', DEFAULT_SETTINGS.hungerCost, 0, 20))
    const minusSaturation = Math.floor(getNumberSetting('dorios:saturationCost', DEFAULT_SETTINGS.saturationCost, 0, 20))
    if (minusHunger <= 0 && minusSaturation <= 0) return true

    const hungerComponent = player.getComponent('minecraft:food') ?? player.getComponent('player.hunger')
    const saturationComponent = player.getComponent('player.saturation')
    if (!hungerComponent || !saturationComponent) return false

    const hunger = hungerComponent.currentValue - spent.hunger
    const saturation = saturationComponent.currentValue - spent.saturation

    if (minusSaturation > 0 && saturation - minusSaturation >= 0) {
        spent.saturation += minusSaturation
        return true
    }

    if (minusHunger > 0 && hunger - minusHunger >= 0) {
        spent.hunger += minusHunger
        return true
    }

    return false
}

function itemStillMatches(player, item) {
    if (!item) return true
    const currentMainhand = getMainhand(player)
    return currentMainhand?.typeId === item.typeId
}

function calculateFloodfillBlocks(player, block, brokenBlock, maxVein, item, options, predicate) {
    const result = []
    const visited = new Set()
    const toCheck = [block.location]
    const dim = world.getDimension(player.dimension.id)
    const veinConnect = !!options.veinConnect
    const veinListSet = options.veinListSet instanceof Set ? options.veinListSet : null
    const spent = { hunger: 0, saturation: 0 }
    let cont = 0

    while (toCheck.length > 0 && cont < maxVein) {
        if (!itemStillMatches(player, item)) break

        const pos = toCheck.shift()
        const key = blockKey(pos)
        if (visited.has(key)) continue
        visited.add(key)

        let targetBlock
        try { targetBlock = dim.getBlock(pos) } catch { }

        const isOrigin = visited.size === 1
        const matches = targetBlock && predicate(targetBlock.typeId, brokenBlock, veinConnect, veinListSet)

        if (isOrigin || matches) {
            if (!canPreviewConsumeAt(player, cont, spent)) break

            cont++
            if (targetBlock && !isAirBlock(targetBlock)) result.push(targetBlock)

            for (const d of dirs) {
                toCheck.push({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z })
            }
        }
    }

    return result
}

export function calculateVeinBlocks(player, block, brokenBlock, maxVein = 64, item, options = {}) {
    return calculateFloodfillBlocks(
        player,
        block,
        brokenBlock,
        maxVein,
        item,
        options,
        (typeId, originTypeId, veinConnect, veinListSet) => shouldBreakConnectedType(typeId, originTypeId, veinConnect, veinListSet)
    )
}

export function calculateTreeBlocks(player, block, brokenBlock, maxVein = 128, item, options = {}) {
    return calculateFloodfillBlocks(
        player,
        block,
        brokenBlock,
        maxVein,
        item,
        options,
        typeId => isTreeBlock(typeId)
    )
}

export function calculateOreBlocks(player, block, brokenBlock, maxVein = 64, item, options = {}) {
    return calculateFloodfillBlocks(
        player,
        block,
        brokenBlock,
        maxVein,
        item,
        options,
        typeId => isOreBlock(typeId)
    )
}

export function calculateLargeTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
    const result = []
    const maxLength = Math.floor(maxVein / 4)
    const maxBlocks = maxVein * 2
    const dim = world.getDimension(player.dimension.id)
    const origin = brokenBlock.location
    const { axis, stepSign } = getAxisFromView(player, true)
    const spent = { hunger: 0, saturation: 0 }

    let broken = 0
    let outward = true
    let sliceStart = 0

    {
        const sliceCenter = { ...origin }
        const order = spiralOffsets(outward)
        let hasSolid = false

        for (const [dx, dy] of order) {
            const pos = getTunnelSlicePosition(sliceCenter, axis, dx, dy)
            if (getMatchingBlock(dim, pos, brokenBlockPerm, true)) {
                hasSolid = true
                break
            }
        }

        if (!hasSolid) sliceStart = 1
    }

    let cont = 0
    for (let d = sliceStart; d <= maxLength; d++) {
        const sliceCenter = offsetByAxis(origin, axis, stepSign, d)
        let foundInSlice = false
        const order = spiralOffsets(outward)

        for (const [dx, dy] of order) {
            if (!itemStillMatches(player, item)) break

            const pos = getTunnelSlicePosition(sliceCenter, axis, dx, dy)
            const blk = getMatchingBlock(dim, pos, brokenBlockPerm, true)
            if (!blk) continue
            if (!canPreviewConsumeAt(player, cont, spent)) return result

            cont++
            result.push(blk)
            broken++
            foundInSlice = true
            if (broken + 1 >= maxBlocks) return result
        }

        if (!foundInSlice) break
        outward = !outward
    }

    return result
}

export function calculateSmallTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
    const result = []
    const maxLength = Math.floor(maxVein / 2)
    const dim = world.getDimension(player.dimension.id)
    const origin = brokenBlock.location
    const { axis, stepSign } = getAxisFromView(player, true)
    const spent = { hunger: 0, saturation: 0 }
    const offsets = [
        { dx: 0, dy: 0, dz: 0 },
        { dx: 0, dy: 1, dz: 0 }
    ]

    let cont = 0
    for (let d = 0; d < maxLength; d++) {
        const base = offsetByAxis(origin, axis, stepSign, d)

        for (const { dx, dy, dz } of offsets) {
            if (!itemStillMatches(player, item)) return result

            const pos = { x: base.x + dx, y: base.y + dy, z: base.z + dz }
            const blk = getMatchingBlock(dim, pos, brokenBlockPerm, true)
            if (!blk) continue
            if (!canPreviewConsumeAt(player, cont, spent)) return result

            cont++
            result.push(blk)
        }
    }

    return result
}

export function calculateLineTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein = 64, item) {
    const result = []
    const dim = world.getDimension(player.dimension.id)
    const origin = brokenBlock.location
    const { axis, stepSign } = getAxisFromView(player, true)
    const spent = { hunger: 0, saturation: 0 }
    let cont = 0

    for (let d = 0; d < maxVein; d++) {
        if (!itemStillMatches(player, item)) break

        const pos = offsetByAxis(origin, axis, stepSign, d)
        const blk = getMatchingBlock(dim, pos, brokenBlockPerm, true)
        if (!blk) continue
        if (!canPreviewConsumeAt(player, cont, spent)) break

        cont++
        result.push(blk)
    }

    return result
}

const blockCalculators = {
    shapelessVein: calculateVeinBlocks,
    treeCapitator: calculateTreeBlocks,
    veinMiner: calculateOreBlocks,
    largeTunnel: calculateLargeTunnelBlocks,
    smallTunnel: calculateSmallTunnelBlocks,
    lineTunnel: calculateLineTunnelBlocks,
}

function getCalculatedBlocks(player, block, brokenBlock, maxVein, item, options = {}) {
    const calculator = blockCalculators[options.veinShape ?? 'shapelessVein']
    if (typeof calculator !== 'function') return []
    return calculator(player, block, brokenBlock, maxVein, item, options)
}

async function mineCalculatedBlocks(player, item, blocks, contextBlock = null, startCounter = 0) {
    if (blocks.length === 0) return

    const ctx = createVeinContext(contextBlock ?? blocks[0])
    let cont = startCounter

    try {
        for (const block of blocks) {
            if (!itemStillMatches(player, item)) break

            if (getGameMode(player) === 'survival' && item?.durability.isValidComponent()) {
                if (item.durability.damage()) {
                    player.getComponent('equippable').setEquipment('Mainhand', item)
                } else {
                    player.getComponent('equippable').setEquipment('Mainhand')
                    player.playSound('random.break')
                }
            }

            if (shouldConsumeFoodAt(cont)) {
                if (!reduceHunger(player)) {
                    player.addEffect('nausea', 200, { showParticles: false })
                    break
                }
            }

            cont++
            if (!isAirBlock(block)) breakBlock(player, item, block, ctx)
            await handleBreakDelay(cont)
        }
    } finally {
        dropVeinLoot(ctx)
    }
}

const OUTLINE_ENTITY_ID = 'dorios:excavate_outline'
const OUTLINE_UPDATE_TICKS = 4
const activeOutlines = new Map()
const OUTLINE_EDGE_PROPERTIES = [
    'dorios:edge_x_y0_z0',
    'dorios:edge_x_y0_z1',
    'dorios:edge_x_y1_z0',
    'dorios:edge_x_y1_z1',
    'dorios:edge_y_x0_z0',
    'dorios:edge_y_x0_z1',
    'dorios:edge_y_x1_z0',
    'dorios:edge_y_x1_z1',
    'dorios:edge_z_x0_y0',
    'dorios:edge_z_x0_y1',
    'dorios:edge_z_x1_y0',
    'dorios:edge_z_x1_y1',
]

const OUTLINE_EDGE_DEFS = [
    { name: 'edge_x_y0_z0', property: 'dorios:edge_x_y0_z0', axis: 'x', ySide: 0, zSide: 1 },
    { name: 'edge_x_y0_z1', property: 'dorios:edge_x_y0_z1', axis: 'x', ySide: 0, zSide: 0 },
    { name: 'edge_x_y1_z0', property: 'dorios:edge_x_y1_z0', axis: 'x', ySide: 1, zSide: 1 },
    { name: 'edge_x_y1_z1', property: 'dorios:edge_x_y1_z1', axis: 'x', ySide: 1, zSide: 0 },
    { name: 'edge_y_x0_z0', property: 'dorios:edge_y_x0_z0', axis: 'y', xSide: 0, zSide: 1 },
    { name: 'edge_y_x0_z1', property: 'dorios:edge_y_x0_z1', axis: 'y', xSide: 0, zSide: 0 },
    { name: 'edge_y_x1_z0', property: 'dorios:edge_y_x1_z0', axis: 'y', xSide: 1, zSide: 1 },
    { name: 'edge_y_x1_z1', property: 'dorios:edge_y_x1_z1', axis: 'y', xSide: 1, zSide: 0 },
    { name: 'edge_z_x0_y0', property: 'dorios:edge_z_x0_y0', axis: 'z', xSide: 0, ySide: 0 },
    { name: 'edge_z_x0_y1', property: 'dorios:edge_z_x0_y1', axis: 'z', xSide: 0, ySide: 1 },
    { name: 'edge_z_x1_y0', property: 'dorios:edge_z_x1_y0', axis: 'z', xSide: 1, ySide: 0 },
    { name: 'edge_z_x1_y1', property: 'dorios:edge_z_x1_y1', axis: 'z', xSide: 1, ySide: 1 },
]

function removeEntity(entity) {
    try {
        const isValid = typeof entity?.isValid === 'function' ? entity.isValid() : entity?.isValid
        if (isValid) entity.remove()
    } catch { }
}

function isEntityValid(entity) {
    try {
        return typeof entity?.isValid === 'function' ? entity.isValid() : !!entity?.isValid
    } catch {
        return false
    }
}

function clearPlayerOutline(playerId) {
    const state = activeOutlines.get(playerId)
    if (!state) return

    for (const entity of state.entities) removeEntity(entity)
    activeOutlines.delete(playerId)
}

function clearStaleOutlines(activePlayerIds) {
    for (const playerId of activeOutlines.keys()) {
        if (!activePlayerIds.has(playerId)) clearPlayerOutline(playerId)
    }
}

function cleanupAllOutlineEntities() {
    for (const dimensionId of ['overworld', 'nether', 'the_end']) {
        try {
            const dim = world.getDimension(dimensionId)
            for (const entity of dim.getEntities({ type: OUTLINE_ENTITY_ID })) {
                removeEntity(entity)
            }
        } catch { }
    }
    activeOutlines.clear()
}

function getPointedBlock(player) {
    try {
        const hit = player.getBlockFromViewDirection({
            maxDistance: 8,
            includeLiquidBlocks: false,
            includePassableBlocks: false,
        })

        return hit?.block
    } catch {
        return undefined
    }
}

function getPreviewBlocks(player) {
    if (!player.isSneaking || getGameMode(player) === 'creative') return []
    if (player.getDynamicProperty("dorios:isAdding") || player.getDynamicProperty("dorios:isBlacklistAdding") || player.getDynamicProperty("dorios:isDefaultAdding")) return []

    const settings = getVeinSettings(player)
    if (!settings.isEnabled) return []

    const block = getPointedBlock(player)
    if (!block || isAirBlock(block)) return []

    const brokenBlock = normalizeTypeId(block.typeId)
    if (!brokenBlock || blacklist.includes(brokenBlock)) return []

    const item = getMainhand(player)
    if (!is_diggable(item, block.permutation)) return []

    const hunger = player.getComponent('player.hunger') ?? player.getComponent('minecraft:food')
    if (hunger && hunger.currentValue === 0) return []

    const vein = veinHandler[settings.veinShape]
    if (typeof vein !== 'function') return []

    if (
        settings.veinShape !== 'largeTunnel' &&
        settings.veinShape !== 'smallTunnel' &&
        settings.veinShape !== 'lineTunnel' &&
        !settings.veinListSet.has(brokenBlock)
    ) {
        return []
    }

    return getCalculatedBlocks(player, block, brokenBlock, settings.veinLimit, item, {
        veinShape: settings.veinShape,
        veinConnect: settings.veinConnect,
        veinListSet: settings.veinListSet,
    })
}

function getOutlineSignature(player, blocks) {
    if (blocks.length === 0) return ''

    const item = getMainhand(player)
    const positions = blocks.map(block => blockKey(block.location)).join('|')

    return [
        player.dimension.id,
        player.getDynamicProperty('dorios:veinShape') ?? 'shapelessVein',
        getEffectiveVeinLimit(player),
        item?.typeId ?? 'hand',
        positions,
    ].join(';')
}

function sideCandidates(value, side) {
    return side === 0 ? [value - 1, value] : [value, value + 1]
}

function getCellsAroundEdge(pos, edgeDef) {
    const cells = []

    if (edgeDef.axis === 'x') {
        for (const y of sideCandidates(pos.y, edgeDef.ySide)) {
            for (const z of sideCandidates(pos.z, edgeDef.zSide)) {
                cells.push({ x: pos.x, y, z })
            }
        }
    } else if (edgeDef.axis === 'y') {
        for (const x of sideCandidates(pos.x, edgeDef.xSide)) {
            for (const z of sideCandidates(pos.z, edgeDef.zSide)) {
                cells.push({ x, y: pos.y, z })
            }
        }
    } else {
        for (const x of sideCandidates(pos.x, edgeDef.xSide)) {
            for (const y of sideCandidates(pos.y, edgeDef.ySide)) {
                cells.push({ x, y, z: pos.z })
            }
        }
    }

    return cells
}

function isDiagonalEdgePair(selectedIndexes) {
    if (selectedIndexes.length !== 2) return false
    return (
        (selectedIndexes[0] === 0 && selectedIndexes[1] === 3) ||
        (selectedIndexes[0] === 1 && selectedIndexes[1] === 2)
    )
}

function shouldShowEdge(selectedIndexes) {
    if (selectedIndexes.length === 1 || selectedIndexes.length === 3) return true
    return isDiagonalEdgePair(selectedIndexes)
}

function createOutlineEdgeMap(blocks) {
    const selected = new Set(blocks.map(block => blockKey(block.location)))
    const edgeMap = new Map()

    for (const block of blocks) {
        const currentKey = blockKey(block.location)

        for (const edgeDef of OUTLINE_EDGE_DEFS) {
            const cells = getCellsAroundEdge(block.location, edgeDef)
            const selectedIndexes = []
            const selectedKeys = []

            for (let i = 0; i < cells.length; i++) {
                const key = blockKey(cells[i])
                if (selected.has(key)) {
                    selectedIndexes.push(i)
                    selectedKeys.push(key)
                }
            }

            if (!shouldShowEdge(selectedIndexes)) continue

            const ownerKey = selectedKeys.sort()[0]
            if (ownerKey !== currentKey) continue

            if (!edgeMap.has(currentKey)) edgeMap.set(currentKey, new Set())
            edgeMap.get(currentKey).add(edgeDef.property)
        }
    }

    return edgeMap
}

function applyOutlineEdges(entity, visibleEdges) {
    for (const property of OUTLINE_EDGE_PROPERTIES) {
        try {
            entity.setProperty(property, visibleEdges.has(property))
        } catch (e) {
            console.warn(`[ExcavateOutline] Could not set edge property ${property}: ${e}`)
        }
    }
}

function setPlayerOutline(player, blocks) {
    const signature = getOutlineSignature(player, blocks)
    const previous = activeOutlines.get(player.id)

    if (!signature) {
        clearPlayerOutline(player.id)
        return
    }

    if (previous?.signature === signature && previous.entities.every(entity => isEntityValid(entity))) {
        return
    }

    clearPlayerOutline(player.id)

    const entities = []
    const edgeMap = createOutlineEdgeMap(blocks)

    for (const block of blocks) {
        const visibleEdges = edgeMap.get(blockKey(block.location))
        if (!visibleEdges || visibleEdges.size === 0) continue

        try {
            const { x, y, z } = block.location
            const entity = block.dimension.spawnEntity(OUTLINE_ENTITY_ID, { x: x + 0.5, y, z: z + 0.5 })
            applyOutlineEdges(entity, visibleEdges)
            entities.push(entity)
        } catch (e) {
            console.warn(`[ExcavateOutline] Could not spawn outline: ${e}`)
        }
    }

    activeOutlines.set(player.id, { signature, entities })
}

system.afterEvents?.scriptEventReceive?.subscribe(e => {
    if (e.id === 'dorios:clearExcavateOutlines') cleanupAllOutlineEntities()
})

world.afterEvents.worldLoad.subscribe(() => {
    system.runTimeout(cleanupAllOutlineEntities, 1)
})

system.runInterval(() => {
    const players = world.getPlayers()
    const activePlayerIds = new Set(players.map(player => player.id))

    clearStaleOutlines(activePlayerIds)

    for (const player of players) {
        try {
            setPlayerOutline(player, getPreviewBlocks(player))
        } catch (e) {
            clearPlayerOutline(player.id)
            console.warn(`[ExcavateOutline] Preview update failed: ${e}`)
        }
    }
}, OUTLINE_UPDATE_TICKS)

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

    minusHunger = Math.floor(getNumberSetting('dorios:hungerCost', minusHunger, 0, 20))
    minusSaturation = Math.floor(getNumberSetting('dorios:saturationCost', minusSaturation, 0, 20))

    if (minusHunger <= 0 && minusSaturation <= 0) return true

    const hungerComponent = player.getComponent('minecraft:food') ?? player.getComponent('player.hunger')
    const saturationComponent = player.getComponent('player.saturation')

    if (!hungerComponent || !saturationComponent) return false

    const currentHunger = hungerComponent.currentValue
    const currentSaturation = saturationComponent.currentValue

    // Prioriza gastar saturación antes que hambre
    if (minusSaturation > 0 && currentSaturation - minusSaturation >= 0) {
        saturationComponent.setCurrentValue(currentSaturation - minusSaturation)
        return true
    } else if (minusHunger > 0 && currentHunger - minusHunger >= 0) {
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
    shapelessVein: async function (player, block, brokenBlock, maxVein = 64, item, options = {}) {
        const blocks = calculateVeinBlocks(player, block, brokenBlock, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, block, isAirBlock(block) ? 1 : 0)
    },

    treeCapitator: async function (player, block, brokenBlock, maxVein = 128, item, options = {}) {
        const blocks = calculateTreeBlocks(player, block, brokenBlock, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, block, isAirBlock(block) ? 1 : 0)
    },

    veinMiner: async function (player, block, brokenBlock, maxVein = 64, item, options = {}) {
        const blocks = calculateOreBlocks(player, block, brokenBlock, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, block, isAirBlock(block) ? 1 : 0)
    },

    largeTunnel: async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item, options = {}) {
        const blocks = calculateLargeTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, brokenBlock)
    },

    smallTunnel: async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item, options = {}) {
        const blocks = calculateSmallTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, brokenBlock)
    },

    lineTunnel: async function (player, brokenBlock, brokenBlockPerm, maxVein = 64, item, options = {}) {
        const blocks = calculateLineTunnelBlocks(player, brokenBlock, brokenBlockPerm, maxVein, item, options)
        await mineCalculatedBlocks(player, item, blocks, brokenBlock)
    },
}
world.afterEvents.playerBreakBlock.subscribe(async e => {
    const { player, brokenBlockPermutation, block, itemStackBeforeBreak } = e

    if (!player.isSneaking || getGameMode(player) == 'creative') return
    if (player.getDynamicProperty("dorios:isAdding") || player.getDynamicProperty("dorios:isBlacklistAdding") || player.getDynamicProperty("dorios:isDefaultAdding")) return

    const settings = getVeinSettings(player)

    let brokenBlock = normalizeTypeId(brokenBlockPermutation.type.id)

    if (blacklist.includes(brokenBlock)) {
        removeBlacklistedFromPlayerList(player, settings.veinList, brokenBlock)
        return
    }

    if (!settings.isEnabled || !is_diggable(itemStackBeforeBreak, brokenBlockPermutation)) return;
    if (player.getComponent('player.hunger').currentValue == 0) return

    let vein = veinHandler[settings.veinShape]

    if (typeof vein !== 'function') return

    const veinOptions = {
        veinShape: settings.veinShape,
        veinConnect: settings.veinConnect,
        veinListSet: settings.veinListSet,
    }

    if (settings.veinShape == "largeTunnel" || settings.veinShape == "smallTunnel" || settings.veinShape == "lineTunnel") {
        await vein(player, block, brokenBlock, settings.veinLimit, itemStackBeforeBreak, veinOptions)
    } else {
        if (!settings.veinListSet.has(`${brokenBlock}`)) return
        try {
            await vein(player, block, brokenBlock, settings.veinLimit, itemStackBeforeBreak, veinOptions)
        } catch { }
    }
})
