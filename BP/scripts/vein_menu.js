import { world, system, ItemStack } from '@minecraft/server'
import { ActionFormData, ModalFormData } from '@minecraft/server-ui'
import { veinHandler, shapeNames } from 'vein_mine.js'
import { list, blacklist, maxLimit, setMaxLimit } from 'global_variables.js'

const CAPTURE_MODE_PROPERTIES = [
    'dorios:isAdding',
    'dorios:isBlacklistAdding',
    'dorios:isDefaultAdding',
]

const UI = {
    info: '\u00a7b',
    good: '\u00a72',
    danger: '\u00a74',
    reset: '\u00a7r',
}

function infoLabel(text) {
    return `${UI.info}${text}${UI.reset}`
}

function playerMessage(player, text) {
    system.run(() => {
        player.onScreenDisplay.setActionBar({ translate: text })
    })
}

function clampNumber(value, min, max, integer = false) {
    if (!Number.isFinite(value)) return null

    const parsed = integer ? Math.floor(value) : value
    return Math.min(Math.max(parsed, min), max)
}

function getWorldNumber(propertyId, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false) {
    const raw = Number(world.getDynamicProperty(propertyId))
    const source = Number.isFinite(raw) ? raw : fallback
    return clampNumber(source, min, max, integer)
}

function setCaptureMode(player, propertyId) {
    for (const property of CAPTURE_MODE_PROPERTIES) {
        player.setDynamicProperty(property, property === propertyId)
    }
}

function getPlayerVeinList(player) {
    try {
        const raw = player.getDynamicProperty('dorios:veinList')
        return raw ? JSON.parse(raw) : [...list]
    } catch (e) {
        console.warn('[ERROR] Failed to read vein list, resetting...')
        return [...list]
    }
}

function formatBlockName(typeId) {
    const [, id] = typeId.split(':')
    const name = (id ?? typeId)
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')

    return name
}

function showRemoveBlockDropdown(player, blocks, title, onRemove, reopenMenu) {
    if (!blocks.length) {
        playerMessage(player, '\u00a7cNo blocks to remove')
        reopenMenu?.()
        return
    }

    new ModalFormData()
        .title(title)
        .dropdown(infoLabel('Block'), blocks.map(formatBlockName), {
            defaultValueIndex: 0,
            tooltip: 'Only one block is removed at a time.',
        })
        .show(player).then(({ canceled, formValues }) => {
            if (canceled) {
                reopenMenu?.()
                return
            }

            const selectedBlock = blocks[formValues[0]]
            if (!selectedBlock) return

            onRemove(selectedBlock)
            playerMessage(player, '\u00a7aBlock successfully removed')
            reopenMenu?.()
        })
}

system.beforeEvents.startup.subscribe(e => {
    e.itemComponentRegistry.registerCustomComponent('dorios:excavate_settings', {
        onUse(e) {
            configMenu(e.source)
        }
    })
})

world.afterEvents.playerSpawn.subscribe(e => {
    const { initialSpawn, player } = e
    if (!initialSpawn) return
    if (player.hasTag('dorios:spawned')) return
    player.addTag('dorios:spawned')
    player.getComponent('inventory').container.addItem(new ItemStack('dorios:settings_item'))
})

export function configMenu(player) {
    const veinShape = player.getDynamicProperty('dorios:veinShape') ?? 'shapelessVein'
    const playerLimit = player.getDynamicProperty('dorios:veinLimit') ?? 64
    const globalLimit = getWorldNumber('dorios:maxLimit', maxLimit, 1, 4096, true)
    const enabled = player.getDynamicProperty('dorios:veinEnabled') ?? true

    const menu = new ActionFormData()
        .title('Excavate Configuration')
        .button(
            `Quick Settings\n${enabled ? `${UI.good}ON${UI.reset}` : `${UI.danger}OFF${UI.reset}`} | ${shapeNames[veinShape] ?? 'Shapeless'} | ${playerLimit}/${globalLimit}`,
            'textures/ui/icon_setting'
        )
        .button('Add Block to My List', 'textures/ui/realms_slot_check')
        .button('Remove Block from My List', 'textures/ui/realms_red_x')

    if (player.playerPermissionLevel == 2) {
        menu.button('Admin Settings', 'textures/ui/icon_setting')
    }

    menu.show(player).then(({ canceled, selection }) => {
        if (canceled) return

        switch (selection) {
            case 0:
                playerSettingsMenu(player)
                break

            case 1:
                playerMessage(player, '\u00a7eBreak a block to add it')
                setCaptureMode(player, 'dorios:isAdding')
                break

            case 2: {
                const veinList = getPlayerVeinList(player)
                showRemoveBlockDropdown(
                    player,
                    veinList,
                    'Remove Block from My List',
                    selectedBlock => {
                        const nextList = veinList.filter(block => block !== selectedBlock)
                        player.setDynamicProperty('dorios:veinList', JSON.stringify(nextList))
                    },
                    () => configMenu(player)
                )
                break
            }

            case 3:
                adminMenu(player)
                break
        }
    })
}

function playerSettingsMenu(player) {
    const shapeKeys = Object.keys(veinHandler)
    const currentShape = player.getDynamicProperty('dorios:veinShape') ?? 'shapelessVein'
    const shapeIndex = Math.max(0, shapeKeys.indexOf(currentShape))
    const globalLimit = getWorldNumber('dorios:maxLimit', maxLimit, 1, 4096, true)
    const currentLimit = player.getDynamicProperty('dorios:veinLimit') ?? 64
    const enabled = player.getDynamicProperty('dorios:veinEnabled') ?? true

    new ModalFormData()
        .title('Quick Settings')
        .toggle(infoLabel('Excavate Enabled'), {
            defaultValue: !!enabled,
            tooltip: 'Turns your personal Excavate ability on or off.',
        })
        .dropdown(infoLabel('Mining Mode'), shapeKeys.map(key => shapeNames[key]), {
            defaultValueIndex: shapeIndex,
            tooltip: 'Choose the mining pattern used while sneaking and breaking blocks.',
        })
        .slider(infoLabel('Max Blocks'), 1, globalLimit, {
            defaultValue: Math.min(currentLimit, globalLimit),
            tooltip: 'Maximum blocks this player can break per Excavate action.',
        })
        .show(player).then(({ canceled, formValues }) => {
            if (canceled) {
                configMenu(player)
                return
            }

            const nextEnabled = !!formValues[0]
            const nextShape = shapeKeys[formValues[1]] ?? 'shapelessVein'
            const nextLimit = Math.floor(formValues[2])

            player.setDynamicProperty('dorios:veinEnabled', nextEnabled)
            player.setDynamicProperty('dorios:veinShape', nextShape)
            player.setDynamicProperty('dorios:veinLimit', nextLimit)
            playerMessage(player, '\u00a7aExcavate settings updated')
            configMenu(player)
        })
}

function adminMenu(player) {
    const globalLimit = getWorldNumber('dorios:maxLimit', maxLimit, 1, 4096, true)
    const adminMenuForm = new ActionFormData()
        .title('Admin Settings')
        .button(`Basic Admin Settings\n${infoLabel('Global max:')} ${globalLimit}`, 'textures/ui/Wrenches1')
        .button(`Advanced Tuning\n${infoLabel('Durability, food, and delay')}`, 'textures/ui/gear')
        .button('Add Block to Default List', 'textures/ui/realms_slot_check')
        .button('Remove Block from Default List', 'textures/ui/realms_red_x')
        .button('Add Block to Blacklist', 'textures/blocks/barrier')
        .button('Remove Block from Blacklist', 'textures/ui/icon_trash')
        .button('Back')

    adminMenuForm.show(player).then(({ canceled, selection }) => {
        if (canceled) return

        switch (selection) {
            case 0:
                basicAdminSettingsMenu(player)
                break

            case 1:
                advancedTuningMenu(player)
                break

            case 2:
                playerMessage(player, '\u00a7eBreak a block to add it')
                setCaptureMode(player, 'dorios:isDefaultAdding')
                break

            case 3:
                showRemoveBlockDropdown(
                    player,
                    [...list],
                    'Remove Block from Default List',
                    selectedBlock => {
                        const index = list.indexOf(selectedBlock)
                        if (index !== -1) list.splice(index, 1)
                        world.setDynamicProperty('dorios:initialVein', JSON.stringify(list))
                    },
                    () => adminMenu(player)
                )
                break

            case 4:
                playerMessage(player, '\u00a7eBreak a block to add it')
                setCaptureMode(player, 'dorios:isBlacklistAdding')
                break

            case 5:
                showRemoveBlockDropdown(
                    player,
                    [...blacklist],
                    'Remove Block from Blacklist',
                    selectedBlock => {
                        const index = blacklist.indexOf(selectedBlock)
                        if (index !== -1) blacklist.splice(index, 1)
                        world.setDynamicProperty('dorios:veinBlacklist', JSON.stringify(blacklist))
                    },
                    () => adminMenu(player)
                )
                break

            case 6:
                configMenu(player)
                break
        }
    })
}

function basicAdminSettingsMenu(player) {
    const noConsumeDurability = world.getDynamicProperty('dorios:noConsumeDurability') ?? false
    const noConsumeSaturation = world.getDynamicProperty('dorios:noConsumeSaturation') ?? false
    const globalLimit = getWorldNumber('dorios:maxLimit', maxLimit, 1, 4096, true)

    new ModalFormData()
        .title('Basic Admin Settings')
        .slider(infoLabel('Global Max Blocks'), 1, 4096, {
            defaultValue: globalLimit,
            tooltip: 'Maximum personal block limit players are allowed to set.',
        })
        .toggle(infoLabel('Consume Durability'), {
            defaultValue: !noConsumeDurability,
            tooltip: 'When enabled, tools lose durability while Excavate breaks blocks.',
        })
        .toggle(infoLabel('Consume Food'), {
            defaultValue: !noConsumeSaturation,
            tooltip: 'When enabled, Excavate consumes hunger or saturation over time.',
        })
        .show(player).then(({ canceled, formValues }) => {
            if (canceled) {
                adminMenu(player)
                return
            }

            const nextGlobalLimit = clampNumber(Number(formValues[0]), 1, 4096, true)
            if (nextGlobalLimit === null) {
                playerMessage(player, '\u00a7cNumber not valid')
                return
            }

            setMaxLimit(nextGlobalLimit)
            world.setDynamicProperty('dorios:maxLimit', nextGlobalLimit)
            world.setDynamicProperty('dorios:maxVeinLimit', nextGlobalLimit)
            world.setDynamicProperty('dorios:noConsumeDurability', !formValues[1])
            world.setDynamicProperty('dorios:noConsumeSaturation', !formValues[2])

            playerMessage(player, '\u00a7aBasic admin settings updated')
            adminMenu(player)
        })
}

function advancedTuningMenu(player) {
    const durabilityCost = getWorldNumber('dorios:durabilityCost', 1, 0, 32, true)
    const durabilityChance = getWorldNumber('dorios:durabilityChance', 1, 0, 1, false)
    const consumeInterval = getWorldNumber('dorios:consumeInterval', 10, 1, 1024, true)
    const hungerCost = getWorldNumber('dorios:hungerCost', 1, 0, 20, true)
    const saturationCost = getWorldNumber('dorios:saturationCost', 1, 0, 20, true)
    const breakDelayEvery = getWorldNumber('dorios:breakDelayEvery', 32, 1, 1024, true)
    const breakDelayTicks = getWorldNumber('dorios:breakDelayTicks', 1, 0, 20, true)

    new ModalFormData()
        .title('Advanced Tuning')
        .slider(infoLabel('Durability Cost'), 0, 32, {
            defaultValue: durabilityCost,
            tooltip: 'Durability damage applied per block. Set to 0 to avoid durability cost.',
        })
        .slider(infoLabel('Durability Chance %'), 0, 100, {
            defaultValue: Math.round(durabilityChance * 100),
            tooltip: 'Percent chance that each durability cost is applied.',
        })
        .slider(infoLabel('Food Interval'), 1, 1024, {
            defaultValue: consumeInterval,
            tooltip: 'Consumes food every N blocks broken by Excavate.',
        })
        .slider(infoLabel('Hunger Cost'), 0, 20, {
            defaultValue: hungerCost,
            tooltip: 'Hunger points consumed when the food interval triggers.',
        })
        .slider(infoLabel('Saturation Cost'), 0, 20, {
            defaultValue: saturationCost,
            tooltip: 'Saturation points consumed before hunger when possible.',
        })
        .slider(infoLabel('Delay Every N Blocks'), 1, 1024, {
            defaultValue: breakDelayEvery,
            tooltip: 'Adds a short pause every N blocks to reduce performance spikes.',
        })
        .slider(infoLabel('Delay Ticks'), 0, 20, {
            defaultValue: breakDelayTicks,
            tooltip: 'Length of the pause in ticks. 20 ticks equals about 1 second.',
        })
        .show(player).then(({ canceled, formValues }) => {
            if (canceled) {
                adminMenu(player)
                return
            }

            world.setDynamicProperty('dorios:durabilityCost', clampNumber(Number(formValues[0]), 0, 32, true))
            world.setDynamicProperty('dorios:durabilityChance', clampNumber(Number(formValues[1]) / 100, 0, 1, false))
            world.setDynamicProperty('dorios:consumeInterval', clampNumber(Number(formValues[2]), 1, 1024, true))
            world.setDynamicProperty('dorios:hungerCost', clampNumber(Number(formValues[3]), 0, 20, true))
            world.setDynamicProperty('dorios:saturationCost', clampNumber(Number(formValues[4]), 0, 20, true))
            world.setDynamicProperty('dorios:breakDelayEvery', clampNumber(Number(formValues[5]), 1, 1024, true))
            world.setDynamicProperty('dorios:breakDelayTicks', clampNumber(Number(formValues[6]), 0, 20, true))

            playerMessage(player, '\u00a7aAdvanced tuning updated')
            adminMenu(player)
        })
}

world.beforeEvents.playerBreakBlock.subscribe(e => {
    const { player, block } = e

    if (player.getDynamicProperty('dorios:isAdding')) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '\u00a7cBlock is on the black list')
            e.cancel = true
            player.setDynamicProperty('dorios:isAdding', false)
            return
        }

        const veinList = getPlayerVeinList(player)

        if (veinList.includes(block.typeId)) {
            playerMessage(player, '\u00a7cBlock already added')
        } else {
            veinList.push(block.typeId)
            player.setDynamicProperty('dorios:veinList', JSON.stringify(veinList))
            playerMessage(player, '\u00a7aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isAdding', false)
        return
    }

    if (player.getDynamicProperty('dorios:isBlacklistAdding')) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '\u00a7cBlock already added')
        } else {
            blacklist.push(block.typeId)
            world.setDynamicProperty('dorios:veinBlacklist', JSON.stringify(blacklist))
            playerMessage(player, '\u00a7aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isBlacklistAdding', false)
        return
    }

    if (player.getDynamicProperty('dorios:isDefaultAdding')) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '\u00a7cBlock is on the black list')
            e.cancel = true
            player.setDynamicProperty('dorios:isDefaultAdding', false)
            return
        }

        if (list.includes(block.typeId)) {
            playerMessage(player, '\u00a7cBlock already added')
        } else {
            list.push(block.typeId)
            world.setDynamicProperty('dorios:initialVein', JSON.stringify(list))
            playerMessage(player, '\u00a7aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isDefaultAdding', false)
        return
    }
})
